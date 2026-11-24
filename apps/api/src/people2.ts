import { z } from 'zod';
import { now, today, uid, type Db, type Row } from './core';
import { getSetting, setSetting } from './growth';
import { inBase } from './fx';
import { HttpError, type AuthContext } from './perm';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const hhmm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const monthEnd = (m: string) => `${m}-${String(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
const biz = (db: Db, tenantId: string) => db.get('select currency, currency_precision from business where tenant_id = ? order by created_at limit 1', tenantId);

// ================================================================ attendance

export interface AttendanceSettings {
  /** printed as a QR at the counter; staff scan it to check in and out */
  code: string;
  /** after this time a check-in is late */
  startTime: string;
}

export function attendanceSettings(db: Db, tenantId: string): AttendanceSettings {
  const s = getSetting<AttendanceSettings>(db, tenantId, 'attendance', { code: '', startTime: '09:30' });
  if (!s.code) {
    s.code = `KBA-${uid().replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}`;
    setSetting(db, tenantId, 'attendance', s);
  }
  return s;
}

export const attendanceSettingsSchema = z.object({ startTime: z.string().regex(/^\d{2}:\d{2}$/), newCode: z.boolean().default(false) });
export function saveAttendanceSettings(db: Db, auth: AuthContext, body: z.infer<typeof attendanceSettingsSchema>) {
  const cur = attendanceSettings(db, auth.tenantId);
  setSetting(db, auth.tenantId, 'attendance', { startTime: body.startTime, code: body.newCode ? `KBA-${uid().replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}` : cur.code });
  return attendanceSettings(db, auth.tenantId);
}

const mapAtt = (r: Row) => ({ id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, date: r.date, status: r.status, checkIn: r.check_in, checkOut: r.check_out, method: r.method, late: !!r.late, note: r.note });

/** Everyone's attendance for a day, including employees with nothing recorded yet. */
export function attendanceDay(db: Db, tenantId: string, date: string) {
  const recs = new Map(db.all('select a.*, e.name as employee_name from attendance a join employee e on e.id = a.employee_id where a.tenant_id = ? and a.date = ?', tenantId, date).map((r) => [r.employee_id as string, mapAtt(r)]));
  return db
    .all("select id, name, designation from employee where tenant_id = ? and status = 'active' order by name collate nocase", tenantId)
    .map((e) => recs.get(e.id) ?? { id: '', employeeId: e.id, employeeName: e.name, date, status: 'not_marked', checkIn: '', checkOut: '', method: '', late: false, note: '' });
}

/** Scan the counter's QR: the first scan of the day checks in, the next checks out. */
export function checkByCode(db: Db, auth: AuthContext, code: string) {
  const s = attendanceSettings(db, auth.tenantId);
  if (code.trim() !== s.code) throw new HttpError(422, 'This is not your shop’s attendance code.');
  const e = db.get("select * from employee where tenant_id = ? and user_id = ? and status = 'active'", auth.tenantId, auth.userId);
  if (!e) throw new HttpError(422, 'Your login is not linked to an employee. Ask the owner to link it in People.');
  const t = today();
  const time = hhmm();
  const rec = db.get('select * from attendance where tenant_id = ? and employee_id = ? and date = ?', auth.tenantId, e.id, t);
  if (!rec) {
    db.run("insert into attendance (id, tenant_id, employee_id, date, status, check_in, check_out, method, late, note, created_at) values (?,?,?,?,'present',?,'','qr',?,'',?)", uid(), auth.tenantId, e.id, t, time, time > s.startTime ? 1 : 0, now());
    return { action: 'in' as const, time, late: time > s.startTime, name: e.name };
  }
  db.run("update attendance set check_out = ?, status = case when status = 'absent' then 'present' else status end where id = ?", time, rec.id);
  return { action: 'out' as const, time, late: false, name: e.name };
}

export const markSchema = z.object({
  employeeId: z.string().min(1),
  date: isoDate,
  status: z.enum(['present', 'absent', 'leave', 'half_day']),
  checkIn: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).default(''),
  checkOut: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).default(''),
  note: z.string().trim().max(200).default(''),
});

export function markAttendance(db: Db, auth: AuthContext, body: z.infer<typeof markSchema>) {
  if (!db.get('select 1 from employee where id = ? and tenant_id = ?', body.employeeId, auth.tenantId)) throw new HttpError(404, 'Employee not found.');
  const s = attendanceSettings(db, auth.tenantId);
  const late = body.status === 'present' && !!body.checkIn && body.checkIn > s.startTime ? 1 : 0;
  db.run(
    `insert into attendance (id, tenant_id, employee_id, date, status, check_in, check_out, method, late, note, created_at) values (?,?,?,?,?,?,?,'manual',?,?,?)
     on conflict (tenant_id, employee_id, date) do update set status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out, method = 'manual', late = excluded.late, note = excluded.note`,
    uid(), auth.tenantId, body.employeeId, body.date, body.status, body.checkIn, body.checkOut, late, body.note, now(),
  );
  db.audit(auth.tenantId, auth.userId, 'attendance.mark', 'employee', body.employeeId, { date: body.date, status: body.status });
  return attendanceDay(db, auth.tenantId, body.date);
}

/** Days present, absent, on leave and late per employee for a month. */
export function attendanceMonth(db: Db, tenantId: string, m: string) {
  const rows = db.all(
    `select e.id, e.name, sum(a.status = 'present') as present, sum(a.status = 'half_day') as half, sum(a.status = 'absent') as absent, sum(a.status = 'leave') as leave, sum(a.late) as late, count(a.id) as marked
     from employee e left join attendance a on a.employee_id = e.id and a.date between ? and ? where e.tenant_id = ? and e.status = 'active' group by e.id order by e.name collate nocase`,
    `${m}-01`, monthEnd(m), tenantId,
  );
  return rows.map((r) => ({ employeeId: r.id, name: r.name, present: r.present ?? 0, halfDays: r.half ?? 0, absent: r.absent ?? 0, leave: r.leave ?? 0, late: r.late ?? 0, marked: r.marked }));
}

/** For payroll: days to pay, from attendance when any was recorded that month (null = no records). */
export function payableDays(db: Db, tenantId: string, employeeId: string, m: string, payType: string, daysInMonth: number): number | null {
  const r = db.get(
    "select count(*) as n, sum(status = 'present') as p, sum(status = 'half_day') as h, sum(status = 'absent') as a from attendance where tenant_id = ? and employee_id = ? and date between ? and ?",
    tenantId, employeeId, `${m}-01`, monthEnd(m),
  );
  if (!r || !r.n) return null;
  // monthly staff: the month minus absences (a half day counts as half absent, rounded down); daily: days worked
  return payType === 'monthly' ? Math.max(0, daysInMonth - (r.a ?? 0) - Math.ceil((r.h ?? 0) / 2)) : (r.p ?? 0) + Math.floor((r.h ?? 0) / 2);
}

// ================================================================ targets, commission, leaderboard

/** Sales per employee for a month: invoices they made (through their login) plus services they did. */
export function leaderboard(db: Db, tenantId: string, m: string) {
  const from = `${m}-01`;
  const to = monthEnd(m);
  const out = db
    .all("select id, name, designation, user_id, sales_target, commission_bp from employee where tenant_id = ? and status = 'active'", tenantId)
    .map((e) => {
      const inv = e.user_id
        ? db.get("select coalesce(sum(subtotal - item_discounts - overall_discount), 0) as v, count(*) as n, group_concat(fx_factor) as f from invoice where tenant_id = ? and status = 'final' and created_by = ? and issue_date between ? and ?", tenantId, e.user_id, from, to)!
        : { v: 0, n: 0 };
      // invoices may be in other currencies: convert each
      const sales = e.user_id
        ? db.all("select subtotal - item_discounts - overall_discount as v, fx_factor from invoice where tenant_id = ? and status = 'final' and created_by = ? and issue_date between ? and ?", tenantId, e.user_id, from, to).reduce((s, r) => s + inBase(r.v, r.fx_factor), 0)
        : 0;
      const services = db.get("select coalesce(sum(s.default_price), 0) as v, count(*) as n from appointment a join service s on s.id = a.service_id where a.tenant_id = ? and a.staff_id = ? and a.status = 'done' and a.date between ? and ?", tenantId, e.id, from, to)!;
      const total = sales + services.v;
      const commission = Math.round((total * (e.commission_bp ?? 0)) / 10_000);
      return { employeeId: e.id, name: e.name, designation: e.designation, linked: !!e.user_id, invoices: inv.n, services: services.n, sales: total, target: e.sales_target ?? 0, progressBp: e.sales_target ? Math.round((total * 10_000) / e.sales_target) : 0, commissionBp: e.commission_bp ?? 0, commission };
    })
    .sort((a, b) => b.sales - a.sales);
  const b = biz(db, tenantId);
  return { month: m, rows: out, currency: b?.currency ?? 'PKR', currencyPrecision: b?.currency_precision ?? 2 };
}

export const commissionFor = (db: Db, tenantId: string, employeeId: string, m: string) => leaderboard(db, tenantId, m).rows.find((r) => r.employeeId === employeeId)?.commission ?? 0;

// ================================================================ cashier performance

/** Per cashier: shifts, bills, average bill, discounts, returns and cash differences. */
export function cashierPerformance(db: Db, tenantId: string, from: string, to: string) {
  const rows = db.all(
    `select s.opened_by as user_id, s.opened_by_name as name, count(distinct s.id) as shifts, coalesce(sum(s.difference), 0) as variance,
       sum(case when s.difference < 0 then 1 else 0 end) as short_shifts
     from pos_shift s where s.tenant_id = ? and substr(s.opened_at, 1, 10) between ? and ? group by s.opened_by`,
    tenantId, from, to,
  );
  const result = rows.map((r) => {
    const sales = db.get(
      `select count(*) as n, coalesce(sum(i.total), 0) as total, coalesce(sum(i.item_discounts + i.overall_discount), 0) as disc from invoice i join pos_shift s on s.id = i.pos_shift_id
       where i.tenant_id = ? and i.status = 'final' and s.opened_by = ? and substr(s.opened_at, 1, 10) between ? and ?`,
      tenantId, r.user_id, from, to,
    )!;
    const returns = db.get(
      `select count(*) as n, coalesce(sum(c.total), 0) as total from credit_note c join pos_shift s on s.id = c.pos_shift_id where c.tenant_id = ? and s.opened_by = ? and substr(s.opened_at, 1, 10) between ? and ?`,
      tenantId, r.user_id, from, to,
    )!;
    const voids = db.get("select count(*) as n from audit_log where tenant_id = ? and user_id = ? and action = 'order.cancel' and substr(at, 1, 10) between ? and ?", tenantId, r.user_id, from, to)!;
    return {
      userId: r.user_id,
      name: r.name,
      shifts: r.shifts,
      bills: sales.n,
      sales: sales.total,
      averageBill: sales.n ? Math.round(sales.total / sales.n) : 0,
      discounts: sales.disc,
      discountBp: sales.total + sales.disc ? Math.round((sales.disc * 10_000) / (sales.total + sales.disc)) : 0,
      returns: returns.n,
      returnsTotal: returns.total,
      voids: voids.n,
      variance: r.variance,
      shortShifts: r.short_shifts,
    };
  });
  const b = biz(db, tenantId);
  return { from, to, rows: result.sort((a, c) => c.sales - a.sales), currency: b?.currency ?? 'PKR', currencyPrecision: b?.currency_precision ?? 2 };
}

export const monthSchema = month;
