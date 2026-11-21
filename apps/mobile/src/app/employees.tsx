import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AccountSelect } from '@/components/money';
import { Badge, Btn, Card, Chips, DateField, Empty, Field, KV, Loader, Row, Screen, Sheet, Txt, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney, type BusinessProfile, type Employee, type MoneyAccount, type PayType } from '@/lib/shared';

interface Form {
  id?: string;
  name: string;
  phone: string;
  cnic: string;
  designation: string;
  joinDate: string;
  payType: PayType;
  rate: string;
  bankAccount: string;
  status: 'active' | 'left';
  notes: string;
}
const blank: Form = { name: '', phone: '', cnic: '', designation: '', joinDate: '', payType: 'monthly', rate: '', bankAccount: '', status: 'active', notes: '' };

/** Employees, their pay, and salary advances. */
export default function Employees() {
  const toast = useToast();
  const list = useApi<Employee[]>('/employees');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const [form, setForm] = useState<Form | null>(null);
  const [adv, setAdv] = useState<{ e: Employee; amount: string; monthly: string; date: string; accountId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const monthly = (list.data ?? []).filter((e) => e.status === 'active' && e.payType === 'monthly').reduce((s, e) => s + e.rate, 0);

  async function save() {
    if (!form) return;
    const rate = parseMoney(form.rate || '0');
    if (!form.name.trim()) return toast('Enter the name', 'error');
    if (rate === null || rate < 0) return toast('Enter the salary or wage', 'error');
    setBusy(true);
    try {
      const { id, ...rest } = form;
      await api(id ? `/employees/${id}` : '/employees', { method: id ? 'PUT' : 'POST', body: { ...rest, businessId: businesses.data?.[0]?.id, rate } });
      toast(id ? 'Saved' : `${form.name} added`);
      setForm(null);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function giveAdvance() {
    if (!adv) return;
    const amount = parseMoney(adv.amount);
    const monthlyRecovery = adv.monthly.trim() ? parseMoney(adv.monthly) : 0;
    if (!amount || amount <= 0 || monthlyRecovery === null) return toast('Check the amounts', 'error');
    setBusy(true);
    try {
      await api(`/employees/${adv.e.id}/advance`, { body: { amount, monthlyRecovery, date: adv.date, accountId: adv.accountId || null } });
      toast(`Advance given to ${adv.e.name}`);
      setAdv(null);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      <Card>
        <Txt v="small">Monthly salaries (active staff)</Txt>
        <Txt style={{ fontWeight: '800', fontSize: 22 }}>{fm(monthly)}</Txt>
      </Card>
      <Row gap={10}>
        <Btn style={{ flex: 1 }} icon="person-add-outline" title="Add employee" onPress={() => setForm(blank)} />
        <Btn style={{ flex: 1 }} kind="secondary" icon="calculator-outline" title="Payroll" onPress={() => router.push('/payroll')} />
      </Row>
      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={list.reload}>
        {(list.data ?? []).length === 0 ? (
          <Empty icon="people-outline" title="No employees yet" hint="Add your staff with their monthly salary or daily wage, then run payroll each month." />
        ) : (
          list.data!.map((e) => (
            <Card key={e.id} label={`Employee ${e.name}`} onPress={() => setForm({ ...e, rate: moneyToInput(e.rate) })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>{e.name}</Txt>
                  <Txt v="small">{[e.designation, e.phone].filter(Boolean).join(' · ') || ' '}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt style={{ fontWeight: '700' }}>
                    {fm(e.rate)} / {e.payType === 'monthly' ? 'month' : 'day'}
                  </Txt>
                  {e.status === 'left' ? <Badge status="cancelled" label="Left" /> : e.advanceDue > 0 ? <Badge status="partially_paid" label={`Advance ${fm(e.advanceDue)}`} /> : null}
                </View>
              </Row>
              {e.status === 'active' && <Btn small kind="ghost" icon="cash-outline" title="Give advance" onPress={() => setAdv({ e, amount: '', monthly: '', date: todayStr(), accountId: '' })} />}
            </Card>
          ))
        )}
      </Loader>
      <Sheet visible={!!form} title={form?.id ? 'Employee' : 'New employee'} onClose={() => setForm(null)}>
        <Field label="Name" value={form?.name ?? ''} onChangeText={(v) => set({ name: v })} autoCapitalize="words" />
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Designation" value={form?.designation ?? ''} onChangeText={(v) => set({ designation: v })} placeholder="e.g. Driver" />
          <Field style={{ flex: 1 }} label="Phone" value={form?.phone ?? ''} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" />
        </Row>
        <Chips
          value={form?.payType ?? 'monthly'}
          onChange={(v) => set({ payType: v })}
          options={[
            { value: 'monthly', label: 'Monthly salary' },
            { value: 'daily', label: 'Daily wage' },
          ]}
        />
        <Field label={form?.payType === 'daily' ? 'Wage per day' : 'Salary per month'} money value={form?.rate ?? ''} onChangeText={(v) => set({ rate: v })} />
        <Field label="CNIC (optional)" value={form?.cnic ?? ''} onChangeText={(v) => set({ cnic: v })} />
        <DateField label="Joining date (optional)" value={form?.joinDate ?? ''} onChange={(v) => set({ joinDate: v })} />
        <Field label="Bank account for salary (optional)" value={form?.bankAccount ?? ''} onChangeText={(v) => set({ bankAccount: v })} />
        {form?.id && (
          <Chips
            value={form.status}
            onChange={(v) => set({ status: v })}
            options={[
              { value: 'active', label: 'Working' },
              { value: 'left', label: 'Left' },
            ]}
          />
        )}
        <Btn title="Save" onPress={save} loading={busy} />
      </Sheet>
      <Sheet visible={!!adv} title={`Advance to ${adv?.e.name ?? ''}`} onClose={() => setAdv(null)}>
        {adv && adv.e.advanceDue > 0 && <KV k="Already owes" v={fm(adv.e.advanceDue)} />}
        <Field label="Amount" money value={adv?.amount ?? ''} onChangeText={(v) => setAdv((a) => a && { ...a, amount: v })} />
        <Field label="Take back each month (optional)" money value={adv?.monthly ?? ''} onChangeText={(v) => setAdv((a) => a && { ...a, monthly: v })} hint="Filled in on each payroll; you can change it there" />
        <DateField label="Date" value={adv?.date ?? todayStr()} onChange={(v) => setAdv((a) => a && { ...a, date: v })} />
        <AccountSelect label="Paid from" accounts={accounts.data ?? []} value={adv?.accountId ?? ''} onChange={(id) => setAdv((a) => a && { ...a, accountId: id })} />
        <Btn title="Give advance" onPress={giveAdvance} loading={busy} />
      </Sheet>
    </Screen>
  );
}
