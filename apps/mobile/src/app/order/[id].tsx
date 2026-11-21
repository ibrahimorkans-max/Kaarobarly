import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { LineEditor, toEditLines, type EditLine } from '@/components/line-editor';
import { Badge, Btn, Card, DateField, Field, KV, Loading, Row, Screen, Section, Select, Txt, addDays, confirm, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { buyingDocHtml, type Paper } from '@/lib/pdf';
import { ORDER_STATUS_LABELS, qtyToString, type BusinessProfile, type GoodsReceipt, type InvoiceTemplate, type PurchaseOrder, type PurchaseRequest, type Supplier } from '@/lib/shared';

const TONE: Record<string, string> = { draft: 'draft', sent: 'unpaid', partial: 'partially_paid', received: 'paid', closed: 'paid', cancelled: 'cancelled' };

/** A purchase order: write it (optionally from an approved request), send it, receive against it. */
export default function OrderScreen() {
  const { id, requestId } = useLocalSearchParams<{ id: string; requestId?: string }>();
  const isNew = id === 'new';
  const toast = useToast();
  const { can } = useAuth();
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const suppliers = useApi<Supplier[]>('/suppliers');
  const existing = useApi<{ order: PurchaseOrder; supplier: Supplier; business: BusinessProfile; receipts: GoodsReceipt[] }>(isNew ? null : `/purchase-orders/${id}`);
  const fromRequest = useApi<PurchaseRequest>(isNew && requestId ? `/purchase-requests/${requestId}` : null);
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<EditLine[]>([]);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState('');
  const [viewer, setViewer] = useState(false);
  const o = existing.data?.order;
  const business = existing.data?.business ?? businesses.data?.[0];
  const editable = isNew || o?.status === 'draft';
  const precision = business?.currencyPrecision ?? 2;

  useEffect(() => {
    if (o) {
      setSupplierId(o.supplierId);
      setDate(o.date);
      setExpected(o.expectedDate);
      setLines(toEditLines(o.lines));
      setNotes(o.notes);
      setTerms(o.terms);
    }
  }, [o]);
  useEffect(() => {
    if (fromRequest.data) {
      setLines(toEditLines(fromRequest.data.lines));
      setNotes(fromRequest.data.notes ? `For ${fromRequest.data.number}: ${fromRequest.data.notes}` : `For ${fromRequest.data.number}`);
    }
  }, [fromRequest.data]);

  async function addSupplier(name: string) {
    if (!name) return router.push('/suppliers');
    try {
      const s = await api<Supplier>('/suppliers', { body: { name } });
      suppliers.reload();
      setSupplierId(s.id);
      toast(`${s.name} added to suppliers`);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function save() {
    if (!supplierId) return toast('Choose a supplier', 'error');
    if (!lines.length) return toast('Add at least one item', 'error');
    if (!business) return toast('Add a business profile first', 'error');
    setBusy('save');
    try {
      const body = { businessId: business.id, supplierId, requestId: isNew ? (requestId ?? null) : (o?.requestId ?? null), date, expectedDate: expected, notes, terms, lines: lines.map(({ maxQty: _m, orderLine: _o, ...l }) => l) };
      const saved = await api<PurchaseOrder>(isNew ? '/purchase-orders' : `/purchase-orders/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(isNew ? `${saved.number} saved as draft` : 'Order updated');
      if (isNew) router.replace({ pathname: '/order/[id]', params: { id: saved.id } });
      else existing.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function setStatus(status: 'sent' | 'cancelled' | 'closed') {
    if (status !== 'sent' && !(await confirm(status === 'cancelled' ? 'Cancel this order?' : 'Close this order?', status === 'cancelled' ? 'The supplier should not deliver it any more.' : 'Nothing more will be received against it.', status === 'cancelled' ? 'Cancel order' : 'Close order'))) return;
    setBusy(status);
    try {
      await api(`/purchase-orders/${id}/status`, { body: { status } });
      toast(status === 'sent' ? 'Marked as sent' : status === 'cancelled' ? 'Order cancelled' : 'Order closed');
      existing.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!(await confirm('Delete draft order?', 'It has not been sent, so nothing else changes.', 'Delete'))) return;
    try {
      await api(`/purchase-orders/${id}`, { method: 'DELETE' });
      toast('Order deleted');
      router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const buildDoc = useCallback(
    (paper: Paper, template: InvoiceTemplate) => (o && existing.data ? buyingDocHtml('order', { ...o, dueDate: o.expectedDate }, existing.data.supplier, existing.data.business, paper, template) : ''),
    [o, existing.data],
  );

  if (!isNew && !o)
    return (
      <Screen>
        <Loading />
      </Screen>
    );

  const supplier = (suppliers.data ?? []).find((s) => s.id === supplierId);
  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New purchase order' : o!.number }} />
      {o && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="h">{o.number}</Txt>
            <Badge status={TONE[o.status]} label={ORDER_STATUS_LABELS[o.status]} />
          </Row>
          <KV k="Supplier" v={o.supplierName} />
          <KV k="Date" v={fd(o.date)} />
          {!!o.expectedDate && <KV k="Expected" v={fd(o.expectedDate)} />}
          <KV k="Total" v={fm(o.total, o)} bold />
        </Card>
      )}

      {editable ? (
        <>
          <Select<Supplier>
            label="Supplier"
            value={supplier?.name ?? ''}
            placeholder="Choose a supplier"
            items={(suppliers.data ?? []).filter((s) => s.status === 'active')}
            getKey={(s) => s.id}
            getLabel={(s) => s.name}
            getSub={(s) => [s.phone, s.contactPerson].filter(Boolean).join(' · ')}
            onSelect={(s) => setSupplierId(s.id)}
            onAdd={addSupplier}
            addLabel="New supplier"
          />
          <Row gap={10} style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <DateField label="Order date" value={date} onChange={setDate} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="Deliver by (optional)" value={expected} onChange={setExpected} quick={[{ label: 'In 7 days', value: addDays(date, 7) }]} />
            </View>
          </Row>
          <Section title="Items">
            <LineEditor lines={lines} onChange={setLines} precision={precision} currency={business?.currency} />
          </Section>
          <Field label="Delivery terms (optional)" value={terms} onChangeText={setTerms} multiline placeholder="e.g. Delivery to site, payment 30 days after receipt" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          {can('purchases.manage') && <Btn icon="save-outline" title={isNew ? 'Save draft order' : 'Save changes'} onPress={save} loading={busy === 'save'} disabled={!!busy} />}
        </>
      ) : (
        <Section title="Items">
          <Card>
            {o!.lines.map((l, i) => (
              <View key={i} style={{ paddingVertical: 4 }}>
                <KV k={l.name} v={fm(l.amount, o)} />
                <Txt v="small">
                  {qtyToString(l.qty)} {l.unit} × {fm(l.unitPrice, o)} · received {qtyToString(l.received ?? 0)}
                </Txt>
              </View>
            ))}
          </Card>
          {!!o!.terms && <KV k="Terms" v={o!.terms} />}
          {!!o!.notes && <Txt v="sub">{o!.notes}</Txt>}
        </Section>
      )}

      {o && (
        <>
          <Btn kind="secondary" icon="document-outline" title="View / share PDF" onPress={() => setViewer(true)} />
          {can('purchases.manage') && o.status === 'draft' && (
            <Row gap={10}>
              <Btn style={{ flex: 1 }} kind="ghost" title="Delete" onPress={remove} />
              <Btn style={{ flex: 2 }} icon="send-outline" title="Mark as sent" onPress={() => setStatus('sent')} loading={busy === 'sent'} disabled={!!busy} />
            </Row>
          )}
          {can('purchases.manage') && (o.status === 'sent' || o.status === 'partial') && (
            <Btn icon="cube-outline" title="Receive goods" onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: 'new', orderId: o.id } })} />
          )}
          {can('purchases.manage') && o.status === 'sent' && <Btn kind="danger" title="Cancel order" onPress={() => setStatus('cancelled')} />}
          {can('purchases.manage') && (o.status === 'partial' || o.status === 'received') && <Btn kind="secondary" title="Close order" onPress={() => setStatus('closed')} />}
          {(existing.data?.receipts.length ?? 0) > 0 && (
            <Section title="Goods received">
              {existing.data!.receipts.map((g) => (
                <Card key={g.id} label={`Goods received ${g.number}`} onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: g.id } })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt style={{ fontWeight: '700' }}>
                      {g.number} · {fd(g.date)}
                    </Txt>
                    <Badge status={g.purchaseId ? 'paid' : 'unpaid'} label={g.purchaseId ? 'Billed' : 'Not billed'} />
                  </Row>
                </Card>
              ))}
            </Section>
          )}
        </>
      )}
      {o && existing.data && (
        <DocumentViewer visible={viewer} onClose={() => setViewer(false)} title={`Purchase order ${o.number}`} fileName={`po-${o.number}`} build={buildDoc} template={existing.data.business.invoiceTemplate ?? 'amber'} />
      )}
    </Screen>
  );
}
