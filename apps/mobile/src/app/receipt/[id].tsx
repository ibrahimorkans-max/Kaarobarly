import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { LineEditor, toEditLines, type EditLine } from '@/components/line-editor';
import { Badge, Btn, Card, Chips, DateField, Field, KV, Loading, Row, Screen, Section, Select, Sheet, Txt, addDays, confirm, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { buyingDocHtml, type Paper } from '@/lib/pdf';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, qtyToString, type BusinessProfile, type GoodsReceipt, type InvoiceTemplate, type PaymentMethod, type Purchase, type PurchaseOrder, type Service, type Supplier } from '@/lib/shared';

/** Goods received: what actually arrived. Stock goes up; the bill can be made from it. */
export default function ReceiptScreen() {
  const { id, orderId } = useLocalSearchParams<{ id: string; orderId?: string }>();
  const isNew = id === 'new';
  const toast = useToast();
  const { can } = useAuth();
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const suppliers = useApi<Supplier[]>('/suppliers');
  const existing = useApi<GoodsReceipt>(isNew ? null : `/goods-receipts/${id}`);
  const order = useApi<{ order: PurchaseOrder; supplier: Supplier; business: BusinessProfile }>(isNew && orderId ? `/purchase-orders/${orderId}` : null);
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [lines, setLines] = useState<EditLine[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const [bill, setBill] = useState<{ billNo: string; method: PaymentMethod; credit: boolean; dueDate: string } | null>(null);
  const [viewer, setViewer] = useState(false);
  const items = useApi<Service[]>(isNew ? '/services?limit=100' : null);
  const batchItems = new Set((items.data ?? []).filter((s) => s.trackBatches).map((s) => s.id));
  const setLine = (i: number, p: Partial<EditLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const g = existing.data;
  const business = order.data?.business ?? (businesses.data ?? []).find((b) => b.id === g?.businessId) ?? businesses.data?.[0];
  const precision = business?.currencyPrecision ?? 2;

  useEffect(() => {
    const o = order.data?.order;
    if (!o) return;
    setSupplierId(o.supplierId);
    // everything still due on the order, one line each; edit the quantities that actually came
    setLines(
      o.lines
        .map((l, i) => ({ ...toEditLines([l])[0], orderLine: i, maxQty: l.qty - (l.received ?? 0), qty: l.qty - (l.received ?? 0) }))
        .filter((l) => l.qty > 0),
    );
  }, [order.data]);

  async function save() {
    if (!supplierId) return toast('Choose the supplier', 'error');
    if (!lines.length) return toast('Add at least one item', 'error');
    if (!business) return toast('Add a business profile first', 'error');
    const noExpiry = lines.find((l) => l.itemId && batchItems.has(l.itemId) && !l.expiry);
    if (noExpiry && !(await confirm('No expiry date', `${noExpiry.name} tracks batches but has no expiry date. Save anyway?`, 'Save'))) return;
    setBusy('save');
    try {
      const saved = await api<GoodsReceipt>('/goods-receipts', {
        body: { businessId: business.id, supplierId, orderId: orderId ?? null, date, notes, lines: lines.map(({ maxQty: _m, ...l }) => l) },
      });
      toast(`${saved.number} recorded · stock updated`);
      router.replace({ pathname: '/receipt/[id]', params: { id: saved.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function makeBill() {
    if (!bill || !g) return;
    setBusy('bill');
    try {
      const p = await api<Purchase>(`/goods-receipts/${g.id}/bill`, {
        body: { billNo: bill.billNo, method: bill.method, installments: bill.credit ? [{ dueDate: bill.dueDate, amount: g.total, paid: false }] : [] },
      });
      toast(`Bill ${p.number} saved${bill.credit ? ' · owed to supplier' : ''}`);
      setBill(null);
      router.push({ pathname: '/purchase/[id]', params: { id: p.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!(await confirm('Delete this receipt?', 'The items come back out of stock.', 'Delete'))) return;
    try {
      await api(`/goods-receipts/${id}`, { method: 'DELETE' });
      toast('Receipt deleted');
      router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const supplierRow = (suppliers.data ?? []).find((s) => s.id === (g?.supplierId ?? supplierId));
  const buildDoc = useCallback(
    (paper: Paper, template: InvoiceTemplate) => (g && business ? buyingDocHtml('receipt', { ...g, dueDate: g.date, terms: '', reference: g.orderNumber ? `Order ${g.orderNumber}` : '' }, supplierRow ?? { name: g.supplierName }, business, paper, template) : ''),
    [g, business, supplierRow],
  );

  if (!isNew && !g)
    return (
      <Screen>
        <Loading />
      </Screen>
    );

  if (g)
    return (
      <Screen>
        <Stack.Screen options={{ title: g.number }} />
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="h">{g.number}</Txt>
            <Badge status={g.purchaseId ? 'paid' : 'unpaid'} label={g.purchaseId ? `Billed ${g.purchaseNumber}` : 'Not billed yet'} />
          </Row>
          <KV k="Supplier" v={g.supplierName} />
          <KV k="Received" v={fd(g.date)} />
          {!!g.orderNumber && <KV k="Against order" v={g.orderNumber} />}
          <KV k="Value" v={fm(g.total, g)} bold />
        </Card>
        <Section title="Items received">
          <Card>
            {g.lines.map((l, i) => (
              <KV key={i} k={`${l.name} · ${qtyToString(l.qty)} ${l.unit}`} v={fm(l.amount, g)} />
            ))}
          </Card>
          {!!g.notes && <Txt v="sub">{g.notes}</Txt>}
        </Section>
        <Btn kind="secondary" icon="document-outline" title="View / share PDF" onPress={() => setViewer(true)} />
        <Btn kind="secondary" icon="pricetag-outline" title="Print labels for the received goods" onPress={() => router.push({ pathname: '/labels', params: { receiptId: g.id } })} />
        {g.orderId && <Btn kind="ghost" title="Open purchase order" onPress={() => router.push({ pathname: '/order/[id]', params: { id: g.orderId! } })} />}
        {g.purchaseId ? (
          <Btn icon="receipt-outline" title={`Open bill ${g.purchaseNumber}`} onPress={() => router.push({ pathname: '/purchase/[id]', params: { id: g.purchaseId! } })} />
        ) : (
          <>
            {can('finance.manage') && <Btn icon="receipt-outline" title="Make the bill" onPress={() => setBill({ billNo: '', method: 'cash', credit: true, dueDate: addDays(todayStr(), 30) })} />}
            {can('purchases.manage') && <Btn kind="ghost" title="Delete receipt" onPress={remove} />}
          </>
        )}
        <Sheet visible={!!bill} title="Bill for these goods" onClose={() => setBill(null)}>
          <KV k="Amount" v={fm(g.total, g)} bold />
          <Field label="Supplier's bill no. (optional)" value={bill?.billNo ?? ''} onChangeText={(v) => setBill((b) => b && { ...b, billNo: v })} />
          <Chips
            value={bill?.credit ? 'credit' : 'paid'}
            onChange={(v) => setBill((b) => b && { ...b, credit: v === 'credit' })}
            options={[
              { value: 'credit', label: 'Pay later (owed)' },
              { value: 'paid', label: 'Paid now' },
            ]}
          />
          {bill?.credit ? (
            <DateField label="Due date" value={bill.dueDate} onChange={(v) => setBill((b) => b && { ...b, dueDate: v })} />
          ) : (
            <Chips value={bill?.method ?? 'cash'} onChange={(v) => setBill((b) => b && { ...b, method: v })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
          )}
          <Btn title="Save bill" onPress={makeBill} loading={busy === 'bill'} />
        </Sheet>
        {business && <DocumentViewer visible={viewer} onClose={() => setViewer(false)} title={`Goods received ${g.number}`} fileName={`grn-${g.number}`} build={buildDoc} template={business.invoiceTemplate ?? 'amber'} defaultPaper="A5" />}
      </Screen>
    );

  const fromOrder = !!order.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Goods received' }} />
      {fromOrder ? (
        <Card>
          <KV k="Order" v={order.data!.order.number} />
          <KV k="Supplier" v={order.data!.order.supplierName} />
        </Card>
      ) : (
        <Select<Supplier>
          label="Supplier"
          value={supplierRow?.name ?? ''}
          placeholder="Who delivered it?"
          items={(suppliers.data ?? []).filter((s) => s.status === 'active')}
          getKey={(s) => s.id}
          getLabel={(s) => s.name}
          onSelect={(s) => setSupplierId(s.id)}
          onAdd={async (name) => {
            if (!name) return router.push('/suppliers');
            try {
              const s = await api<Supplier>('/suppliers', { body: { name } });
              suppliers.reload();
              setSupplierId(s.id);
            } catch (e: any) {
              toast(e.message, 'error');
            }
          }}
          addLabel="New supplier"
        />
      )}
      <DateField label="Received on" value={date} onChange={setDate} />
      <Section title={fromOrder ? 'What arrived (change quantities that came short)' : 'What arrived'}>
        <LineEditor lines={lines} onChange={setLines} precision={precision} currency={business?.currency} fixedItems={fromOrder} />
        {fromOrder && lines.length === 0 && <Txt v="sub">Everything on this order has been received.</Txt>}
      </Section>
      {lines.some((l) => l.itemId && batchItems.has(l.itemId)) && (
        <Section title="Batch and expiry">
          {lines.map((l, i) =>
            l.itemId && batchItems.has(l.itemId) ? (
              <Card key={i} style={{ gap: 8 }}>
                <Txt style={{ fontWeight: '700' }}>
                  {l.name} · {qtyToString(l.qty)} {l.unit}
                </Txt>
                <Field label="Batch / lot no." value={l.batch ?? ''} onChangeText={(v) => setLine(i, { batch: v })} autoCapitalize="characters" />
                <DateField label="Expiry date" value={l.expiry ?? ''} onChange={(v) => setLine(i, { expiry: v })} />
              </Card>
            ) : null,
          )}
          <Txt v="small">Sales take the batch that expires first. Expired batches cannot be sold.</Txt>
        </Section>
      )}
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="e.g. 2 bags damaged, vehicle no." />
      <Btn icon="checkmark" title="Save · add to stock" onPress={save} loading={busy === 'save'} disabled={!!busy} />
      <View style={{ height: 20 }} />
    </Screen>
  );
}
