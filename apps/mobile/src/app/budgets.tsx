import { useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, Chips, Empty, Field, IconBtn, Loader, Progress, Row, Screen, Section, Sheet, Txt, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { EXPENSE_CATEGORIES, moneyToInput, parseMoney, type BudgetReport, type BusinessProfile } from '@/lib/shared';

const shift = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Monthly spending limits per category, against what was actually spent. */
export default function Budgets() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const { data, loading, error, reload, refreshing } = useApi<BudgetReport>(`/budgets?month=${month}`);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const [edit, setEdit] = useState<{ scope: 'default' | 'month'; lines: { category: string; amount: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (v: number) => fm(v, data ?? undefined);

  async function save() {
    if (!edit) return;
    const lines = edit.lines.filter((l) => l.category.trim()).map((l) => ({ category: l.category.trim(), amount: parseMoney(l.amount || '0') ?? -1 }));
    if (lines.some((l) => l.amount < 0)) return toast('Check the amounts', 'error');
    setBusy(true);
    try {
      await api('/budgets', { method: 'PUT', body: { businessId: businesses.data?.[0]?.id, month: edit.scope === 'default' ? 'default' : month, lines } });
      toast('Budget saved');
      setEdit(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const startEdit = () =>
    setEdit({
      scope: 'default',
      lines: data?.lines.length ? data.lines.map((l) => ({ category: l.category, amount: moneyToInput(l.budget) })) : ['Rent', 'Salaries', 'Utilities', 'Fuel & transport'].map((c) => ({ category: c, amount: '' })),
    });

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconBtn icon="chevron-back" label="Previous month" onPress={() => setMonth(shift(month, -1))} />
        <Txt v="h">{label(month)}</Txt>
        <IconBtn icon="chevron-forward" label="Next month" onPress={() => setMonth(shift(month, 1))} />
      </Row>
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Txt v="small">Spent</Txt>
                  <Txt style={{ fontWeight: '800', fontSize: 22, color: data.totalActual > data.totalBudget && data.totalBudget > 0 ? th.danger : th.text }}>{money(data.totalActual)}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt v="small">Budget</Txt>
                  <Txt style={{ fontWeight: '700' }}>{money(data.totalBudget)}</Txt>
                </View>
              </Row>
              {data.totalBudget > 0 && <Progress value={data.totalActual} total={data.totalBudget} word="used" fullIsBad />}
            </Card>
            {can('finance.manage') && <Btn icon="create-outline" kind={data.lines.length ? 'secondary' : 'primary'} title={data.lines.length ? 'Edit budget' : 'Set a budget'} onPress={startEdit} />}
            {data.lines.length === 0 ? (
              <Empty icon="pie-chart-outline" title="No budget yet" hint="Set how much you plan to spend each month on rent, salaries, fuel and the rest." />
            ) : (
              data.lines.map((l) => (
                <Card key={l.category}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt style={{ fontWeight: '700' }}>{l.category}</Txt>
                    <Txt style={{ fontWeight: '700', color: l.remaining < 0 ? th.danger : th.text }}>
                      {money(l.actual)} / {money(l.budget)}
                    </Txt>
                  </Row>
                  <Progress value={Math.min(l.actual, l.budget)} total={l.budget} word="used" fullIsBad />
                  <Txt v="small" color={l.remaining < 0 ? th.danger : undefined}>
                    {l.remaining < 0 ? `${money(-l.remaining)} over budget` : `${money(l.remaining)} left`}
                  </Txt>
                </Card>
              ))
            )}
            {data.unbudgeted.length > 0 && (
              <Section title="Spent without a budget">
                <Card>
                  {data.unbudgeted.map((u) => (
                    <Row key={u.category} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
                      <Txt v="sub">{u.category}</Txt>
                      <Txt>{money(u.actual)}</Txt>
                    </Row>
                  ))}
                </Card>
              </Section>
            )}
          </>
        )}
      </Loader>
      <Sheet visible={!!edit} title="Budget" onClose={() => setEdit(null)}>
        <Chips
          value={edit?.scope ?? 'default'}
          onChange={(v) => setEdit((e) => e && { ...e, scope: v })}
          options={[
            { value: 'default', label: 'Every month' },
            { value: 'month', label: `Only ${label(month)}` },
          ]}
        />
        {edit?.lines.map((l, i) => (
          <Row key={i} gap={8} style={{ alignItems: 'flex-end' }}>
            <Field style={{ flex: 3 }} label="Category" value={l.category} onChangeText={(v) => setEdit((e) => e && { ...e, lines: e.lines.map((x, k) => (k === i ? { ...x, category: v } : x)) })} />
            <Field style={{ flex: 2 }} label="Amount" money value={l.amount} onChangeText={(v) => setEdit((e) => e && { ...e, lines: e.lines.map((x, k) => (k === i ? { ...x, amount: v } : x)) })} />
            <IconBtn icon="close" label="Remove line" onPress={() => setEdit((e) => e && { ...e, lines: e.lines.filter((_, k) => k !== i) })} />
          </Row>
        ))}
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          {EXPENSE_CATEGORIES.filter((c) => !edit?.lines.some((l) => l.category === c)).map((c) => (
            <Btn key={c} small kind="secondary" title={c} onPress={() => setEdit((e) => e && { ...e, lines: [...e.lines, { category: c, amount: '' }] })} />
          ))}
        </Row>
        <Btn title="Save budget" onPress={save} loading={busy} />
      </Sheet>
    </Screen>
  );
}
