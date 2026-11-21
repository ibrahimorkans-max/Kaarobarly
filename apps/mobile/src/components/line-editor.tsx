import { useState } from 'react';
import { View } from 'react-native';
import { api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { lineAmount, moneyToInput, parseMoney, parseQty, qtyToString, type Service } from '@/lib/shared';
import { useWorkspace } from '@/lib/workspace';
import { BarcodeScanner } from './scanner';
import { Btn, Card, Field, IconBtn, Row, Select, Sheet, Txt, fm } from './ui';

/** A line on a purchase request, order or goods receipt (quantities in thousandths). */
export interface EditLine {
  itemId: string | null;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  note?: string;
  /** receipts against an order: which order line, and how much is still to receive */
  orderLine?: number;
  maxQty?: number;
}

interface Form {
  index: number;
  itemId: string | null;
  name: string;
  qty: string;
  unit: string;
  price: string;
  note: string;
}

/**
 * Edit a list of item lines: pick from the catalogue, scan a barcode, or type a custom item.
 * `prices` shows the price column (orders, receipts); requests only need quantities.
 */
export function LineEditor({ lines, onChange, prices = true, precision = 2, currency, fixedItems }: { lines: EditLine[]; onChange: (l: EditLine[]) => void; prices?: boolean; precision?: number; currency?: string; fixedItems?: boolean }) {
  const t = useTheme();
  const toast = useToast();
  const { t: term } = useWorkspace();
  const items = useApi<Service[]>('/services?limit=100');
  const [form, setForm] = useState<Form | null>(null);
  const [scan, setScan] = useState(false);
  const active = (items.data ?? []).filter((s) => s.status === 'active');
  const money = (v: number) => fm(v, { currency, currencyPrecision: precision });

  const openFor = (s: Service | null, index = lines.length, typed = '') =>
    setForm({ index, itemId: s?.id ?? null, name: s?.name ?? typed, qty: '1', unit: s?.unit ?? '', price: s ? moneyToInput(s.costPrice || 0, precision) : '', note: '' });

  async function scanned(code: string) {
    try {
      const s = await api<Service>(`/services/by-code/${encodeURIComponent(code)}`);
      const at = lines.findIndex((l) => l.itemId === s.id);
      if (at >= 0) {
        onChange(lines.map((l, i) => (i === at ? { ...l, qty: l.qty + 1000 } : l)));
        toast(`${s.name}: ${qtyToString(lines[at].qty + 1000)}`);
      } else openFor(s);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  function save() {
    if (!form) return;
    const qty = parseQty(form.qty);
    const price = prices ? (form.price.trim() ? parseMoney(form.price, precision) : 0) : 0;
    if (!form.name.trim()) return toast('Enter the item name', 'error');
    if (!qty || qty <= 0) return toast('Enter a quantity above zero', 'error');
    if (price === null || price < 0) return toast('Price is not a valid amount', 'error');
    const old = lines[form.index];
    if (old?.maxQty !== undefined && qty > old.maxQty) return toast(`Only ${qtyToString(old.maxQty)} ${old.unit} still to receive`, 'error');
    const line: EditLine = { ...old, itemId: form.itemId, name: form.name.trim(), qty, unit: form.unit.trim(), unitPrice: price, note: form.note.trim() };
    onChange(form.index < lines.length ? lines.map((l, i) => (i === form.index ? line : l)) : [...lines, line]);
    setForm(null);
  }

  const total = lines.reduce((a, l) => a + lineAmount(l.qty, l.unitPrice), 0);

  return (
    <View style={{ gap: 10 }}>
      {lines.map((l, i) => (
        <Card key={`${l.itemId ?? l.name}-${i}`} label={`Line ${l.name}`} onPress={() => setForm({ index: i, itemId: l.itemId, name: l.name, qty: qtyToString(l.qty), unit: l.unit, price: moneyToInput(l.unitPrice, precision), note: l.note ?? '' })}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt style={{ fontWeight: '700' }}>{l.name}</Txt>
              <Txt v="small">
                {qtyToString(l.qty)} {l.unit}
                {prices ? ` × ${money(l.unitPrice)}` : ''}
                {l.maxQty !== undefined ? ` · ${qtyToString(l.maxQty)} still due` : ''}
                {!l.itemId ? ' · not in catalogue' : ''}
              </Txt>
            </View>
            <Row gap={6}>
              {prices && <Txt style={{ fontWeight: '700' }}>{money(lineAmount(l.qty, l.unitPrice))}</Txt>}
              {<IconBtn icon="trash-outline" label={`Remove ${l.name}`} color={t.danger} onPress={() => onChange(lines.filter((_, k) => k !== i))} />}
            </Row>
          </Row>
        </Card>
      ))}
      {prices && lines.length > 0 && (
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Txt v="sub">Total</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 17 }}>{money(total)}</Txt>
        </Row>
      )}
      {!fixedItems && (
        <>
          <Select<Service>
            label={`Add from ${term('items').toLowerCase()}`}
            value=""
            placeholder={`Choose a ${term('item').toLowerCase()}`}
            items={active}
            getKey={(s) => s.id}
            getLabel={(s) => s.name}
            getSub={(s) => [s.sku, s.barcode, s.onHand !== undefined ? `in stock ${qtyToString(s.onHand)} ${s.unit}` : ''].filter(Boolean).join(' · ')}
            onSelect={(s) => openFor(s)}
            onAdd={(typed) => openFor(null, lines.length, typed)}
            addLabel="Item not in the list"
          />
          <Btn kind="secondary" icon="barcode-outline" title="Scan barcode" onPress={() => setScan(true)} />
        </>
      )}
      <BarcodeScanner visible={scan} onClose={() => setScan(false)} onCode={scanned} />
      <Sheet visible={!!form} title={form && form.index < lines.length ? 'Edit line' : 'Add line'} onClose={() => setForm(null)}>
        <Field label="Item" value={form?.name ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, name: v })} editable={!form?.itemId && !fixedItems} />
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Quantity" money value={form?.qty ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, qty: v })} />
          <Field style={{ flex: 1 }} label="Unit" value={form?.unit ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, unit: v })} placeholder="kg, bag, pcs" editable={!fixedItems} />
        </Row>
        {prices && <Field label="Price per unit" money value={form?.price ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, price: v })} placeholder="0" />}
        <Field label="Note (optional)" value={form?.note ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, note: v })} />
        <Btn title="Done" onPress={save} />
      </Sheet>
    </View>
  );
}

/** Convert API lines (DocLine) into editor lines. */
export const toEditLines = (lines: { itemId: string | null; name: string; qty: number; unit: string; unitPrice: number; note?: string }[]): EditLine[] =>
  lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, note: l.note ?? '' }));
