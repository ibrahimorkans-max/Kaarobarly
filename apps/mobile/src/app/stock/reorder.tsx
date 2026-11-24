import { Stack, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { BarcodeScanner } from '@/components/scanner';
import { Btn, Card, Empty, Field, IconBtn, KV, Loader, Row, Screen, Section, Select, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import type { Paper } from '@/lib/pdf';
import { parseQty, qtyToString, type BusinessProfile, type PurchaseOrder, type ReorderGroup, type ReorderSlip, type Service, type Supplier } from '@/lib/shared';
import { reorderMessage, reorderSlipHtml } from '@/lib/stock-docs';

/** Everything at or below its minimum, with suggested quantities, grouped by supplier. Edit, print, send, or order. */
export default function ReorderScreen() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing, setData } = useApi<ReorderSlip>('/stock/reorder-slip');
  const suppliers = useApi<Supplier[]>('/suppliers');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const business = businesses.data?.[0];
  const [qty, setQty] = useState<Record<string, number>>({});
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [view, setView] = useState(false);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = (v: number) => fm(v, data);
  const groups = data?.groups ?? [];
  const q = (l: ReorderGroup['lines'][number]) => qty[l.itemId] ?? l.suggested;
  const groupTotal = (g: ReorderGroup) => g.lines.reduce((s, l) => s + Math.round((q(l) * l.lastPrice) / 1000), 0);
  const grand = groups.reduce((s, g) => s + groupTotal(g), 0);
  const build = useCallback((paper: Paper) => (business ? reorderSlipHtml(groups, business, paper, qty) : ''), [groups, business, qty]);

  const setLineQty = (id: string, text: string) => {
    setEdit((e) => ({ ...e, [id]: text }));
    const v = text.trim() ? parseQty(text) : 0;
    if (v !== null && v >= 0) setQty((s) => ({ ...s, [id]: v }));
  };

  // add an item that is not low yet, by scanning it
  async function addScanned(code: string) {
    try {
      const s = await api<Service>(`/services/by-code/${encodeURIComponent(code)}`);
      if (groups.some((g) => g.lines.some((l) => l.itemId === s.id))) return toast(`${s.name} is already on the slip`);
      const sid = s.preferredSupplierId ?? '';
      const line = { itemId: s.id, name: s.name, barcode: s.barcode, unit: s.unit, onHand: s.onHand ?? 0, reorderLevel: s.reorderLevel, maxLevel: s.maxLevel, packSize: s.packSize, suggested: s.packSize || 1000, lastPrice: s.costPrice, estCost: 0 };
      const list = [...groups];
      const g = list.find((x) => x.supplierId === sid);
      if (g) g.lines.push(line);
      else list.push({ supplierId: sid, supplierName: suppliers.data?.find((x) => x.id === sid)?.name ?? 'Supplier not set', supplierPhone: '', lines: [line], total: 0 });
      setData({ ...data!, groups: list });
      toast(`${s.name} added`);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function makeOrders() {
    if (!business) return;
    const body = {
      businessId: business.id,
      groups: groups
        .map((g) => ({ supplierId: g.supplierId || assign[g.supplierName] || '', lines: g.lines.filter((l) => q(l) > 0).map((l) => ({ itemId: l.itemId, qty: q(l), unitPrice: l.lastPrice })) }))
        .filter((g) => g.lines.length),
    };
    if (body.groups.some((g) => !g.supplierId)) return toast('Choose a supplier for the items without one', 'error');
    setBusy(true);
    try {
      const orders = await api<PurchaseOrder[]>('/stock/reorder-slip/orders', { body });
      toast(`${orders.length} draft purchase order${orders.length === 1 ? '' : 's'} made`);
      router.push('/buying');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function whatsapp(g: ReorderGroup, urdu: boolean) {
    if (!business) return;
    const phone = g.supplierPhone.replace(/\D/g, '').replace(/^0/, '92');
    const text = encodeURIComponent(reorderMessage(g, business, qty, urdu));
    void Linking.openURL(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`);
  }

  return (
    <Screen
      onRefresh={reload}
      refreshing={refreshing}
      footer={
        groups.length > 0 ? (
          <Row gap={10}>
            <Btn style={{ flex: 1 }} kind="secondary" icon="print-outline" title="Print / PDF" onPress={() => setView(true)} disabled={!business} />
            {can('purchases.manage') && <Btn style={{ flex: 1.3 }} icon="cart-outline" title="Make orders" onPress={makeOrders} loading={busy} />}
          </Row>
        ) : undefined
      }>
      <Stack.Screen options={{ title: 'Reorder slip' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {groups.length === 0 ? (
          <Empty icon="checkmark-done-outline" title="Nothing to reorder" hint="Items show here when stock falls to their reorder level. Set levels on each item." action={<Btn small kind="secondary" icon="barcode-outline" title="Add by scanning" onPress={() => setScan(true)} />} />
        ) : (
          <>
            <Card>
              <KV k="Items to buy" v={String(groups.reduce((s, g) => s + g.lines.filter((l) => q(l) > 0).length, 0))} />
              <KV k="Estimated cost" v={m(grand)} bold />
            </Card>
            <Btn small kind="ghost" icon="barcode-outline" title="Add an item by scanning" onPress={() => setScan(true)} />
            {groups.map((g) => (
              <Section key={g.supplierId || g.supplierName} title={g.supplierName} action={g.supplierId ? <IconBtn icon="logo-whatsapp" label={`Send to ${g.supplierName} on WhatsApp`} color={th.success} onPress={() => whatsapp(g, false)} /> : undefined}>
                {!g.supplierId && (
                  <Select<Supplier>
                    label="Order these from"
                    value={suppliers.data?.find((s) => s.id === assign[g.supplierName])?.name ?? ''}
                    placeholder="Choose a supplier"
                    items={(suppliers.data ?? []).filter((s) => s.status === 'active')}
                    getKey={(s) => s.id}
                    getLabel={(s) => s.name}
                    onSelect={(s) => setAssign((a) => ({ ...a, [g.supplierName]: s.id }))}
                  />
                )}
                {g.lines.map((l) => (
                  <Card key={l.itemId} style={{ gap: 6, opacity: q(l) > 0 ? 1 : 0.5 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Txt style={{ fontWeight: '700' }}>{l.name}</Txt>
                        <Txt v="small">
                          Have {qtyToString(l.onHand)} · min {qtyToString(l.reorderLevel)}
                          {l.maxLevel ? ` · max ${qtyToString(l.maxLevel)}` : ''}
                          {l.packSize ? ` · packs of ${qtyToString(l.packSize)}` : ''}
                        </Txt>
                      </View>
                      <IconBtn icon={q(l) > 0 ? 'close' : 'add'} label={q(l) > 0 ? `Remove ${l.name}` : `Put back ${l.name}`} onPress={() => setLineQty(l.itemId, q(l) > 0 ? '0' : qtyToString(l.suggested))} />
                    </Row>
                    <Row style={{ alignItems: 'flex-end' }}>
                      <Field style={{ flex: 1 }} label={`Order (${l.unit || 'qty'})`} money value={edit[l.itemId] ?? qtyToString(q(l))} onChangeText={(v) => setLineQty(l.itemId, v)} />
                      <View style={{ alignItems: 'flex-end', paddingBottom: 8 }}>
                        <Txt v="small">@ {m(l.lastPrice)}</Txt>
                        <Txt style={{ fontWeight: '700' }}>{m(Math.round((q(l) * l.lastPrice) / 1000))}</Txt>
                      </View>
                    </Row>
                  </Card>
                ))}
                <Row style={{ justifyContent: 'space-between' }}>
                  {g.supplierId ? <Btn small kind="ghost" title="Urdu message" onPress={() => whatsapp(g, true)} /> : <View />}
                  <Txt style={{ fontWeight: '800' }}>{m(groupTotal(g))}</Txt>
                </Row>
              </Section>
            ))}
          </>
        )}
      </Loader>
      <BarcodeScanner visible={scan} onClose={() => setScan(false)} onCode={addScanned} title="Scan an item to add" />
      {view && business && <DocumentViewer visible={view} onClose={() => setView(false)} title="Reorder slip" fileName="reorder-slip" build={build} defaultPaper="A4" papers={[{ value: 'A4', label: 'A4' }, { value: 'thermal', label: 'Thermal 80mm' }, { value: 'thermal58', label: 'Thermal 58mm' }]} />}
    </Screen>
  );
}
