import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AccountSelect } from '@/components/money';
import { Badge, Btn, Card, Chips, DateField, Empty, Field, Loader, Progress, Row, Screen, Sheet, Txt, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { parseMoney, parsePercent, type BusinessProfile, type Loan, type MoneyAccount } from '@/lib/shared';

interface Form {
  direction: 'borrowed' | 'lent';
  party: string;
  principal: string;
  rate: string;
  startDate: string;
  installment: string;
  accountId: string;
  notes: string;
}

/** Loans the business took or gave: what is still outstanding and when the next payment is due. */
export default function Loans() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const list = useApi<Loan[]>('/loans');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const owe = (list.data ?? []).filter((l) => l.direction === 'borrowed').reduce((s, l) => s + l.outstanding, 0);
  const owed = (list.data ?? []).filter((l) => l.direction === 'lent').reduce((s, l) => s + l.outstanding, 0);

  async function save() {
    if (!form) return;
    const principal = parseMoney(form.principal);
    const rateBp = form.rate.trim() ? parsePercent(form.rate) : 0;
    const installmentAmount = form.installment.trim() ? parseMoney(form.installment) : 0;
    if (!form.party.trim()) return toast('Who is the loan with?', 'error');
    if (!principal || principal <= 0) return toast('Enter the loan amount', 'error');
    if (rateBp === null || installmentAmount === null) return toast('Check the rate and repayment amount', 'error');
    setBusy(true);
    try {
      const loan = await api<Loan>('/loans', { body: { businessId: businesses.data?.[0]?.id, direction: form.direction, party: form.party.trim(), principal, rateBp, startDate: form.startDate, installmentAmount, accountId: form.accountId || null, notes: form.notes.trim() } });
      toast(form.direction === 'borrowed' ? 'Loan recorded · money added to the account' : 'Loan recorded · money taken from the account');
      setForm(null);
      router.push({ pathname: '/loan/[id]', params: { id: loan.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      <Row gap={10}>
        <Card style={{ flex: 1 }}>
          <Txt v="small">You owe</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 18, color: th.danger }}>{fm(owe)}</Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt v="small">Owed to you</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 18, color: th.success }}>{fm(owed)}</Txt>
        </Card>
      </Row>
      {can('finance.manage') && <Btn icon="add" title="Record a loan" onPress={() => setForm({ direction: 'borrowed', party: '', principal: '', rate: '', startDate: todayStr(), installment: '', accountId: '', notes: '' })} />}
      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={list.reload}>
        {(list.data ?? []).length === 0 ? (
          <Empty icon="git-compare-outline" title="No loans" hint="Bank loans, running finance, or money lent to staff and others. Repayments and interest are tracked separately." />
        ) : (
          list.data!.map((l) => (
            <Card key={l.id} label={`Loan ${l.party}`} onPress={() => router.push({ pathname: '/loan/[id]', params: { id: l.id } })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>{l.party}</Txt>
                  <Txt v="small">
                    {l.direction === 'borrowed' ? 'Borrowed' : 'Lent'} {fm(l.principal, l)} · {fd(l.startDate)}
                    {l.nextDue ? ` · next ${fd(l.nextDue)}` : ''}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt style={{ fontWeight: '800' }}>{fm(l.outstanding, l)}</Txt>
                  <Badge status={l.status === 'closed' ? 'paid' : 'unpaid'} label={l.status === 'closed' ? 'Repaid' : 'Outstanding'} />
                </View>
              </Row>
              <Progress value={l.repaid} total={l.principal} word="repaid" />
            </Card>
          ))
        )}
      </Loader>
      <Sheet visible={!!form} title="New loan" onClose={() => setForm(null)}>
        <Chips
          value={form?.direction ?? 'borrowed'}
          onChange={(v) => set({ direction: v })}
          options={[
            { value: 'borrowed', label: 'We borrowed' },
            { value: 'lent', label: 'We lent' },
          ]}
        />
        <Field label={form?.direction === 'lent' ? 'Lent to' : 'Borrowed from'} value={form?.party ?? ''} onChangeText={(v) => set({ party: v })} placeholder="e.g. Meezan Bank, Ahmed (staff)" />
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 2 }} label="Amount" money value={form?.principal ?? ''} onChangeText={(v) => set({ principal: v })} />
          <Field style={{ flex: 1 }} label="Interest % / year" money value={form?.rate ?? ''} onChangeText={(v) => set({ rate: v })} placeholder="0" />
        </Row>
        <DateField label="Date" value={form?.startDate ?? todayStr()} onChange={(v) => set({ startDate: v })} />
        <Field label="Monthly repayment (optional)" money value={form?.installment ?? ''} onChangeText={(v) => set({ installment: v })} hint="Shows the due dates on the bills calendar and in the cash forecast" />
        <AccountSelect label={form?.direction === 'lent' ? 'Paid from' : 'Received into'} accounts={accounts.data ?? []} value={form?.accountId ?? ''} onChange={(id) => set({ accountId: id })} />
        <Field label="Notes (optional)" value={form?.notes ?? ''} onChangeText={(v) => set({ notes: v })} />
        <Btn title="Save loan" onPress={save} loading={busy} />
      </Sheet>
    </Screen>
  );
}
