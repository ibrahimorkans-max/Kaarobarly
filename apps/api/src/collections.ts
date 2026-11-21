import { z } from 'zod';
import { REMINDER_CHANNELS, type CollectionRow, type CreditNote, type Reminder } from '../../../packages/shared/src/index';
import { now, today, uid, type Db, type Row } from './core';
import { INVOICE_SELECT, ownedRow } from './domain';
import { assertDayOpen } from './daylock';
import { inBase } from './fx';
import { HttpError, type AuthContext } from './perm';
import { addMove, clearMoves, isTracked } from './stock';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const json = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// ================================================================ reminders & collections

export const reminderSchema = z.object({
  clientId: z.string().min(1),
  invoiceId: z.string().nullable().default(null),
  channel: z.enum(REMINDER_CHANNELS),
  note: z.string().trim().max(1000).default(''),
  promiseDate: z.union([isoDate, z.literal('')]).default(''),
});

const mapReminder = (r: Row): Reminder => ({ id: r.id, clientId: r.client_id, invoiceId: r.invoice_id, channel: r.channel, note: r.note, promiseDate: r.promise_date, byName: r.by_name, createdAt: r.created_at });

export function logReminder(db: Db, auth: AuthContext, body: z.infer<typeof reminderSchema>): Reminder {
  ownedRow(db, 'client', auth.tenantId, body.clientId);
  if (body.invoiceId) ownedRow(db, 'invoice', auth.tenantId, body.invoiceId);
  const id = uid();
  db.run(
    'insert into reminder (id, tenant_id, client_id, invoice_id, channel, note, promise_date, by_name, created_at) values (?,?,?,?,?,?,?,?,?)',
    id, auth.tenantId, body.clientId, body.invoiceId, body.channel, body.note, body.promiseDate, auth.name, now(),
  );
  return mapReminder(db.get('select * from reminder where id = ?', id)!);
}

export function clientReminders(db: Db, tenantId: string, clientId: string): Reminder[] {
  return db.all('select * from reminder where tenant_id = ? and client_id = ? order by created_at desc limit 100', tenantId, clientId).map(mapReminder);
}

/** Who owes money, most overdue first, with their unpaid invoices and the last reminder sent. */
export function collections(db: Db, tenantId: string, businessId?: string): CollectionRow[] {
  const t = today();
  const rows = db.all(
    `select * from (${INVOICE_SELECT} where i.tenant_id = ? and i.status = 'final' ${businessId ? 'and i.business_id = ?' : ''}) where paid < total order by due_date`,
    tenantId,
    ...(businessId ? [businessId] : []),
  );
  const byClient = new Map<string, CollectionRow>();
  for (const r of rows) {
    let c = byClient.get(r.client_id);
    if (!c) {
      const cl = db.get('select * from client where id = ?', r.client_id)!;
      const last = db.get('select * from reminder where client_id = ? order by created_at desc limit 1', r.client_id);
      c = {
        clientId: r.client_id,
        clientName: r.client_name,
        phone: cl.phone,
        whatsapp: cl.whatsapp,
        email: cl.email,
        outstanding: 0,
        overdue: 0,
        daysOverdue: 0,
        invoices: [],
        lastReminder: last ? mapReminder(last) : null,
        portalToken: cl.portal_token ?? null,
      };
      byClient.set(r.client_id, c);
    }
    const balance = inBase(r.total - r.paid, r.fx_factor);
    c.outstanding += balance;
    if (r.due_date < t) {
      c.overdue += balance;
      c.daysOverdue = Math.max(c.daysOverdue, daysBetween(r.due_date, t));
    }
    c.invoices.push({ id: r.id, number: r.number, dueDate: r.due_date, balance });
  }
  return [...byClient.values()].sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
}

// ================================================================ client portal

/** Turn on (or renew) a client's portal link. The token is the only key to the page. */
export function enablePortal(db: Db, auth: AuthContext, clientId: string, renew: boolean): { token: string } {
  const c = ownedRow(db, 'client', auth.tenantId, clientId);
  if (c.portal_token && !renew) return { token: c.portal_token };
  const token = `${uid().replace(/-/g, '')}${uid().replace(/-/g, '').slice(0, 8)}`;
  db.run('update client set portal_token = ? where id = ?', token, clientId);
  db.audit(auth.tenantId, auth.userId, renew ? 'portal.renew' : 'portal.enable', 'client', clientId);
  return { token };
}

export function disablePortal(db: Db, auth: AuthContext, clientId: string) {
  ownedRow(db, 'client', auth.tenantId, clientId);
  db.run('update client set portal_token = null where id = ?', clientId);
  db.audit(auth.tenantId, auth.userId, 'portal.disable', 'client', clientId);
}

// ================================================================ credit notes

