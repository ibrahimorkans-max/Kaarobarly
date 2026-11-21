import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AccountSelect } from '@/components/money';
import { Btn, Card, Chips, DateField, Field, IconBtn, KV, Loader, Progress, Row, Screen, Section, Sheet, Txt, confirm, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney, percentToString, type Loan, type LoanTxn, type MoneyAccount } from '@/lib/shared';

const KIND: Record<string, string> = { disbursement: 'Loan amount', repayment: 'Repayment', interest: 'Interest' };

export default function LoanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<{ loan: Loan; txns: LoanTxn[] }>(`/loans/${id}`);
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const [form, setForm] = useState<{ kind: 'repayment' | 'interest' | 'disbursement'; amount: string; date: string; accountId: string; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const l = data?.loan;
  const word = l?.direction === 'lent' ? 'collected' : 'paid';

  async function save() {
    if (!form || !l) return;
    const amount = parseMoney(form.amount, l.currencyPrecision);
    if (!amount || amount <= 0) return toast('Enter the amount', 'error');
    setBusy(true);
    try {
      await api(`/loans/${l.id}/txns`, { body: { kind: form.kind, amount, date: form.date, accountId: form.accountId || null, notes: form.notes } });
      toast('Saved');
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeTxn(t: LoanTxn) {
    if (!(await confirm('Delete this entry?', `${KIND[t.kind]} of ${fm(t.amount, l)} on ${fd(t.date)}.`, 'Delete'))) return;
    try {
      await api(`/loans/${id}/txns/${t.id}`, { method: 'DELETE' });
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function removeLoan() {
    if (!(await confirm('Delete the whole loan?', 'Every amount recorded on it comes off your account balances.', 'Delete loan'))) return;
    try {
      await api(`/loans/${id}`, { method: 'DELETE' });
      router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: l?.party ?? 'Loan' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {l && (
          <>
            <Card>
              <Txt v="small">{l.direction === 'borrowed' ? 'Still to repay' : 'Still to collect'}</Txt>
              <Txt style={{ fontWeight: '800', fontSize: 26, color: l.direction === 'borrowed' ? th.danger : th.success }}>{fm(l.outstanding, l)}</Txt>
              <Progress value={l.repaid} total={l.principal} word="repaid" />
              <KV k="Loan amount" v={fm(l.principal, l)} />
              <KV k={`Principal ${word}`} v={fm(l.repaid, l)} />
              <KV k={`Interest ${word}`} v={fm(l.interestPaid, l)} />
              {!!l.rateBp && <KV k="Interest rate" v={`${percentToString(l.rateBp)}% a year`} />}
              {!!l.installmentAmount && <KV k="Monthly repayment" v={fm(l.installmentAmount, l)} />}
              {l.nextDue && <KV k="Next due" v={fd(l.nextDue)} bold />}
              {!!l.notes && <Txt v="small">{l.notes}</Txt>}
            </Card>
            {can('finance.manage') && l.status === 'active' && (
              <Row gap={10}>
                <Btn style={{ flex: 1 }} small icon="arrow-undo-outline" title={l.direction === 'borrowed' ? 'Repay' : 'Collect'} onPress={() => setForm({ kind: 'repayment', amount: l.installmentAmount ? moneyToInput(Math.min(l.installmentAmount, l.outstanding), l.currencyPrecision) : '', date: todayStr(), accountId: '', notes: '' })} />
                <Btn style={{ flex: 1 }} small kind="secondary" icon="trending-up-outline" title="Interest" onPress={() => setForm({ kind: 'interest', amount: '', date: todayStr(), accountId: '', notes: '' })} />
                <Btn style={{ flex: 1 }} small kind="secondary" icon="add" title="Top up" onPress={() => setForm({ kind: 'disbursement', amount: '', date: todayStr(), accountId: '', notes: '' })} />
              </Row>
            )}
            <Section title="History">
              {data!.txns.map((t) => (
                <Card key={t.id}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '600' }}>{KIND[t.kind]}</Txt>
                      <Txt v="small">
                        {fd(t.date)} · {t.accountName}
                        {t.notes ? ` · ${t.notes}` : ''}
                      </Txt>
                    </View>
                    <Txt style={{ fontWeight: '700' }}>{fm(t.amount, l)}</Txt>
                    {can('finance.manage') && <IconBtn icon="trash-outline" label="Delete entry" color={th.danger} onPress={() => removeTxn(t)} />}
                  </Row>
                </Card>
              ))}
            </Section>
            {can('finance.manage') && <Btn kind="ghost" title="Delete loan" onPress={removeLoan} />}
          </>
        )}
      </Loader>
      <Sheet visible={!!form} title={form ? KIND[form.kind] : ''} onClose={() => setForm(null)}>
        <Chips
          value={form?.kind ?? 'repayment'}
          onChange={(v) => setForm((f) => f && { ...f, kind: v })}
          options={[
            { value: 'repayment', label: 'Repayment' },
            { value: 'interest', label: 'Interest / markup' },
            { value: 'disbursement', label: 'More loan' },
          ]}
        />
        <Field label="Amount" money value={form?.amount ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, amount: v })} />
        <DateField label="Date" value={form?.date ?? todayStr()} onChange={(v) => setForm((f) => f && { ...f, date: v })} />
        <AccountSelect accounts={accounts.data ?? []} value={form?.accountId ?? ''} onChange={(id) => setForm((f) => f && { ...f, accountId: id })} />
        <Field label="Notes (optional)" value={form?.notes ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, notes: v })} />
        <Btn title="Save" onPress={save} loading={busy} />
      </Sheet>
    </Screen>
  );
}
