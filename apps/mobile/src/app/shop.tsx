import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Share, Switch, View } from 'react-native';
import { Btn, Card, Field, KV, Loader, Row, Screen, Section, Txt, dt, fm } from '@/components/ui';
import { API_URL, api, useApi } from '@/lib/api';
import { useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney, type ShopSettings, type TableOrder } from '@/lib/shared';

/** The online catalogue customers order from; orders arrive at the counter. */
export default function ShopScreen() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<ShopSettings>('/shop/settings');
  const orders = useApi<TableOrder[]>('/orders');
  const [f, setF] = useState<{ enabled: boolean; title: string; whatsapp: string; note: string; fee: string; inStockOnly: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data && !f) setF({ enabled: data.enabled, title: data.title, whatsapp: data.whatsapp, note: data.note, fee: data.deliveryFee ? moneyToInput(data.deliveryFee) : '', inStockOnly: data.inStockOnly });
  }, [data, f]);
  const link = data?.token ? `${API_URL}/s/${data.token}` : '';
  const online = (orders.data ?? []).filter((o) => o.waiter === 'Online shop');

  async function save() {
    if (!f) return;
    setBusy(true);
    try {
      await api('/shop/settings', { method: 'PUT', body: { enabled: f.enabled, title: f.title, whatsapp: f.whatsapp, note: f.note, deliveryFee: f.fee ? (parseMoney(f.fee) ?? 0) : 0, inStockOnly: f.inStockOnly } });
      toast('Shop saved');
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={() => (reload(), orders.reload())}>
      <Stack.Screen options={{ title: 'Online shop' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {f && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>Shop is open</Txt>
                  <Txt v="small">Customers pick items from your catalogue and send the order</Txt>
                </View>
                <Switch accessibilityLabel="Shop is open" value={f.enabled} onValueChange={(v) => setF({ ...f, enabled: v })} />
              </Row>
            </Card>
            {!!link && data?.enabled && (
              <Card style={{ gap: 8 }}>
                <Txt v="small">Your shop link</Txt>
                <Txt selectable style={{ fontWeight: '700' }}>
                  {link}
                </Txt>
                <Row gap={8}>
                  <Btn style={{ flex: 1 }} small kind="secondary" icon="share-social-outline" title="Share" onPress={() => Share.share({ message: `Order from ${f.title || 'our shop'}: ${link}` })} />
                  <Btn style={{ flex: 1 }} small kind="secondary" icon="open-outline" title="Open" onPress={() => Linking.openURL(link)} />
                </Row>
              </Card>
            )}
            <Field label="Shop name" value={f.title} onChangeText={(v) => setF({ ...f, title: v })} />
            <Field label="WhatsApp for orders" keyboardType="phone-pad" value={f.whatsapp} onChangeText={(v) => setF({ ...f, whatsapp: v })} hint="After ordering, the customer can also send it to you on WhatsApp" />
            <Field label="Note at the top" value={f.note} onChangeText={(v) => setF({ ...f, note: v })} placeholder="Free delivery in Gulberg" />
            <Field label="Delivery charge" money value={f.fee} onChangeText={(v) => setF({ ...f, fee: v })} placeholder="0" />
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt>Hide items that are out of stock</Txt>
              <Switch accessibilityLabel="Hide out of stock" value={f.inStockOnly} onValueChange={(v) => setF({ ...f, inStockOnly: v })} />
            </Row>
            <Btn title="Save" onPress={save} loading={busy} />
            <Txt v="small">Items with a price in your catalogue are shown, grouped by category. Saving needs an internet connection.</Txt>
          </>
        )}
      </Loader>
      <Section title={`Online orders waiting (${online.length})`}>
        {online.map((o) => (
          <Card key={o.id} label={`Order ${o.number}`} onPress={() => router.push({ pathname: '/restaurant/order', params: { id: o.id } })}>
            <KV k={`${o.number} · ${o.customer}`} v={fm(o.total)} bold />
            <Txt v="small">
              {o.phone} · {dt(o.createdAt)}
              {o.address ? ` · ${o.address}` : ' · pickup'}
            </Txt>
          </Card>
        ))}
        {!online.length && <Txt v="sub">No online orders waiting.</Txt>}
      </Section>
    </Screen>
  );
}
