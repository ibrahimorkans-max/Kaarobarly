import { Stack } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { CustomFieldInputs } from '@/components/custom-fields';
import { BarcodeScanner } from '@/components/scanner';
import { Badge, Btn, Card, Chips, Empty, Field, IconBtn, Loader, Row, Screen, SearchBar, Sheet, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney, parsePercent, parseQty, percentToString, qtyToString, type CustomValues, type Service } from '@/lib/shared';
import { lower, useWorkspace } from '@/lib/workspace';

interface Form {
  id?: string;
  name: string;
  category: string;
  description: string;
  price: string;
  unit: string;
  tax: string;
  discount: string;
  status: 'active' | 'inactive';
  itemType: string;
  custom: CustomValues;
  trackStock: boolean;
  sku: string;
  barcode: string;
  cost: string;
  reorder: string;
}
const blank: Form = { name: '', category: '', description: '', price: '', unit: '', tax: '', discount: '', status: 'active', itemType: '', custom: {}, trackStock: false, sku: '', barcode: '', cost: '', reorder: '' };
const EXAMPLES = ['Software Development', 'Consultancy', 'Laboratory Testing', 'Weighbridge Services', 'Transportation', 'Installation', 'Maintenance', 'Technical Support'];

export default function Services() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<Service[]>('/services');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('invoices.create');
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const { t, ws, on } = useWorkspace();
  const [scan, setScan] = useState(false);
  const [kind, setKind] = useState('');

  const needle = q.trim().toLowerCase();
  const shown = (data ?? []).filter((s) => (!kind || s.itemType === kind) && (!needle || `${s.name} ${s.category} ${s.itemType}`.toLowerCase().includes(needle)));

  const edit = (s: Service) =>
    setForm({
      id: s.id,
      name: s.name,
      category: s.category,
      description: s.description,
      price: moneyToInput(s.defaultPrice),
      unit: s.unit,
      tax: s.taxRateBp ? percentToString(s.taxRateBp) : '',
      discount: s.defaultDiscountBp ? percentToString(s.defaultDiscountBp) : '',
      status: s.status,
      itemType: s.itemType,
      custom: s.custom ?? {},
      trackStock: s.trackStock,
      sku: s.sku,
      barcode: s.barcode,
      cost: s.costPrice ? moneyToInput(s.costPrice) : '',
      reorder: s.reorderLevel ? qtyToString(s.reorderLevel) : '',
    });

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return toast(`Enter the ${lower(t('item'))} name`, 'error');
    const tax = form.tax.trim() ? parsePercent(form.tax) : 0;
    const discount = form.discount.trim() ? parsePercent(form.discount) : 0;
    const price = form.price.trim() ? parseMoney(form.price) : 0;
    if (price === null || price < 0) return toast('Default price is not a valid amount', 'error');
    if (tax === null || tax < 0 || tax > 10000 || discount === null || discount < 0 || discount > 10000) return toast('Tax and discount must be between 0 and 100%', 'error');
    setBusy(true);
    try {
      const costPrice = form.cost.trim() ? parseMoney(form.cost) : 0;
      const reorderLevel = form.reorder.trim() ? parseQty(form.reorder) : 0;
      if (costPrice === null || costPrice < 0) throw new Error('Cost price is not a valid amount');
      if (reorderLevel === null || reorderLevel < 0) throw new Error('Reorder level is not a valid quantity');
      const body = { trackStock: form.trackStock, sku: form.sku.trim(), barcode: form.barcode.trim(), costPrice, reorderLevel, name: form.name.trim(), category: form.category.trim(), description: form.description.trim(), defaultPrice: price, unit: form.unit.trim(), taxRateBp: tax, defaultDiscountBp: discount, status: form.status, itemType: form.itemType, custom: form.custom };
      await api(form.id ? `/services/${form.id}` : '/services', { method: form.id ? 'PUT' : 'POST', body });
      toast(form.id ? `${t('item')} updated` : `${t('item')} added`);
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: t('items') }} />
      <SearchBar value={q} onChange={setQ} placeholder={`Search ${lower(t('items'))}`} />
      {ws.itemTypes.length > 1 && <Chips value={kind} onChange={setKind} options={[{ value: '', label: 'All' }, ...ws.itemTypes.map((x) => ({ value: x, label: x }))]} />}
      {canEdit && <Btn icon="add" title={`Add ${lower(t('item'))}`} onPress={() => setForm({ ...blank, itemType: kind || ws.itemTypes[0] || '' })} />}
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {shown.length === 0 ? (
          <Empty icon="pricetags-outline" title={needle || kind ? 'Nothing matches' : `No ${lower(t('items'))} yet`} hint={needle ? undefined : `Add anything you bill for: ${EXAMPLES.slice(0, 4).join(', ')} and more.`} />
        ) : (
          shown.map((s) => (
            <Card key={s.id} onPress={canEdit ? () => edit(s) : undefined} label={`Service ${s.name}`}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontWeight: '700' }}>{s.name}</Txt>
                  <Txt v="small">
                    {[s.itemType, s.category, s.taxRateBp ? `tax ${percentToString(s.taxRateBp)}%` : '', s.defaultDiscountBp ? `discount ${percentToString(s.defaultDiscountBp)}%` : ''].filter(Boolean).join(' · ') || 'No category'}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt style={{ fontWeight: '700' }}>
                    {fm(s.defaultPrice)}
                    {s.unit ? ` / ${s.unit}` : ''}
                  </Txt>
                  {s.onHand !== undefined && <Txt v="small">in stock {qtyToString(s.onHand)}</Txt>}
                  {s.status === 'inactive' && <Badge status="inactive" />}
                </View>
              </Row>
            </Card>
          ))
        )}
      </Loader>

      <Sheet visible={!!form} title={form?.id ? `Edit ${lower(t('item'))}` : `New ${lower(t('item'))}`} onClose={() => setForm(null)}>
        <Field label="Name" value={form?.name ?? ''} onChangeText={(v) => set({ name: v })} placeholder="e.g. Laboratory Testing" />
        {ws.itemTypes.length > 1 && <Chips value={form?.itemType ?? ''} onChange={(v) => set({ itemType: v })} options={ws.itemTypes.map((x) => ({ value: x, label: x }))} />}
        <Field label="Category" value={form?.category ?? ''} onChangeText={(v) => set({ category: v })} />
        <Field label="Description" value={form?.description ?? ''} onChangeText={(v) => set({ description: v })} multiline />
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Default price" money placeholder="0" value={form?.price ?? ''} onChangeText={(v) => set({ price: v })} />
          <Field style={{ flex: 1 }} label="Unit" placeholder="hour, kg, trip" value={form?.unit ?? ''} onChangeText={(v) => set({ unit: v })} autoCapitalize="none" />
        </Row>
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Tax %" money placeholder="0" value={form?.tax ?? ''} onChangeText={(v) => set({ tax: v })} />
          <Field style={{ flex: 1 }} label="Default discount %" money placeholder="0" value={form?.discount ?? ''} onChangeText={(v) => set({ discount: v })} />
        </Row>
        {on('inventory') && (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '600' }}>Keep stock</Txt>
                <Txt v="small">Count it in and out: purchases add, finalized {lower(t('invoices'))} remove</Txt>
              </View>
              <Switch accessibilityLabel="Keep stock" value={!!form?.trackStock} onValueChange={(v) => set({ trackStock: v })} />
            </Row>
            <Row gap={10} style={{ alignItems: 'flex-end' }}>
              <Field style={{ flex: 1 }} label="SKU / code" value={form?.sku ?? ''} onChangeText={(v) => set({ sku: v })} autoCapitalize="characters" />
              <Field style={{ flex: 1 }} label="Barcode" value={form?.barcode ?? ''} onChangeText={(v) => set({ barcode: v })} autoCapitalize="none" right={<IconBtn icon="barcode-outline" label="Scan barcode" onPress={() => setScan(true)} />} />
            </Row>
            {form?.trackStock && (
              <Row gap={10} style={{ alignItems: 'flex-start' }}>
                <Field style={{ flex: 1 }} label="Cost price" money placeholder="0" value={form?.cost ?? ''} onChangeText={(v) => set({ cost: v })} />
                <Field style={{ flex: 1 }} label="Reorder at (qty)" money placeholder="0" value={form?.reorder ?? ''} onChangeText={(v) => set({ reorder: v })} />
              </Row>
            )}
          </>
        )}
        <CustomFieldInputs entity="item" values={form?.custom ?? {}} onChange={(custom) => set({ custom })} />
        <Chips
          value={form?.status ?? 'active'}
          onChange={(v) => set({ status: v })}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
        <Btn title="Save" onPress={save} loading={busy} />
      </Sheet>
      <BarcodeScanner visible={scan} onClose={() => setScan(false)} onCode={(code) => set({ barcode: code })} />
    </Screen>
  );
}
