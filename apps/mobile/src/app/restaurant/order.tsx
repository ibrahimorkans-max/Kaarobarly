import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { Btn, Card, Chips, Field, IconBtn, KV, Loader, Row, Screen, SearchBar, Section, Sheet, Txt, confirm, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import type { Paper } from '@/lib/pdf';
import { kotHtml } from '@/lib/restaurant-docs';
import { ORDER_KIND_LABELS, qtyToString, type Kot, type OrderLine, type Service, type TableOrder } from '@/lib/shared';

/** One order: add dishes with extras, send new items to the kitchen, then bill it at the counter. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, setData } = useApi<TableOrder>(`/orders/${id}`);
  const items = useApi<Service[]>('/services?limit=100');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [pick, setPick] = useState<{ s: Service; mods: string[]; note: string } | null>(null);
  const [kots, setKots] = useState<Kot[] | null>(null);
  const [busy, setBusy] = useState('');
  const o = data;

  useEffect(() => {
    if (data && !dirty) setLines(data.lines);
  }, [data, dirty]);

  const menu = (items.data ?? []).filter((s) => s.status === 'active' && s.defaultPrice > 0);
  const cats = [...new Set(menu.map((s) => s.category).filter(Boolean))];
  const needle = q.trim().toLowerCase();
  const shown = menu.filter((s) => (!cat || s.category === cat) && (!needle || s.name.toLowerCase().includes(needle)));
  const total = lines.reduce((s, l) => s + Math.round((l.qty * l.unitPrice) / 1000), 0);
  const unsent = lines.some((l) => l.sent < l.qty);
  const build = useCallback((paper: Paper) => (kots ? kotHtml(kots, paper) : ''), [kots]);

  const change = (next: OrderLine[]) => {
    setLines(next);
    setDirty(true);
  };
  function add(s: Service, mods: string[] = [], note = '') {
    const extra = s.modifiers.filter((m) => mods.includes(m.name)).reduce((a, m) => a + m.price, 0);
    const name = `${s.name}${mods.length ? ` (${mods.join(', ')})` : ''}`;
    const i = lines.findIndex((l) => l.serviceId === s.id && l.name === name && !note && !l.note);
    if (i >= 0) change(lines.map((l, k) => (k === i ? { ...l, qty: l.qty + 1000 } : l)));
    else change([...lines, { serviceId: s.id, name, qty: 1000, unit: s.unit, unitPrice: s.defaultPrice + extra, modifiers: mods, note, section: s.kitchenSection, sent: 0, taxRateBp: s.taxRateBp }]);
  }
  async function save(): Promise<TableOrder | null> {
    if (!dirty) return o ?? null;
    try {
      const r = await api<TableOrder>(`/orders/${id}`, { method: 'PUT', body: { lines } });
      setDirty(false);
      setData(r);
      return r;
    } catch (e: any) {
      toast(e.message, 'error');
      return null;
    }
  }
  async function send() {
    setBusy('kot');
    try {
      if (!(await save())) return;
      const k = await api<Kot[]>(`/orders/${id}/kot`, { method: 'POST' });
      setKots(k);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function bill() {
    if (unsent && !(await confirm('Not sent to the kitchen', 'Some items were not sent to the kitchen. Bill anyway?', 'Bill'))) return;
    if (!(await save())) return;
    router.push({ pathname: '/(tabs)/pos', params: { orderId: id } });
  }
  async function cancel() {
    if (!(await confirm('Cancel this order?', 'It is logged for the owner, with what the kitchen already made.', 'Cancel order'))) return;
    await api(`/orders/${id}/cancel`, { body: { reason: 'Cancelled at the counter' } }).catch((e) => toast(e.message, 'error'));
    router.back();
  }
  async function delivery(status: 'preparing' | 'on_the_way' | 'delivered', rider?: string) {
    const r = await api<TableOrder>(`/orders/${id}`, { method: 'PUT', body: { deliveryStatus: status, ...(rider !== undefined ? { rider } : {}) } }).catch((e) => toast(e.message, 'error'));
    if (r) setData(r);
  }

  return (
    <Screen
      footer={
        o?.status === 'open' ? (
          <Row gap={10}>
            <Btn style={{ flex: 1 }} kind="secondary" icon="flame-outline" title="Send to kitchen" onPress={send} loading={busy === 'kot'} disabled={!unsent} />
            <Btn style={{ flex: 1 }} icon="card-outline" title={`Bill ${fm(total)}`} onPress={bill} disabled={!lines.length} />
          </Row>
        ) : undefined
      }>
      <Stack.Screen options={{ title: o ? (o.kind === 'dine_in' ? `Table ${o.table}` : `${ORDER_KIND_LABELS[o.kind]} ${o.number}`) : 'Order' }} />
      <Loader loading={loading && !o} error={o ? '' : error} onRetry={reload}>
        {o && (
          <>
            <Card style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt style={{ fontWeight: '700' }}>
                  {o.number} · {ORDER_KIND_LABELS[o.kind]}
                  {o.guests ? ` · ${o.guests} guests` : ''}
                </Txt>
                <Txt style={{ fontWeight: '800' }}>{fm(total)}</Txt>
              </Row>
              {!!(o.customer || o.phone) && <Txt v="small">{[o.customer, o.phone, o.address].filter(Boolean).join(' · ')}</Txt>}
              {o.status !== 'open' && <Txt color={th.danger}>This order is {o.status}.</Txt>}
            </Card>
            {o.kind === 'delivery' && o.status === 'open' && (
              <Card style={{ gap: 8 }}>
                <Field label="Rider" value={o.rider} onChangeText={(v) => setData({ ...o, rider: v })} onEndEditing={() => delivery((o.deliveryStatus || 'preparing') as any, o.rider)} />
                <Chips value={o.deliveryStatus || 'preparing'} onChange={(v) => delivery(v as any)} options={[{ value: 'preparing', label: 'Preparing' }, { value: 'on_the_way', label: 'On the way' }, { value: 'delivered', label: 'Delivered' }]} />
                <Txt v="small">Collect the cash on delivery, then bill the order at the counter.</Txt>
              </Card>
            )}
            <Section title={`On the order (${lines.length})`}>
              {lines.length === 0 && <Txt v="sub">Tap dishes below to add them.</Txt>}
              {lines.map((l, i) => (
                <Row key={`${l.name}-${i}`} style={{ alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '700' }}>{l.name}</Txt>
                    <Txt v="small">
                      {fm(l.unitPrice)}
                      {l.note ? ` · ${l.note}` : ''}
                      {l.sent >= l.qty ? ' · in kitchen' : l.sent ? ` · ${qtyToString(l.qty - l.sent)} not sent` : l.section ? ' · not sent' : ''}
                    </Txt>
                  </View>
                  {o.status === 'open' && <IconBtn icon="remove" label={`Less ${l.name}`} onPress={() => (l.qty - 1000 < l.sent && !can('pos.manage') ? toast('Already in the kitchen: a manager must remove it', 'error') : change(l.qty <= 1000 ? lines.filter((_, k) => k !== i) : lines.map((x, k) => (k === i ? { ...x, qty: x.qty - 1000 } : x))))} />}
                  <Txt style={{ minWidth: 26, textAlign: 'center', fontWeight: '800' }}>{qtyToString(l.qty)}</Txt>
                  {o.status === 'open' && <IconBtn icon="add" label={`More ${l.name}`} onPress={() => change(lines.map((x, k) => (k === i ? { ...x, qty: x.qty + 1000 } : x)))} />}
                </Row>
              ))}
              {dirty && <Btn small kind="secondary" title="Save changes" onPress={() => void save()} />}
            </Section>
            {o.status === 'open' && (
              <Section title="Menu">
                <SearchBar value={q} onChange={setQ} placeholder="Search the menu" />
                {cats.length > 1 && <Chips value={cat} onChange={setCat} options={[{ value: '', label: 'All' }, ...cats.map((c) => ({ value: c, label: c }))]} />}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {shown.map((s) => (
                    <Pressable
                      key={s.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${s.name}`}
                      onPress={() => (s.modifiers.length ? setPick({ s, mods: [], note: '' }) : add(s))}
                      onLongPress={() => setPick({ s, mods: [], note: '' })}
                      style={{ width: '47%', flexGrow: 1, backgroundColor: th.card, borderRadius: 16, padding: 12, gap: 4, boxShadow: '0 4px 14px rgba(41,52,110,0.06)' } as any}>
                      <Txt numberOfLines={2} style={{ fontWeight: '700' }}>
                        {s.name}
                      </Txt>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Txt style={{ color: th.primary, fontWeight: '800' }}>{fm(s.defaultPrice)}</Txt>
                        {s.modifiers.length > 0 && <Ionicons name="options-outline" size={16} color={th.sub} />}
                      </Row>
                    </Pressable>
                  ))}
                </View>
                <Txt v="small">Long-press a dish to add a note (less spicy, no onion).</Txt>
              </Section>
            )}
            {o.status === 'open' && can('pos.manage') && <Btn kind="ghost" title="Cancel order" onPress={cancel} />}
          </>
        )}
      </Loader>
      <Sheet visible={!!pick} title={pick?.s.name ?? ''} onClose={() => setPick(null)}>
        {pick?.s.modifiers.map((md) => {
          const onIt = pick.mods.includes(md.name);
          return (
            <Pressable key={md.name} accessibilityRole="checkbox" accessibilityState={{ checked: onIt }} onPress={() => setPick((p) => p && { ...p, mods: onIt ? p.mods.filter((x) => x !== md.name) : [...p.mods, md.name] })} style={{ paddingVertical: 8 }}>
              <Row>
                <Ionicons name={onIt ? 'checkbox' : 'square-outline'} size={22} color={onIt ? th.primary : th.sub} />
                <Txt style={{ flex: 1 }}>{md.name}</Txt>
                {md.price > 0 && <Txt v="small">+ {fm(md.price)}</Txt>}
              </Row>
            </Pressable>
          );
        })}
        <Field label="Note for the kitchen" value={pick?.note ?? ''} onChangeText={(v) => setPick((p) => p && { ...p, note: v })} placeholder="less spicy, no onion" />
        <KV k="Price" v={fm((pick?.s.defaultPrice ?? 0) + (pick?.s.modifiers.filter((m) => pick.mods.includes(m.name)).reduce((a, m) => a + m.price, 0) ?? 0))} bold />
        <Btn
          icon="add"
          title="Add to order"
          onPress={() => {
            if (pick) add(pick.s, pick.mods, pick.note.trim());
            setPick(null);
          }}
        />
      </Sheet>
      {kots && <DocumentViewer visible={!!kots} onClose={() => setKots(null)} title={`Kitchen tickets (${kots.length})`} fileName="kot" build={build} defaultPaper="thermal" papers={[{ value: 'thermal', label: 'Thermal 80mm' }, { value: 'thermal58', label: 'Thermal 58mm' }]} note="Sent to the kitchen screen. Print for a kitchen printer." />}
    </Screen>
  );
}
