import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Badge, Btn, Card, Chips, Empty, Field, GRADIENT, KV, Loader, Row, Screen, Section, Sheet, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney } from '@/lib/shared';

interface Bill {
  id: string;
  number: string;
  supplier: string;
  billNo: string;
  date: string;
  total: number;
  paid: number;
  balance: number;
  overdue: number;
  nextDue: string;
  nextAmount: number;
  daysOverdue: number;
  status: 'overdue' | 'due_soon' | 'upcoming';
  openInstallments: number;
  currency: string;
  currencyPrecision: number;
}
interface Unpaid {
  totals: { unpaid: number; overdue: number; dueSoon: number; bills: number };
  aging: { notDue: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number };
  suppliers: { supplier: string; unpaid: number; overdue: number; bills: number; oldestDue: string }[];
  bills: Bill[];
}
type Show = 'all' | 'overdue' | 'due_soon';

const AGING: { key: keyof Unpaid['aging']; label: string; color: string }[] = [
  { key: 'notDue', label: 'Not due', color: '#19B892' },
  { key: 'd1_30', label: '1–30 days', color: '#F5B955' },
  { key: 'd31_60', label: '31–60', color: '#F08A3E' },
  { key: 'd61_90', label: '61–90', color: '#E0563B' },
  { key: 'd90plus', label: '90+', color: '#B42318' },
];

const days = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86400_000);
function dueText(b: Bill) {
  if (b.status === 'overdue') return `${b.daysOverdue} day${b.daysOverdue === 1 ? '' : 's'} overdue`;
  const d = days(b.nextDue);
  return d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
}

