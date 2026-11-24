import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { DocumentViewer } from '@/components/doc-viewer';
import { Badge, Btn, Card, Chips, Field, KV, Loader, Row, Screen, Section, Sheet, Txt, dt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { zReportHtml, type Paper } from '@/lib/pdf';
import { POS_TENDER_LABELS, formatMoney, parseMoney, type BusinessProfile, type PosShift, type ZReport } from '@/lib/shared';

/** A shift's running Z-report: cash in/out, and closing with a blind count of the drawer. */
export default function ShiftScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const toast = useToast();
  const { can } = useAuth();
  const mine = useApi<{ shift: PosShift | null; report: ZReport | null }>(params.id ? null : '/pos/shift');
  const byId = useApi<ZReport>(params.id ? `/pos/shifts/${params.id}` : null);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const z = params.id ? byId.data : mine.data?.report;
  const reload = () => (params.id ? byId.reload() : mine.reload());
  const loading = params.id ? byId.loading : mine.loading;
  const error = params.id ? byId.error : mine.error;
  const [sheet, setSheet] = useState<'' | 'move' | 'close'>('');
  const [kind, setKind] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const [print, setPrint] = useState(false);
  const business = businesses.data?.find((b) => b.id === z?.shift.businessId) ?? businesses.data?.[0];
  const p = z?.currencyPrecision ?? 2;
  const m = (v: number) => formatMoney(v, z?.currency ?? 'PKR', p);
  const build = useCallback((paper: Paper) => (z && business ? zReportHtml(z, business, paper) : ''), [z, business]);

  async function move() {
    const v = parseMoney(amount, p);
    if (!v || v <= 0) return toast('Enter an amount', 'error');
    setBusy(true);
    try {
      await api(`/pos/shifts/${z!.shift.id}/cash`, { body: { kind, amount: v, reason } });
      setSheet('');
      setAmount('');
      setReason('');
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    const v = parseMoney(counted || '0', p);
    if (v === null || v < 0) return toast('Enter the cash you counted', 'error');
    setBusy(true);
    try {
      const r = await api<ZReport>(`/pos/shifts/${z!.shift.id}/close`, { body: { counted: v } });
      setSheet('');
      const d = r.shift.difference ?? 0;
      toast(d === 0 ? 'Shift closed. The drawer balances.' : `Shift closed. The drawer is ${d > 0 ? 'over' : 'short'} by ${m(Math.abs(d))}.`);
      router.replace({ pathname: '/pos/shift', params: { id: r.shift.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const open = z?.shift.status === 'open';
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Shift report' }} />
      <Loader loading={loading && !z} error={z ? '' : error || (!loading ? 'No open shift.' : '')} onRetry={reload}>
        {z && (
          <>
            <Card style={{ gap: 4 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="h">{z.shift.openedByName}</Txt>
                <Badge status={open ? 'unpaid' : 'paid'} label={open ? 'Open' : 'Closed'} />
              </Row>
              <Txt v="small">
                {dt(z.shift.openedAt)}
                {z.shift.closedAt ? ` → ${dt(z.shift.closedAt, true)}` : ''} · {z.shift.accountName}
              </Txt>
            </Card>
            <Section title="Sales">
              <Card>
                <KV k="Sales" v={String(z.sales)} />
                <KV k="Sales total" v={m(z.salesTotal)} bold />
                {z.byTender.map((x) => (
                  <KV key={x.tender} k={POS_TENDER_LABELS[x.tender]} v={m(x.amount)} />
                ))}
                <KV k="Discounts" v={m(z.discounts)} />
                <KV k="Tax" v={m(z.tax)} />
                <KV k={`Returns (${z.returns})`} v={m(z.returnsTotal)} />
              </Card>
            </Section>
            <Section title="Cash drawer">
              <Card>
                <KV k="Opening float" v={m(z.shift.openingFloat)} />
                <KV k="Cash in" v={m(z.cashIn)} />
                <KV k="Cash out" v={m(z.cashOut)} />
                <KV k="Cash refunds" v={m(z.cashRefunds)} />
                {/* blind count: cashiers do not see the expected cash until the shift is closed */}
                {(!open || can('pos.manage')) && <KV k="Expected in drawer" v={m(z.expectedCash)} bold />}
                {z.shift.counted !== null && (
                  <>
                    <KV k="Counted" v={m(z.shift.counted)} />
                    <KV k="Difference" v={m(z.shift.difference ?? 0)} bold />
                  </>
                )}
              </Card>
              {z.moves.map((mv) => (
                <Txt key={mv.id} v="small">
                  {dt(mv.at, true)} · {mv.kind === 'in' ? 'In' : 'Out'} {m(mv.amount)} · {mv.reason} · {mv.byName}
                </Txt>
              ))}
            </Section>
            <Btn kind="secondary" icon="print-outline" title="Print Z-report" onPress={() => setPrint(true)} />
            {open && (
              <Row gap={10}>
                <Btn style={{ flex: 1 }} kind="secondary" icon="swap-vertical-outline" title="Cash in / out" onPress={() => setSheet('move')} />
                <Btn style={{ flex: 1 }} icon="lock-closed-outline" title="Close shift" onPress={() => setSheet('close')} />
              </Row>
            )}
            {can('pos.manage') && <Btn kind="ghost" title="All shifts" onPress={() => router.push('/pos/shifts')} />}
          </>
        )}
      </Loader>

      <Sheet visible={sheet === 'move'} title="Cash in or out" onClose={() => setSheet('')}>
        <Chips value={kind} onChange={(v) => setKind(v as 'in' | 'out')} options={[{ value: 'out', label: 'Take out' }, { value: 'in', label: 'Put in' }]} />
        <Field label="Amount" money value={amount} onChangeText={setAmount} />
        <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Safe drop, change, tea…" />
        <Btn title="Save" onPress={move} loading={busy} />
      </Sheet>
      <Sheet visible={sheet === 'close'} title="Close the shift" onClose={() => setSheet('')}>
        <Txt v="sub">Count every note and coin in the drawer and enter the total. You will see the difference after closing.</Txt>
        <Field label="Cash counted" money value={counted} onChangeText={setCounted} placeholder="0" />
        <Btn icon="lock-closed-outline" title="Close shift" onPress={close} loading={busy} />
        <Txt v="small">A shortage or excess is booked as Cash over/short.</Txt>
      </Sheet>
      {print && business && <DocumentViewer visible={print} onClose={() => setPrint(false)} title="Z-report" fileName={`z-report-${z?.shift.openedAt.slice(0, 10)}`} build={build} defaultPaper="thermal" />}
    </Screen>
  );
}
