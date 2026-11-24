import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Badge, Btn, Card, Chips, DateField, Empty, Field, Loader, Row, Screen, Select, Sheet, Txt, confirm, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { PROMOTION_KIND_LABELS, moneyToInput, parseMoney, parsePercent, parseQty, percentToString, qtyToString, type Promotion, type PromotionKind, type Service } from '@/lib/shared';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Form = Omit<Promotion, 'id' | 'percentBp' | 'buyQty' | 'getQty' | 'bundlePrice' | 'minSpend'> & { id?: string; percent: string; buy: string; get: string; bundle: string; min: string };
const blank: Form = { name: '', kind: 'percent', itemIds: [], categories: [], percent: '', buy: '2', get: '1', bundle: '', min: '', coupon: '', startDate: '', endDate: '', fromTime: '', toTime: '', days: [], membersOnly: false, active: true };

function summary(p: Promotion, names: Map<string, string>) {
  const what = [...p.itemIds.map((id) => names.get(id) ?? 'item'), ...p.categories].join(', ') || 'everything';
  const s =
    p.kind === 'percent' ? `${percentToString(p.percentBp)}% off ${what}` : p.kind === 'buy_get' ? `Buy ${qtyToString(p.buyQty)} get ${qtyToString(p.getQty)} free · ${what}` : p.kind === 'bundle' ? `${what} together for ${fm(p.bundlePrice)}` : `${percentToString(p.percentBp)}% off bills over ${fm(p.minSpend)}`;
  const when = [p.fromTime && `${p.fromTime}–${p.toTime}`, p.days.length ? p.days.map((d) => DAYS[d]).join(' ') : '', p.startDate && `from ${p.startDate}`, p.endDate && `until ${p.endDate}`].filter(Boolean).join(' · ');
  return [s, when, p.coupon && `code ${p.coupon}`, p.membersOnly && 'members only'].filter(Boolean).join(' · ');
}

