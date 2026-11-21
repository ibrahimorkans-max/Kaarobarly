import { useState } from 'react';
import { View } from 'react-native';
import { AccountSelect } from '@/components/money';
import { Btn, Card, DateField, Field, KV, Loader, Notice, Row, Screen, Section, Txt, confirm, fd, fm, todayStr } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { parseMoney, type BusinessProfile, type DayClose, type MoneyAccount } from '@/lib/shared';

/** Count the cash at the end of the day, record any difference, and lock the day. */
export default function DayCloseScreen() {
  const th = useTheme();
  const toast = useToast();
  const { can, user } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [accountId, setAccountId] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const expected = useApi<{ accountId: string; accountName: string; expected: number }>(`/day-close/expected${qs({ date, accountId })}`);
  const history = useApi<DayClose[]>('/day-close');
  const last = history.data?.[0];
  const c = counted.trim() ? parseMoney(counted) : null;
  const diff = c !== null && expected.data ? c - expected.data.expected : null;

  async function close() {
    if (c === null) return toast('Enter the cash you counted', 'error');
    if (!(await confirm(`Close ${fd(date)}?`, `${diff ? `${diff > 0 ? 'Cash over' : 'Cash short'} ${fm(Math.abs(diff))} will be recorded. ` : ''}Money records on or before this day are locked until the owner reopens it.`, 'Close day'))) return;
    setBusy(true);
    try {
      await api('/day-close', { body: { businessId: businesses.data?.[0]?.id, accountId: accountId || expected.data?.accountId || null, date, counted: c, notes } });
      toast('Day closed');
      setCounted('');
      setNotes('');
      history.reload();
      expected.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reopen(d: DayClose) {
    if (!(await confirm(`Reopen ${fd(d.date)}?`, d.difference ? 'The cash over/short entry for that day is removed.' : 'Records of that day can be changed again.', 'Reopen'))) return;
    try {
      await api(`/day-close/${d.id}`, { method: 'DELETE' });
      toast('Day reopened');
      history.reload();
      expected.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  return (
    <Screen onRefresh={history.reload} refreshing={history.refreshing}>
      {last && <Notice kind="info">Books closed up to {fd(last.date)}.</Notice>}
      {can('finance.manage') && (
        <Card style={{ gap: 12 }}>
          <DateField label="Day to close" value={date} onChange={setDate} />
          <AccountSelect label="Cash account" accounts={(accounts.data ?? []).filter((a) => a.type === 'cash')} value={accountId || expected.data?.accountId || ''} onChange={setAccountId} />
          <Loader loading={expected.loading && !expected.data} error={expected.data ? '' : expected.error} onRetry={expected.reload}>
            {expected.data && <KV k="Cash there should be" v={fm(expected.data.expected)} bold />}
          </Loader>
          <Field label="Cash counted in the drawer" money value={counted} onChangeText={setCounted} placeholder="0" />
          {diff !== null && (
            <Txt style={{ fontWeight: '700', color: diff === 0 ? th.success : th.danger }}>{diff === 0 ? 'Matches exactly' : diff > 0 ? `${fm(diff)} over` : `${fm(-diff)} short`}</Txt>
          )}
          <Field label="Note (optional)" value={notes} onChangeText={setNotes} placeholder="e.g. change given wrongly" />
          <Btn icon="lock-closed-outline" title="Close the day" onPress={close} loading={busy} />
        </Card>
      )}
      <Section title="Closed days">
        {(history.data ?? []).length === 0 ? (
          <Txt v="sub">No days closed yet.</Txt>
        ) : (
          history.data!.map((d, i) => (
            <Card key={d.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>{fd(d.date)}</Txt>
                  <Txt v="small">
                    {d.accountName} · counted {fm(d.counted)} · by {d.closedByName}
                  </Txt>
                </View>
                <Txt style={{ fontWeight: '700', color: d.difference === 0 ? th.success : th.danger }}>{d.difference === 0 ? 'OK' : `${d.difference > 0 ? '+' : '−'}${fm(Math.abs(d.difference))}`}</Txt>
              </Row>
              {i === 0 && user?.role === 'owner' && <Btn small kind="ghost" title="Reopen this day" onPress={() => reopen(d)} />}
            </Card>
          ))
        )}
      </Section>
    </Screen>
  );
}
