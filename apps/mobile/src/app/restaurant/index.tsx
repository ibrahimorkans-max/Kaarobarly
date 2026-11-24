import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Badge, Btn, Card, Chips, Empty, Field, Loader, Row, Screen, Section, Sheet, Txt, dt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { ORDER_KIND_LABELS, type OrderKind, type TableOrder } from '@/lib/shared';

interface TableDef {
  name: string;
  area: string;
  seats: number;
}

/** The floor: tables free or busy, and open takeaway, delivery and online orders. */
export default function RestaurantScreen() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const tables = useApi<TableDef[]>('/restaurant/tables');
  const orders = useApi<TableOrder[]>('/orders');
  const [area, setArea] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [start, setStart] = useState<{ kind: OrderKind; table: string; guests: string; customer: string; phone: string; address: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const open = orders.data ?? [];
  const byTable = new Map(open.filter((o) => o.kind === 'dine_in').map((o) => [o.table, o]));
  const areas = [...new Set((tables.data ?? []).map((t) => t.area).filter(Boolean))];
  const shown = (tables.data ?? []).filter((t) => !area || t.area === area);
  const others = open.filter((o) => o.kind !== 'dine_in');
  const reload = () => {
    tables.reload();
    orders.reload();
  };

  async function create() {
    if (!start) return;
    setBusy(true);
    try {
      const o = await api<TableOrder>('/orders', { body: { kind: start.kind, table: start.table, guests: Number(start.guests) || 0, customer: start.customer, phone: start.phone, address: start.address } });
      setStart(null);
      router.push({ pathname: '/restaurant/order', params: { id: o.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function saveTables() {
    if (edit === null) return;
    // one table per line: "T1, Hall, 4"
    const list = edit
      .split('\n')
      .map((l) => l.split(',').map((x) => x.trim()))
      .filter((p) => p[0])
      .map(([name, a = '', seats = '4']) => ({ name: name.slice(0, 20), area: a.slice(0, 30), seats: Math.min(50, Number(seats) || 4) }));
    try {
      await api('/restaurant/tables', { method: 'PUT', body: { tables: list } });
      setEdit(null);
      tables.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Restaurant' }} />
      <Row gap={8}>
        <Btn style={{ flex: 1 }} small kind="secondary" icon="bag-handle-outline" title="Takeaway" onPress={() => setStart({ kind: 'takeaway', table: '', guests: '', customer: '', phone: '', address: '' })} />
        <Btn style={{ flex: 1 }} small kind="secondary" icon="bicycle-outline" title="Delivery" onPress={() => setStart({ kind: 'delivery', table: '', guests: '', customer: '', phone: '', address: '' })} />
        <Btn style={{ flex: 1 }} small kind="secondary" icon="flame-outline" title="Kitchen" onPress={() => router.push('/restaurant/kitchen')} />
      </Row>
      <Loader loading={tables.loading && !tables.data} error={tables.data ? '' : tables.error} onRetry={reload}>
        <Section title="Tables" action={can('pos.manage') ? <Btn small kind="ghost" title="Edit" onPress={() => setEdit((tables.data ?? []).map((t) => `${t.name}, ${t.area}, ${t.seats}`).join('\n'))} /> : undefined}>
          {areas.length > 1 && <Chips value={area} onChange={setArea} options={[{ value: '', label: 'All' }, ...areas.map((a) => ({ value: a, label: a }))]} />}
          {shown.length === 0 ? (
            <Empty icon="grid-outline" title="No tables yet" hint="Add your tables to take dine-in orders." action={can('pos.manage') ? <Btn small title="Add tables" onPress={() => setEdit('T1, Hall, 4\nT2, Hall, 4\nT3, Hall, 2')} /> : undefined} />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {shown.map((t) => {
                const o = byTable.get(t.name);
                return (
                  <Pressable
                    key={t.name}
                    accessibilityRole="button"
                    accessibilityLabel={`Table ${t.name}${o ? ', busy' : ', free'}`}
                    onPress={() => (o ? router.push({ pathname: '/restaurant/order', params: { id: o.id } }) : setStart({ kind: 'dine_in', table: t.name, guests: String(t.seats || ''), customer: '', phone: '', address: '' }))}
                    style={{ width: '30%', flexGrow: 1, minHeight: 92, borderRadius: 18, padding: 12, gap: 4, backgroundColor: o ? th.primary : th.card, boxShadow: '0 4px 14px rgba(41,52,110,0.06)' } as any}>
                    <Txt style={{ fontWeight: '800', fontSize: 18, color: o ? '#fff' : th.text }}>{t.name}</Txt>
                    <Txt v="small" color={o ? '#fff' : th.sub}>
                      {o ? `${o.guests || ''}${o.guests ? ' guests · ' : ''}${fm(o.total)}` : `Free · ${t.seats} seats`}
                    </Txt>
                    {o && o.lines.some((l) => l.sent < l.qty) && <Badge status="partially_paid" label="Not sent" />}
                  </Pressable>
                );
              })}
            </View>
          )}
        </Section>
      </Loader>
      <Section title={`Takeaway, delivery and online (${others.length})`}>
        {others.length === 0 ? (
          <Txt v="sub">No open orders.</Txt>
        ) : (
          others.map((o) => (
            <Card key={o.id} label={`Order ${o.number}`} onPress={() => router.push({ pathname: '/restaurant/order', params: { id: o.id } })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>
                    {o.number} · {o.customer || ORDER_KIND_LABELS[o.kind]}
                  </Txt>
                  <Txt v="small">
                    {ORDER_KIND_LABELS[o.kind]}
                    {o.waiter === 'Online shop' ? ' · online' : ''} · {dt(o.createdAt, true)}
                    {o.rider ? ` · rider ${o.rider}` : ''}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt style={{ fontWeight: '800' }}>{fm(o.total)}</Txt>
                  {o.deliveryStatus ? <Badge status={o.deliveryStatus === 'on_the_way' ? 'partially_paid' : 'unpaid'} label={o.deliveryStatus.replace(/_/g, ' ')} /> : null}
                </View>
              </Row>
            </Card>
          ))
        )}
      </Section>

      <Sheet visible={!!start} title={start ? (start.kind === 'dine_in' ? `Table ${start.table}` : ORDER_KIND_LABELS[start.kind]) : ''} onClose={() => setStart(null)}>
        {start?.kind === 'dine_in' && <Field label="Guests" keyboardType="number-pad" value={start.guests} onChangeText={(v) => setStart((s) => s && { ...s, guests: v })} />}
        {start && start.kind !== 'dine_in' && (
          <>
            <Field label="Customer name" value={start.customer} onChangeText={(v) => setStart((s) => s && { ...s, customer: v })} />
            <Field label="Phone" keyboardType="phone-pad" value={start.phone} onChangeText={(v) => setStart((s) => s && { ...s, phone: v })} />
            {start.kind === 'delivery' && <Field label="Address" value={start.address} onChangeText={(v) => setStart((s) => s && { ...s, address: v })} multiline />}
          </>
        )}
        <Btn icon="add" title="Start order" onPress={create} loading={busy} />
      </Sheet>
      <Sheet visible={edit !== null} title="Tables" onClose={() => setEdit(null)}>
        <Txt v="small">One table per line: name, area, seats. For example: T1, Hall, 4</Txt>
        <Field label="Tables" value={edit ?? ''} onChangeText={setEdit} multiline style={{ minHeight: 160 } as any} autoCapitalize="characters" />
        <Btn title="Save tables" onPress={saveTables} />
      </Sheet>
    </Screen>
  );
}