export const creditNoteSchema = z.object({
  invoiceId: z.string().min(1, 'Choose the invoice'),
  date: isoDate,
  lines: z
    .array(
      z.object({
        serviceId: z.string().nullable().default(null),
        name: z.string().trim().min(1).max(200),
        qty: z.number().int().min(1).max(1e12),
        unit: z.string().trim().max(30).default(''),
        unitPrice: z.number().int().min(0).max(1e13),
      }),
    )
    .min(1, 'Add what is being credited')
    .max(200),
  reason: z.string().trim().min(1, 'Give a reason, e.g. goods returned or price corrected').max(1000),
  restock: z.boolean().default(false),
});

const NOTE_SELECT = `select n.*, c.name as client_name, i.number as invoice_number, i.currency, i.currency_precision
  from credit_note n join client c on c.id = n.client_id join invoice i on i.id = n.invoice_id`;

function mapNote(r: Row): CreditNote {
  return {
    id: r.id,
    number: r.number,
    businessId: r.business_id,
    clientId: r.client_id,
    clientName: r.client_name,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    date: r.date,
    lines: json(r.lines, []),
    reason: r.reason,
    total: r.total,
    restock: !!r.restock,
    status: r.status,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    createdAt: r.created_at,
  };
}

export function listCreditNotes(db: Db, tenantId: string, f: { clientId?: string; invoiceId?: string } = {}): CreditNote[] {
  const where = ['n.tenant_id = ?'];
  const args: any[] = [tenantId];
  if (f.clientId) where.push('n.client_id = ?'), args.push(f.clientId);
  if (f.invoiceId) where.push('n.invoice_id = ?'), args.push(f.invoiceId);
  return db.all(`${NOTE_SELECT} where ${where.join(' and ')} order by n.date desc, n.created_at desc limit 200`, ...args).map(mapNote);
}

export function getCreditNote(db: Db, tenantId: string, id: string): CreditNote {
  const r = db.get(`${NOTE_SELECT} where n.id = ? and n.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Credit note not found.');
  return mapNote(r);
}

/**
 * Credit part of a final invoice (goods returned, price corrected, discount after billing).
 * It lowers what the client owes on that invoice; returned goods can go back into stock.
 */
export function createCreditNote(db: Db, auth: AuthContext, body: z.infer<typeof creditNoteSchema>): CreditNote {
  return db.tx(() => {
    const inv = db.get(`${INVOICE_SELECT} where i.tenant_id = ? and i.id = ?`, auth.tenantId, body.invoiceId);
    if (!inv) throw new HttpError(404, 'Invoice not found.');
    if (inv.status !== 'final') throw new HttpError(409, 'Credit notes are made against final invoices.');
    assertDayOpen(db, auth.tenantId, inv.business_id, body.date);
    const lines = body.lines.map((l) => ({ ...l, amount: Math.round((l.qty * l.unitPrice) / 1000) }));
    const total = lines.reduce((s, l) => s + l.amount, 0);
    if (total <= 0) throw new HttpError(422, 'The credit note total must be above zero.');
    const due = inv.total - inv.paid;
    if (total > due) throw new HttpError(422, `Only ${due / 10 ** inv.currency_precision} is still unpaid on ${inv.number}. Refund the client for the rest.`);
    const id = uid();
    const number = `CN-${String(db.nextCounter(auth.tenantId, `credit:${inv.business_id}`)).padStart(5, '0')}`;
    db.run(
      "insert into credit_note (id, tenant_id, business_id, client_id, invoice_id, number, date, lines, reason, total, restock, status, created_by, created_at) values (?,?,?,?,?,?,?,?,?,?,?,'final',?,?)",
      id, auth.tenantId, inv.business_id, inv.client_id, inv.id, number, body.date, JSON.stringify(lines), body.reason, total, body.restock ? 1 : 0, auth.userId, now(),
    );
    if (body.restock) {
      for (const l of lines) {
        if (!isTracked(db, auth.tenantId, l.serviceId)) continue;
        addMove(db, auth, { itemId: l.serviceId!, qty: l.qty, date: body.date, kind: 'return', refType: 'credit_note', refId: id, refNumber: number, note: body.reason });
      }
    }
    db.audit(auth.tenantId, auth.userId, 'credit_note.create', 'credit_note', id, { total, invoice: inv.number });
    return getCreditNote(db, auth.tenantId, id);
  });
}

export function cancelCreditNote(db: Db, auth: AuthContext, id: string): CreditNote {
  return db.tx(() => {
    const n = getCreditNote(db, auth.tenantId, id);
    if (n.status === 'cancelled') throw new HttpError(409, 'Already cancelled.');
    assertDayOpen(db, auth.tenantId, n.businessId, n.date);
    db.run("update credit_note set status = 'cancelled' where id = ?", id);
    clearMoves(db, auth.tenantId, 'credit_note', id);
    db.audit(auth.tenantId, auth.userId, 'credit_note.cancel', 'credit_note', id);
    return getCreditNote(db, auth.tenantId, id);
  });
}

