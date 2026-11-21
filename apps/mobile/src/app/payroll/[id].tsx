import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { AccountSelect } from '@/components/money';
import { Badge, Btn, Card, DateField, Field, KV, Loader, Row, Screen, Section, Sheet, Txt, confirm, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { payslipHtml, type Paper } from '@/lib/pdf';
import { RUN_STATUS_LABELS, computeSlip, moneyToInput, parseMoney, type BusinessProfile, type MoneyAccount, type PayrollRun, type Payslip } from '@/lib/shared';

const TONE: Record<string, string> = { draft: 'draft', submitted: 'partially_paid', approved: 'unpaid', paid: 'paid' };
type SlipForm = { slip: Payslip; days: string; overtime: string; allowances: string; bonus: string; deductions: string; tax: string; advanceRecovery: string; notes: string };

export default function PayrollRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const { can } = useAuth();
  const { data: run, loading, error, reload, refreshing, setData } = useApi<PayrollRun>(`/payroll/${id}`);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const [form, setForm] = useState<SlipForm | null>(null);
  const [pay, setPay] = useState<{ date: string; accountId: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<Payslip | null>(null);
  const business = businesses.data?.find((b) => b.id === run?.businessId);
  const m = (v: number) => fm(v, run ?? undefined);
  const p = run?.currencyPrecision ?? 2;
  const editable = run?.status === 'draft' && can('payroll.manage');

  const n = (s: string) => (s.trim() ? parseMoney(s, p) : 0);
  const preview = form
    ? computeSlip({ payType: form.slip.payType, rate: form.slip.rate, days: Number(form.days) || 0, daysInMonth: form.slip.daysInMonth, overtime: n(form.overtime) ?? 0, allowances: n(form.allowances) ?? 0, bonus: n(form.bonus) ?? 0, deductions: n(form.deductions) ?? 0, tax: n(form.tax) ?? 0, advanceRecovery: n(form.advanceRecovery) ?? 0 })
    : null;

  async function saveSlip() {
    if (!form) return;
    const vals = [form.overtime, form.allowances, form.bonus, form.deductions, form.tax, form.advanceRecovery].map(n);
    if (vals.some((v) => v === null || v! < 0) || !(Number(form.days) >= 0)) return toast('Check the numbers', 'error');
    const [overtime, allowances, bonus, deductions, tax, advanceRecovery] = vals as number[];
    setBusy('slip');
    try {
      const updated = await api<PayrollRun>(`/payroll/${id}/slips/${form.slip.id}`, { method: 'PUT', body: { days: Number(form.days), overtime, allowances, bonus, deductions, tax, advanceRecovery, notes: form.notes } });
      setData(updated);
      setForm(null);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function move(status: 'submitted' | 'approved' | 'draft') {
    setBusy(status);
    try {
      setData(await api<PayrollRun>(`/payroll/${id}/status`, { body: { status } }));
      toast(status === 'submitted' ? 'Sent for approval' : status === 'approved' ? 'Payroll approved' : 'Back to draft');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function payNow() {
    if (!pay || !run) return;
    if (!(await confirm('Pay salaries?', `${m(run.net)} goes out to ${run.slips.length} people. Advances recovered are put back against each advance.`, 'Pay'))) return;
    setBusy('pay');
    try {
      setData(await api<PayrollRun>(`/payroll/${id}/pay`, { body: { date: pay.date, accountId: pay.accountId || null } }));
      setPay(null);
      toast('Payroll paid');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!(await confirm('Delete this payroll?', 'All its payslips are removed.', 'Delete'))) return;
    try {
      await api(`/payroll/${id}`, { method: 'DELETE' });
      router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const buildSlip = useCallback((paper: Paper) => (view && run && business ? payslipHtml(view, run, business, paper) : ''), [view, run, business]);

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: run ? `Payroll ${run.month}` : 'Payroll' }} />
      <Loader loading={loading && !run} error={run ? '' : error} onRetry={reload}>
        {run && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="h">{new Date(`${run.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</Txt>
                <Badge status={TONE[run.status]} label={RUN_STATUS_LABELS[run.status]} />
              </Row>
              <KV k="To pay (net)" v={m(run.net)} bold />
              <KV k="Salary cost (incl. advances recovered)" v={m(run.gross)} />
              {!!run.approvedByName && <KV k="Approved by" v={run.approvedByName} />}
              {run.paidDate && <KV k="Paid on" v={fd(run.paidDate)} />}
            </Card>
            {run.status === 'draft' && can('payroll.manage') && <Btn icon="send-outline" title="Send for approval" onPress={() => move('submitted')} loading={busy === 'submitted'} />}
            {run.status === 'submitted' && can('approvals.decide') && (
              <Row gap={10}>
                <Btn style={{ flex: 1 }} kind="secondary" title="Send back" onPress={() => move('draft')} loading={busy === 'draft'} />
                <Btn style={{ flex: 2 }} icon="checkmark" title="Approve" onPress={() => move('approved')} loading={busy === 'approved'} />
              </Row>
            )}
            {run.status === 'approved' && can('payroll.manage') && <Btn icon="cash-outline" title="Pay salaries" onPress={() => setPay({ date: todayStr(), accountId: '' })} />}
            {run.status === 'submitted' && !can('approvals.decide') && <Txt v="sub">Waiting for a manager to approve.</Txt>}
            <Section title="Payslips">
              {run.slips.map((s) => (
                <Card
                  key={s.id}
                  label={`Payslip ${s.employeeName}`}
                  onPress={() =>
                    editable
                      ? setForm({ slip: s, days: String(s.days), overtime: s.overtime ? moneyToInput(s.overtime, p) : '', allowances: s.allowances ? moneyToInput(s.allowances, p) : '', bonus: s.bonus ? moneyToInput(s.bonus, p) : '', deductions: s.deductions ? moneyToInput(s.deductions, p) : '', tax: s.tax ? moneyToInput(s.tax, p) : '', advanceRecovery: s.advanceRecovery ? moneyToInput(s.advanceRecovery, p) : '', notes: s.notes })
                      : setView(s)
                  }>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }}>{s.employeeName}</Txt>
                      <Txt v="small">
                        {s.payType === 'monthly' ? `${s.days}/${s.daysInMonth} days` : `${s.days} days × ${m(s.rate)}`}
                        {s.bonus ? ` · bonus ${m(s.bonus)}` : ''}
                        {s.advanceRecovery ? ` · advance −${m(s.advanceRecovery)}` : ''}
                      </Txt>
                    </View>
                    <Txt style={{ fontWeight: '800' }}>{m(s.net)}</Txt>
                  </Row>
                  {!editable && <Btn small kind="ghost" icon="document-outline" title="Payslip PDF" onPress={() => setView(s)} />}
                </Card>
              ))}
            </Section>
            {run.status !== 'paid' && can('payroll.manage') && <Btn kind="ghost" title="Delete payroll" onPress={remove} />}
          </>
        )}
      </Loader>
      <Sheet visible={!!form} title={form?.slip.employeeName ?? ''} onClose={() => setForm(null)}>
        {form && (
          <>
            <Field label={form.slip.payType === 'monthly' ? `Days worked (of ${form.slip.daysInMonth})` : 'Days worked'} money value={form.days} onChangeText={(v) => setForm({ ...form, days: v })} />
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <Field style={{ flex: 1 }} label="Overtime" money value={form.overtime} onChangeText={(v) => setForm({ ...form, overtime: v })} placeholder="0" />
              <Field style={{ flex: 1 }} label="Allowances" money value={form.allowances} onChangeText={(v) => setForm({ ...form, allowances: v })} placeholder="0" />
            </Row>
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <Field style={{ flex: 1 }} label="Bonus" money value={form.bonus} onChangeText={(v) => setForm({ ...form, bonus: v })} placeholder="0" />
              <Field style={{ flex: 1 }} label="Deductions" money value={form.deductions} onChangeText={(v) => setForm({ ...form, deductions: v })} placeholder="0" />
            </Row>
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <Field style={{ flex: 1 }} label="Income tax" money value={form.tax} onChangeText={(v) => setForm({ ...form, tax: v })} placeholder="0" />
              <Field style={{ flex: 1 }} label="Advance recovery" money value={form.advanceRecovery} onChangeText={(v) => setForm({ ...form, advanceRecovery: v })} placeholder="0" />
            </Row>
            <Field label="Note on payslip (optional)" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} />
            {preview && <KV k="Net pay" v={m(preview.net)} bold />}
            <Btn title="Save payslip" onPress={saveSlip} loading={busy === 'slip'} />
          </>
        )}
      </Sheet>
      <Sheet visible={!!pay} title="Pay salaries" onClose={() => setPay(null)}>
        {run && <KV k="Total to pay" v={m(run.net)} bold />}
        <DateField label="Paid on" value={pay?.date ?? todayStr()} onChange={(v) => setPay((x) => x && { ...x, date: v })} />
        <AccountSelect label="Paid from" accounts={accounts.data ?? []} value={pay?.accountId ?? ''} onChange={(acc) => setPay((x) => x && { ...x, accountId: acc })} />
        <Btn title="Pay" onPress={payNow} loading={busy === 'pay'} />
      </Sheet>
      {view && run && business && <DocumentViewer visible={!!view} onClose={() => setView(null)} title={`Payslip · ${view.employeeName}`} fileName={`payslip-${run.month}-${view.employeeName.replace(/\s+/g, '-')}`} build={buildSlip} template={business.invoiceTemplate} defaultPaper="A5" />}
    </Screen>
  );
}
