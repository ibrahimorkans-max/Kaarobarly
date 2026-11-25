import { Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { BarcodeScanner } from '@/components/scanner';
import { Badge, Btn, Card, Chips, DateField, Field, IconBtn, Loader, Row, Screen, Sheet, Txt, addDays, fd, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { qrSvg } from '@/lib/qr';

type Status = 'present' | 'absent' | 'leave' | 'half_day';
interface Day {
  id: string;
  employeeId: string;
  employeeName: string;
  status: Status | 'not_marked';
  checkIn: string;
  checkOut: string;
  method: string;
  late: boolean;
}
interface MonthRow {
  employeeId: string;
  name: string;
  present: number;
  halfDays: number;
  absent: number;
  leave: number;
  late: number;
}
const LABEL: Record<Status | 'not_marked', string> = { present: 'Present', absent: 'Absent', leave: 'Leave', half_day: 'Half day', not_marked: 'Not marked' };

/** Staff check in by scanning the counter QR; managers mark the day and see the month. Payroll uses it. */
export default function AttendanceScreen() {
  const toast = useToast();
  const { can } = useAuth();
  const manager = can('payroll.manage');
  const [tab, setTab] = useState<'day' | 'month'>('day');
  const [date, setDate] = useState(todayStr());
  const day = useApi<Day[]>(manager ? `/attendance?date=${date}` : null);
  const month = useApi<MonthRow[]>(manager && tab === 'month' ? `/attendance/month?month=${date.slice(0, 7)}` : null);
  const settings = useApi<{ code: string; startTime: string }>(manager ? '/attendance/settings' : null);
  const [scan, setScan] = useState(false);
  const [edit, setEdit] = useState<{ d: Day; status: Status; checkIn: string; checkOut: string } | null>(null);
  const [qr, setQr] = useState(false);
  const [start, setStart] = useState('');

  async function check(code: string) {
    try {
      const r = await api<{ action: 'in' | 'out'; time: string; late: boolean; name: string }>('/attendance/check', { body: { code } });
      toast(`${r.name}: checked ${r.action} at ${r.time}${r.late ? ' (late)' : ''}`);
      day.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function mark() {
    if (!edit) return;
    try {
      await api('/attendance/mark', { body: { employeeId: edit.d.employeeId, date, status: edit.status, checkIn: edit.checkIn, checkOut: edit.checkOut } });
      setEdit(null);
      day.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function saveStart(newCode = false) {
    try {
      await api('/attendance/settings', { method: 'PUT', body: { startTime: start || settings.data?.startTime || '09:30', newCode } });
      settings.reload();
      toast(newCode ? 'New code made: print the new QR' : 'Saved');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  const buildQr = useCallback(
    () => `<!doctype html><html><head><meta charset="utf-8"/><style>body{font-family:Arial;text-align:center;padding:40px}h1{font-size:28px}</style></head><body><h1>Staff attendance</h1><p>Open Tijar → Attendance → Check in / out, and scan this code.</p>${qrSvg(settings.data?.code ?? '', 320)}<p style="color:#666">${settings.data?.code ?? ''}</p></body></html>`,
    [settings.data],
  );

  return (
    <Screen onRefresh={() => (day.reload(), month.reload())}>
      <Stack.Screen options={{ title: 'Attendance' }} />
      <Btn icon="qr-code-outline" title="Check in / out" onPress={() => setScan(true)} />
      {manager && (
        <>
          <Chips value={tab} onChange={setTab} options={[{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }]} />
          <Row style={{ alignItems: 'flex-end' }}>
            <IconBtn icon="chevron-back" label="Previous day" onPress={() => setDate(addDays(date, -1))} />
            <View style={{ flex: 1 }}>
              <DateField label={tab === 'month' ? 'Month of' : date === todayStr() ? 'Today' : fd(date)} value={date} onChange={setDate} />
            </View>
            <IconBtn icon="chevron-forward" label="Next day" onPress={() => setDate(addDays(date, 1))} />
          </Row>
          {tab === 'day' ? (
            <Loader loading={day.loading && !day.data} error={day.data ? '' : day.error} onRetry={day.reload}>
              {(day.data ?? []).length === 0 && <Txt v="sub">Add employees in People first.</Txt>}
              {(day.data ?? []).map((d) => (
                <Card key={d.employeeId} label={d.employeeName} onPress={() => setEdit({ d, status: d.status === 'not_marked' ? 'present' : d.status, checkIn: d.checkIn, checkOut: d.checkOut })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }}>{d.employeeName}</Txt>
                      <Txt v="small">
                        {d.checkIn ? `In ${d.checkIn}` : ''}
                        {d.checkOut ? ` · out ${d.checkOut}` : ''}
                        {d.method === 'qr' ? ' · by QR' : ''}
                      </Txt>
                    </View>
                    <Row gap={6}>
                      {d.late && <Badge status="partially_paid" label="Late" />}
                      <Badge status={d.status === 'present' ? 'paid' : d.status === 'absent' ? 'overdue' : d.status === 'not_marked' ? 'draft' : 'unpaid'} label={LABEL[d.status]} />
                    </Row>
                  </Row>
                </Card>
              ))}
            </Loader>
          ) : (
            <Loader loading={month.loading && !month.data} error={month.data ? '' : month.error} onRetry={month.reload}>
              {(month.data ?? []).map((r) => (
                <Card key={r.employeeId}>
                  <Txt style={{ fontWeight: '700' }}>{r.name}</Txt>
                  <Txt v="small">
                    Present {r.present} · half {r.halfDays} · absent {r.absent} · leave {r.leave} · late {r.late}
                  </Txt>
                </Card>
              ))}
              <Txt v="small">Payroll uses these days for anyone with attendance recorded in the month.</Txt>
            </Loader>
          )}
          {settings.data && (
            <Card style={{ gap: 8 }}>
              <Txt style={{ fontWeight: '700' }}>Counter QR code</Txt>
              <Row style={{ alignItems: 'flex-end' }}>
                <Field style={{ flex: 1 }} label="Late after (HH:MM)" value={start || settings.data.startTime} onChangeText={setStart} />
                <Btn small kind="secondary" title="Save" onPress={() => saveStart(false)} />
              </Row>
              <Row gap={8}>
                <Btn style={{ flex: 1 }} small icon="print-outline" title="Print QR" onPress={() => setQr(true)} />
                <Btn style={{ flex: 1 }} small kind="ghost" title="New code" onPress={() => saveStart(true)} />
              </Row>
              <Txt v="small">Link each employee to their login in People so their scan counts.</Txt>
            </Card>
          )}
        </>
      )}
      <BarcodeScanner visible={scan} onClose={() => setScan(false)} onCode={check} title="Scan the attendance QR" />
      <Sheet visible={!!edit} title={edit?.d.employeeName ?? ''} onClose={() => setEdit(null)}>
        <Chips<Status> value={edit?.status ?? 'present'} onChange={(v) => setEdit((e) => e && { ...e, status: v })} options={(['present', 'half_day', 'absent', 'leave'] as Status[]).map((s) => ({ value: s, label: LABEL[s] }))} />
        {edit?.status === 'present' && (
          <Row gap={10}>
            <Field style={{ flex: 1 }} label="In (HH:MM)" value={edit.checkIn} onChangeText={(v) => setEdit((e) => e && { ...e, checkIn: v })} />
            <Field style={{ flex: 1 }} label="Out (HH:MM)" value={edit.checkOut} onChangeText={(v) => setEdit((e) => e && { ...e, checkOut: v })} />
          </Row>
        )}
        <Btn title="Save" onPress={mark} />
      </Sheet>
      {qr && settings.data && <DocumentViewer visible={qr} onClose={() => setQr(false)} title="Attendance QR" fileName="attendance-qr" build={buildQr} defaultPaper="A4" papers={[{ value: 'A4', label: 'A4' }]} />}
    </Screen>
  );
}