/** Offers that apply by themselves at the counter: percent off, buy X get Y, bundles, bill coupons, happy hours. */
export default function PromotionsScreen() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi<Promotion[]>('/promotions');
  const items = useApi<Service[]>('/services?limit=100');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const names = new Map((items.data ?? []).map((s) => [s.id, s.name]));
  const cats = [...new Set((items.data ?? []).map((s) => s.category).filter(Boolean))];
  const set = (p: Partial<Form>) => setForm((f) => f && { ...f, ...p });

  const edit = (p: Promotion) => setForm({ ...p, percent: p.percentBp ? percentToString(p.percentBp) : '', buy: qtyToString(p.buyQty || 2000), get: qtyToString(p.getQty || 1000), bundle: p.bundlePrice ? moneyToInput(p.bundlePrice) : '', min: p.minSpend ? moneyToInput(p.minSpend) : '' });

  async function save() {
    if (!form) return;
    const { id, percent, buy, get, bundle, min, ...rest } = form;
    const body = { ...rest, percentBp: percent ? (parsePercent(percent) ?? 0) : 0, buyQty: parseQty(buy) ?? 0, getQty: parseQty(get) ?? 0, bundlePrice: bundle ? (parseMoney(bundle) ?? 0) : 0, minSpend: min ? (parseMoney(min) ?? 0) : 0 };
    setBusy(true);
    try {
      await api(id ? `/promotions/${id}` : '/promotions', { method: id ? 'PUT' : 'POST', body });
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!form?.id || !(await confirm('Delete this promotion?', 'Past bills keep their discounts.', 'Delete'))) return;
    await api(`/promotions/${form.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
    setForm(null);
    reload();
  }

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Promotions' }} />
      {can('pos.manage') && <Btn icon="add" title="New promotion" onPress={() => setForm({ ...blank })} />}
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {(data ?? []).length === 0 ? (
          <Empty icon="pricetags-outline" title="No promotions" hint="Happy hour, buy 2 get 1, bundles and coupon codes apply by themselves at the counter." />
        ) : (
          data!.map((p) => (
            <Card key={p.id} label={p.name} onPress={can('pos.manage') ? () => edit(p) : undefined}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontWeight: '700' }}>{p.name}</Txt>
                  <Txt v="small">{summary(p, names)}</Txt>
                </View>
                <Badge status={p.active ? 'paid' : 'cancelled'} label={p.active ? 'On' : 'Off'} />
              </Row>
            </Card>
          ))
        )}
      </Loader>
      <Sheet visible={!!form} title={form?.id ? 'Edit promotion' : 'New promotion'} onClose={() => setForm(null)}>
        {form && (
          <>
            <Field label="Name" value={form.name} onChangeText={(v) => set({ name: v })} placeholder="Happy hour, Eid deal…" />
            <Select<{ k: PromotionKind; l: string }> label="Type" placeholder="Choose" value={PROMOTION_KIND_LABELS[form.kind]} items={(Object.keys(PROMOTION_KIND_LABELS) as PromotionKind[]).map((k) => ({ k, l: PROMOTION_KIND_LABELS[k] }))} getKey={(x) => x.k} getLabel={(x) => x.l} onSelect={(x) => set({ kind: x.k })} />
            {(form.kind === 'percent' || form.kind === 'bill') && <Field label="Percent off" money value={form.percent} onChangeText={(v) => set({ percent: v })} />}
            {form.kind === 'bill' && <Field label="Minimum bill" money value={form.min} onChangeText={(v) => set({ min: v })} placeholder="0" />}
            {form.kind === 'buy_get' && (
              <Row gap={10}>
                <Field style={{ flex: 1 }} label="Buy" money value={form.buy} onChangeText={(v) => set({ buy: v })} />
                <Field style={{ flex: 1 }} label="Get free" money value={form.get} onChangeText={(v) => set({ get: v })} />
              </Row>
            )}
            {form.kind === 'bundle' && <Field label="Bundle price (one of each item)" money value={form.bundle} onChangeText={(v) => set({ bundle: v })} />}
            {form.kind !== 'bill' && (
              <>
                <Select<Service> label={form.kind === 'bundle' ? 'Add an item to the bundle' : 'Add an item (optional)'} placeholder="Choose item" value="" items={(items.data ?? []).filter((s) => s.status === 'active' && !form.itemIds.includes(s.id))} getKey={(s) => s.id} getLabel={(s) => s.name} getSub={(s) => fm(s.defaultPrice)} onSelect={(s) => set({ itemIds: [...form.itemIds, s.id] })} />
                {form.itemIds.map((id) => (
                  <Row key={id} style={{ justifyContent: 'space-between' }}>
                    <Txt>{names.get(id) ?? 'Item'}</Txt>
                    <Btn small kind="ghost" title="Remove" onPress={() => set({ itemIds: form.itemIds.filter((x) => x !== id) })} />
                  </Row>
                ))}
                {form.kind === 'percent' && cats.length > 0 && (
                  <>
                    <Txt v="label">Or whole categories</Txt>
                    <Row gap={6} style={{ flexWrap: 'wrap' }}>
                      {cats.map((c) => {
                        const onIt = form.categories.includes(c);
                        return <Btn key={c} small kind={onIt ? 'primary' : 'secondary'} title={c} onPress={() => set({ categories: onIt ? form.categories.filter((x) => x !== c) : [...form.categories, c] })} />;
                      })}
                    </Row>
                    <Txt v="small">No items or categories = everything.</Txt>
                  </>
                )}
              </>
            )}
            <Field label="Coupon code (optional)" value={form.coupon} onChangeText={(v) => set({ coupon: v.toUpperCase() })} autoCapitalize="characters" hint="Leave empty to apply automatically" />
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <DateField label="Starts" value={form.startDate} onChange={(v) => set({ startDate: v })} />
              </View>
              <View style={{ flex: 1 }}>
                <DateField label="Ends" value={form.endDate} onChange={(v) => set({ endDate: v })} />
              </View>
            </Row>
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <Field style={{ flex: 1 }} label="From (HH:MM)" value={form.fromTime} onChangeText={(v) => set({ fromTime: v })} placeholder="17:00" />
              <Field style={{ flex: 1 }} label="To (HH:MM)" value={form.toTime} onChangeText={(v) => set({ toTime: v })} placeholder="19:00" />
            </Row>
            <Txt v="label">Days (none = every day)</Txt>
            <Row gap={4} style={{ flexWrap: 'wrap' }}>
              {DAYS.map((d, i) => {
                const onIt = form.days.includes(i);
                return (
                  <Pressable key={d} accessibilityRole="checkbox" accessibilityState={{ checked: onIt }} onPress={() => set({ days: onIt ? form.days.filter((x) => x !== i) : [...form.days, i] })} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: onIt ? th.primary : th.input }}>
                    <Txt style={{ color: onIt ? '#fff' : th.text, fontWeight: '700' }}>{d}</Txt>
                  </Pressable>
                );
              })}
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt>Loyalty members only</Txt>
              <Switch accessibilityLabel="Members only" value={form.membersOnly} onValueChange={(v) => set({ membersOnly: v })} />
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt>Active</Txt>
              <Switch accessibilityLabel="Active" value={form.active} onValueChange={(v) => set({ active: v })} />
            </Row>
            <Btn icon="checkmark" title="Save" onPress={save} loading={busy} />
            {form.id && <Btn kind="ghost" title="Delete" onPress={remove} />}
            <Row gap={6}>
              <Ionicons name="information-circle-outline" size={16} color={th.sub} />
              <Txt v="small" style={{ flex: 1 }}>
                Each line takes its best offer; a bill coupon applies on top. Cashiers can sell with promotions without a manager.
              </Txt>
            </Row>
          </>
        )}
      </Sheet>
    </Screen>
  );
}
