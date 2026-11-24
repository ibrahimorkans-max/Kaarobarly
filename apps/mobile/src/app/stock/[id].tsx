import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, Chips, Field, KV, Loader, Row, Screen, Section, Sheet, Txt, fd, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { STOCK_MOVE_LABELS, parseMoney, parseQty, qtyToString, type StockBatch, type StockItem, type StockMove } from '@/lib/shared';

type Mode = 'adjust' | 'count' | 'opening';

/** One item's stock: on hand, value, every movement, and corrections. */
export default function StockItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<{ item: StockItem; moves: StockMove[]; batches?: StockBatch[] }>(`/stock/${id}`);
  const [off, setOff] = useState<{ batch: StockBatch | null; qty: string; reason: string } | null>(null);
  async function writeOff() {
    if (!off || !i) return;
    const qty = parseQty(off.qty);
    if (!qty || qty <= 0) return toast('Enter a quantity', 'error');
    setBusy(true);
    try {
      const r = await api<{ loss: number }>('/stock/write-off', { body: { itemId: i.id, batchNo: off.batch?.batchNo ?? '', expiry: off.batch?.expiry ?? '', qty, reason: off.reason } });
      toast(`Written off · loss ${fm(r.loss)}`);
      setOff(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  const [form, setForm] = useState<{ mode: Mode; qty: string; cost: string; note: string; direction: 'in' | 'out' } | null>(null);
  const [busy, setBusy] = useState(false);
  const i = data?.item;

  async function save() {
    if (!form || !i) return;
    const qty = parseQty(form.qty);
    if (qty === null || (form.mode !== 'count' && qty <= 0) || qty < 0) return toast('Enter a quantity', 'error');
    const cost = form.cost.trim() ? parseMoney(form.cost) : undefined;
    if (cost === null) return toast('Cost is not a valid amount', 'error');
    setBusy(true);
    try {
      await api('/stock/adjust', { body: { itemId: i.id, mode: form.mode, qty: form.mode === 'adjust' && form.direction === 'out' ? -qty : qty, unitCost: cost, note: form.note } });
      toast('Stock updated');
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
      <Stack.Screen options={{ title: i?.name ?? 'Stock' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {i && (
          <>
            <Card>
              <Txt v="h">{i.name}</Txt>
              <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <View>
                  <Txt v="small">In stock</Txt>
                  <Txt style={{ fontWeight: '800', fontSize: 24, color: i.onHand <= 0 ? th.danger : i.low ? th.warn : th.text }}>
                    {qtyToString(i.onHand)} {i.unit}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt v="small">Value at cost</Txt>
                  <Txt style={{ fontWeight: '700' }}>{fm(i.value)}</Txt>
                </View>
              </Row>
              {!!i.sku && <KV k="SKU" v={i.sku} />}
              {!!i.barcode && <KV k="Barcode" v={i.barcode} />}
              <KV k="Cost / sale price" v={`${fm(i.costPrice)} / ${fm(i.salePrice)}`} />
              <KV k="Reorder at" v={i.reorderLevel ? `${qtyToString(i.reorderLevel)} ${i.unit}` : 'Not set'} />
            </Card>
            {can('stock.manage') && (
              <Row gap={10}>
                <Btn style={{ flex: 1 }} small kind="secondary" icon="swap-vertical-outline" title="Adjust" onPress={() => setForm({ mode: 'adjust', qty: '', cost: '', note: '', direction: 'in' })} />
                <Btn style={{ flex: 1 }} small kind="secondary" icon="clipboard-outline" title="Count" onPress={() => setForm({ mode: 'count', qty: qtyToString(Math.max(i.onHand, 0)), cost: '', note: '', direction: 'in' })} />
                <Btn style={{ flex: 1 }} small kind="secondary" icon="create-outline" title="Item" onPress={() => router.push('/services')} />
              </Row>
            )}
            {(data!.batches ?? []).length > 0 && (
              <Section title="Batches">
                {data!.batches!.map((b) => {
                  const expired = b.daysLeft !== null && b.daysLeft < 0;
                  return (
                    <Card key={`${b.batchNo}|${b.expiry}`}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <View style={{ flex: 1 }}>
                          <Txt style={{ fontWeight: '700' }}>{b.batchNo ? `Batch ${b.batchNo}` : 'No batch no.'}</Txt>
                          <Txt v="small" color={expired ? th.danger : b.daysLeft !== null && b.daysLeft <= 30 ? th.warn : undefined}>
                            {b.expiry ? (expired ? `Expired ${fd(b.expiry)}` : `Expires ${fd(b.expiry)} · ${b.daysLeft} days`) : 'No expiry'}
                          </Txt>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Txt style={{ fontWeight: '800' }}>{qtyToString(b.qty)}</Txt>
                          {can('stock.manage') && b.qty > 0 && <Btn small kind={expired ? 'danger' : 'ghost'} title="Write off" onPress={() => setOff({ batch: b, qty: qtyToString(b.qty), reason: expired ? 'Expired' : '' })} />}
                        </View>
                      </Row>
                    </Card>
                  );
                })}
              </Section>
            )}
            {can('stock.manage') && i.onHand > 0 && <Btn small kind="ghost" icon="trash-outline" title="Write off damaged or lost stock" onPress={() => setOff({ batch: null, qty: '', reason: '' })} />}
            <Section title="Movements">
              {data!.moves.length === 0 ? (
                <Txt v="sub">No movements yet. Add opening stock with Adjust.</Txt>
              ) : (
                data!.moves.map((m) => (
                  <Card key={m.id}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Txt style={{ fontWeight: '600' }}>
                          {STOCK_MOVE_LABELS[m.kind]}
                          {m.refNumber ? ` · ${m.refNumber}` : ''}
                        </Txt>
                        <Txt v="small">
                          {fd(m.date)}
                          {m.note ? ` · ${m.note}` : ''}
                        </Txt>
                      </View>
                      <Txt style={{ fontWeight: '800', color: m.qty < 0 ? th.danger : th.success }}>
                        {m.qty > 0 ? '+' : ''}
                        {qtyToString(m.qty)}
                      </Txt>
                    </Row>
                  </Card>
                ))
              )}
            </Section>
          </>
        )}
      </Loader>
      <Sheet visible={!!form} title={form?.mode === 'count' ? 'Stock count' : 'Adjust stock'} onClose={() => setForm(null)}>
        {form?.mode !== 'count' && (
          <Chips<Mode | 'out'>
            value={form?.mode === 'adjust' && form.direction === 'out' ? 'out' : (form?.mode ?? 'adjust')}
            onChange={(v) => setForm((f) => f && { ...f, mode: v === 'out' ? 'adjust' : v, direction: v === 'out' ? 'out' : 'in' })}
            options={[
              { value: 'adjust', label: 'Add' },
              { value: 'out', label: 'Remove' },
              { value: 'opening', label: 'Opening stock' },
            ]}
          />
        )}
        <Field label={form?.mode === 'count' ? 'Quantity counted on the shelf' : 'Quantity'} money value={form?.qty ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, qty: v })} />
        {form?.mode === 'opening' && <Field label="Cost per unit (optional)" money value={form.cost} onChangeText={(v) => setForm((f) => f && { ...f, cost: v })} />}
        <Field label="Reason / note" value={form?.note ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, note: v })} placeholder={form?.direction === 'out' ? 'e.g. damaged, used in-house, expired' : ''} />
        <Btn title="Save" onPress={save} loading={busy} />
      </Sheet>
      <Sheet visible={!!off} title={off?.batch?.batchNo ? `Write off batch ${off.batch.batchNo}` : 'Write off stock'} onClose={() => setOff(null)}>
        <Field label="Quantity" money value={off?.qty ?? ''} onChangeText={(v) => setOff((o) => o && { ...o, qty: v })} />
        <Chips value={off?.reason ?? ''} onChange={(v) => setOff((o) => o && { ...o, reason: v })} options={['Expired', 'Damaged', 'Lost', 'Returned to supplier'].map((r) => ({ value: r, label: r }))} />
        <Field label="Reason" value={off?.reason ?? ''} onChangeText={(v) => setOff((o) => o && { ...o, reason: v })} />
        <Txt v="small">The stock leaves at its cost price; the loss shows in the expiry report.</Txt>
        <Btn kind="danger" title="Write off" onPress={writeOff} loading={busy} />
      </Sheet>
    </Screen>
  );
}
