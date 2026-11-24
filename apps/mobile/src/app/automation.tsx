import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Badge, Btn, Card, Chips, Empty, Field, Loader, Row, Screen, Section, Sheet, Txt, confirm, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, moneyToInput, parseMoney } from '@/lib/shared';

type Trigger = 'invoice_overdue' | 'stock_low' | 'cheque_due' | 'bill_due' | 'big_expense' | 'cash_drawer_high' | 'shift_variance';
interface Rule {
  id: string;
  kind: 'categorize' | 'alert';
  name: string;
  enabled: boolean;
  config: any;
}
const TRIGGERS: Record<Trigger, { name: string; days?: string; amount?: boolean }> = {
  invoice_overdue: { name: 'Invoice overdue', days: 'At least this many days late' },
  stock_low: { name: 'Stock at or below reorder level' },
  cheque_due: { name: 'Cheque date coming up', days: 'Days ahead' },
  bill_due: { name: 'Supplier bill due', days: 'Days ahead' },
  big_expense: { name: 'Large money out', amount: true },
  cash_drawer_high: { name: 'Too much cash in the drawer', amount: true },
  shift_variance: { name: 'Drawer short or over at close', amount: true },
};
const describe = (r: Rule) =>
  r.kind === 'categorize'
    ? `${r.config.type === 'expense' ? 'Money out' : 'Money in'} mentioning “${r.config.match}” → ${r.config.category}`
    : `${TRIGGERS[r.config.trigger as Trigger].name}${r.config.days ? ` · ${r.config.days} days` : ''}${r.config.amount ? ` · from ${fm(r.config.amount)}` : ''}`;

interface Form {
  id?: string;
  kind: 'categorize' | 'alert';
  name: string;
  enabled: boolean;
  type: 'expense' | 'income';
  match: string;
  category: string;
  trigger: Trigger;
  days: string;
  amount: string;
}

/** Simple automation: file records by their words, and alerts for things that need attention. */
export default function Automation() {
  const toast = useToast();
  const { can } = useAuth();
  const list = useApi<Rule[]>('/rules');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('businesses.manage');
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const toBody = (f: Form) =>
    f.kind === 'categorize'
      ? { kind: 'categorize', name: f.name.trim(), enabled: f.enabled, config: { type: f.type, match: f.match.trim(), category: f.category } }
      : { kind: 'alert', name: f.name.trim(), enabled: f.enabled, config: { trigger: f.trigger, days: Number(f.days) || 0, amount: f.amount.trim() ? (parseMoney(f.amount) ?? 0) : 0 } };

  async function save(f: Form) {
    setBusy(true);
    try {
      await api(f.id ? `/rules/${f.id}` : '/rules', { method: f.id ? 'PUT' : 'POST', body: toBody(f) });
      setForm(null);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addSuggested() {
    setBusy(true);
    try {
      const rules = await api<any[]>('/rules/suggested');
      for (const r of rules) await api('/rules', { body: r });
      toast(`${rules.length} rules added`);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const edit = (r: Rule) =>
    setForm({
      id: r.id,
      kind: r.kind,
      name: r.name,
      enabled: r.enabled,
      type: r.config.type ?? 'expense',
      match: r.config.match ?? '',
      category: r.config.category ?? 'Other expense',
      trigger: r.config.trigger ?? 'invoice_overdue',
      days: r.config.days ? String(r.config.days) : '',
      amount: r.config.amount ? moneyToInput(r.config.amount) : '',
    });
  const blank: Form = { kind: 'alert', name: '', enabled: true, type: 'expense', match: '', category: 'Fuel & transport', trigger: 'invoice_overdue', days: '7', amount: '' };
  const rules = list.data ?? [];

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      <Txt v="sub">Alerts tell you what needs attention (see Alerts). Filing rules put money out or in that was left as “Other” under the right category.</Txt>
      {canEdit && (
        <Row gap={10}>
          <Btn style={{ flex: 1 }} icon="add" title="New rule" onPress={() => setForm(blank)} />
          {rules.length === 0 && <Btn style={{ flex: 1 }} kind="secondary" icon="flash-outline" title="Add suggested" onPress={addSuggested} loading={busy} />}
        </Row>
      )}
      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={list.reload}>
        {rules.length === 0 ? (
          <Empty icon="flash-outline" title="No rules yet" hint="Start with the suggested set: late invoices, low stock, cheques and bills due, and fuel and electricity filing." />
        ) : (
          (['alert', 'categorize'] as const).map((k) => (
            <Section key={k} title={k === 'alert' ? 'Alerts' : 'Filing rules'}>
              {rules
                .filter((r) => r.kind === k)
                .map((r) => (
                  <Card key={r.id} label={`Rule ${r.name}`} onPress={canEdit ? () => edit(r) : undefined}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Txt style={{ fontWeight: '700' }}>{r.name || (k === 'alert' ? TRIGGERS[r.config.trigger as Trigger].name : 'Filing rule')}</Txt>
                        <Txt v="small">{describe(r)}</Txt>
                      </View>
                      {!r.enabled && <Badge status="cancelled" label="Off" />}
                    </Row>
                  </Card>
                ))}
            </Section>
          ))
        )}
      </Loader>
      <Sheet visible={!!form} title={form?.id ? 'Edit rule' : 'New rule'} onClose={() => setForm(null)}>
        {form && (
          <>
            {!form.id && (
              <Chips
                value={form.kind}
                onChange={(v) => set({ kind: v })}
                options={[
                  { value: 'alert', label: 'Alert me' },
                  { value: 'categorize', label: 'File records' },
                ]}
              />
            )}
            <Field label="Name (optional)" value={form.name} onChangeText={(v) => set({ name: v })} />
            {form.kind === 'alert' ? (
              <>
                <Chips value={form.trigger} onChange={(v) => set({ trigger: v })} options={(Object.keys(TRIGGERS) as Trigger[]).map((t) => ({ value: t, label: TRIGGERS[t].name }))} />
                {TRIGGERS[form.trigger].days && <Field label={TRIGGERS[form.trigger].days!} money value={form.days} onChangeText={(v) => set({ days: v })} />}
                {TRIGGERS[form.trigger].amount && <Field label="Amount from" money value={form.amount} onChangeText={(v) => set({ amount: v })} />}
              </>
            ) : (
              <>
                <Chips
                  value={form.type}
                  onChange={(v) => set({ type: v, category: v === 'expense' ? 'Fuel & transport' : 'Sales' })}
                  options={[
                    { value: 'expense', label: 'Money out' },
                    { value: 'income', label: 'Money in' },
                  ]}
                />
                <Field label="When the party or note mentions" value={form.match} onChangeText={(v) => set({ match: v })} placeholder="e.g. petrol, PSO, K-Electric" autoCapitalize="none" />
                <Txt v="label">File it under</Txt>
                <Chips value={form.category} onChange={(v) => set({ category: v })} options={(form.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map((c) => ({ value: c, label: c }))} />
                <Txt v="small">Applied when a record is saved under “Other”. A category you choose yourself is kept.</Txt>
              </>
            )}
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt>On</Txt>
              <Switch accessibilityLabel="Rule on" value={form.enabled} onValueChange={(v) => set({ enabled: v })} />
            </Row>
            <Btn title="Save rule" onPress={() => save(form)} loading={busy} />
            {form.id && (
              <Btn
                kind="danger"
                title="Delete rule"
                onPress={async () => {
                  if (!(await confirm('Delete rule?', 'It stops at once.', 'Delete'))) return;
                  await api(`/rules/${form.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
                  setForm(null);
                  list.reload();
                }}
              />
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}