/** Purchase bills you still owe suppliers: what is overdue, what is due soon, and paying them. */
export default function Payables() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const [supplier, setSupplier] = useState('');
  const [show, setShow] = useState<Show>('all');
  const { data, loading, error, reload, refreshing } = useApi<Unpaid>(`/purchases/unpaid${supplier ? `?supplier=${encodeURIComponent(supplier)}` : ''}`);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const first = data?.bills[0];
  const money = (v: number) => fm(v, first ?? null);
  const bills = useMemo(() => (data?.bills ?? []).filter((b) => show === 'all' || b.status === show), [data, show]);
  const agingTotal = data ? Object.values(data.aging).reduce((a, b) => a + b, 0) : 0;

  function openPay(b: Bill) {
    setPaying(b);
    setAmount(moneyToInput(b.status === 'overdue' ? b.overdue : b.nextAmount, b.currencyPrecision));
  }
  async function pay(all: boolean) {
    if (!paying) return;
    const minor = all ? undefined : parseMoney(amount, paying.currencyPrecision);
    if (!all && (!minor || minor <= 0)) return toast('Enter the amount you paid', 'error');
    if (!all && minor! > paying.balance) return toast(`Only ${money(paying.balance)} is owed on this bill`, 'error');
    setBusy(true);
    try {
      await api(`/purchases/${paying.id}/pay`, { body: all ? { all: true } : { amount: minor } });
      toast(all || minor === paying.balance ? `${paying.supplier} paid in full` : `Paid ${money(minor!)} to ${paying.supplier}`);
      setPaying(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Unpaid purchases' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <>
            <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 18, gap: 14 }}>
              <View>
                <Txt style={{ color: 'rgba(255,255,255,0.8)', fontWeight: '800', fontSize: 12, letterSpacing: 1 }}>YOU OWE SUPPLIERS{supplier ? ` · ${supplier.toUpperCase()}` : ''}</Txt>
                <Txt style={{ color: '#fff', fontWeight: '900', fontSize: 30 }}>{money(data.totals.unpaid)}</Txt>
                <Txt style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {data.totals.bills} unpaid bill{data.totals.bills === 1 ? '' : 's'}
                </Txt>
              </View>
              <Row gap={10}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 14, padding: 12 }}>
                  <Row gap={6}>
                    <Ionicons name="alert-circle" size={16} color="#FFB4A8" />
                    <Txt style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' }}>Overdue</Txt>
                  </Row>
                  <Txt style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{money(data.totals.overdue)}</Txt>
                </View>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 14, padding: 12 }}>
                  <Row gap={6}>
                    <Ionicons name="time" size={16} color="#FDE68A" />
                    <Txt style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' }}>Due in 7 days</Txt>
                  </Row>
                  <Txt style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{money(data.totals.dueSoon)}</Txt>
                </View>
              </Row>
            </LinearGradient>

            {agingTotal > 0 && (
              <Card style={{ gap: 10 }}>
                <Txt v="label">How late</Txt>
                <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: th.neutralSoft }}>
                  {AGING.map((a) => (data.aging[a.key] > 0 ? <View key={a.key} style={{ flex: data.aging[a.key], backgroundColor: a.color }} /> : null))}
                </View>
                {AGING.filter((a) => data.aging[a.key] > 0).map((a) => (
                  <Row key={a.key} gap={8}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: a.color }} />
                    <Txt style={{ flex: 1 }}>{a.label === 'Not due' ? 'Not due yet' : `${a.label}${a.key === 'd1_30' ? '' : ' days'} late`}</Txt>
                    <Txt style={{ fontWeight: '800' }}>{money(data.aging[a.key])}</Txt>
                  </Row>
                ))}
              </Card>
            )}

            {data.suppliers.length > 1 || supplier ? (
              <Section title="By supplier">
                <Chips
                  value={supplier}
                  onChange={setSupplier}
                  options={[{ value: '', label: 'All' }, ...(supplier && !data.suppliers.some((s) => s.supplier === supplier) ? [{ value: supplier, label: supplier }] : []), ...data.suppliers.slice(0, 12).map((s) => ({ value: s.supplier, label: `${s.supplier} · ${money(s.unpaid)}` }))]}
                />
              </Section>
            ) : null}

            <Chips<Show>
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: `All ${data.bills.length}` },
                { value: 'overdue', label: `Overdue ${data.bills.filter((b) => b.status === 'overdue').length}` },
                { value: 'due_soon', label: `Due this week ${data.bills.filter((b) => b.status === 'due_soon').length}` },
              ]}
            />

            {!bills.length && <Empty icon="checkmark-done-circle-outline" title={data.bills.length ? 'Nothing here' : 'All supplier bills are paid'} hint={data.bills.length ? undefined : 'Purchases saved as "Pay later" or in installments show here until they are paid.'} />}
            {bills.map((b) => (
              <Card key={b.id} onPress={() => router.push({ pathname: '/purchase/[id]', params: { id: b.id } })} label={`${b.supplier} ${money(b.balance)}`} style={{ gap: 8 }}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '800', fontSize: 16 }}>{b.supplier}</Txt>
                    <Txt v="small">
                      {b.number}
                      {b.billNo ? ` · bill ${b.billNo}` : ''} · {b.date}
                    </Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt style={{ fontWeight: '900', fontSize: 17, color: b.status === 'overdue' ? th.danger : th.text }}>{money(b.balance)}</Txt>
                    <Badge status={b.status === 'overdue' ? 'overdue' : b.status === 'due_soon' ? 'sent' : 'draft'} label={dueText(b)} />
                  </View>
                </Row>
                {b.paid > 0 && (
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: th.neutralSoft, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.round((b.paid / b.total) * 100)}%`, height: '100%', backgroundColor: th.primary }} />
                  </View>
                )}
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt v="small">
                    {b.paid > 0 ? `${money(b.paid)} of ${money(b.total)} paid` : `Bill total ${money(b.total)}`}
                    {b.openInstallments > 1 ? ` · ${b.openInstallments} payments left` : ''}
                  </Txt>
                  {can('finance.manage') && <Btn small icon="cash-outline" title="Pay" onPress={() => openPay(b)} />}
                </Row>
              </Card>
            ))}
          </>
        )}
      </Loader>

      <Sheet visible={!!paying} title={paying ? `Pay ${paying.supplier}` : 'Pay'} onClose={() => setPaying(null)}>
        {paying && (
          <View style={{ gap: 12 }}>
            <KV k="Still owed" v={money(paying.balance)} bold />
            {paying.overdue > 0 && <KV k="Overdue now" v={money(paying.overdue)} color={th.danger} />}
            <KV k="Next payment" v={`${money(paying.nextAmount)} · ${paying.nextDue}`} />
            <Field label="Amount paid" money value={amount} onChangeText={setAmount} />
            <Txt v="small">Taken from the account the bill was paid from, dated today. A part payment leaves the rest as unpaid.</Txt>
            <Btn icon="checkmark" title="Record payment" loading={busy} onPress={() => pay(false)} />
            <Btn kind="secondary" title={`Pay all ${money(paying.balance)}`} loading={busy} onPress={() => pay(true)} />
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
