import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BarcodeScanner } from '@/components/scanner';
import { Badge, Btn, Card, Chips, Empty, IconBtn, Loader, Row, Screen, SearchBar, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useToast } from '@/lib/app-context';
import { qtyToString, type Service, type StockAlert, type StockSummary } from '@/lib/shared';

type Filter = 'all' | 'low' | 'out';

/** What is in stock, its value, and what is running low. */
export default function Stock() {
  const toast = useToast();
  const { data, loading, error, reload, refreshing } = useApi<StockSummary>('/stock');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [scan, setScan] = useState(false);
  const alerts = useApi<StockAlert[]>('/stock/alerts');
  const urgent = (alerts.data ?? []).filter((a) => a.level !== 'info').length;
  const needle = q.trim().toLowerCase();
  const shown = (data?.items ?? []).filter(
    (i) => (filter === 'all' || (filter === 'out' ? i.onHand <= 0 : i.low && i.onHand > 0)) && (!needle || `${i.name} ${i.sku} ${i.barcode} ${i.category}`.toLowerCase().includes(needle)),
  );

  async function scanned(code: string) {
    try {
      const s = await api<Service>(`/services/by-code/${encodeURIComponent(code)}`);
      router.push({ pathname: '/stock/[id]', params: { id: s.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Stock' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Txt v="small">Stock value (at cost)</Txt>
                <Txt style={{ fontWeight: '800', fontSize: 22 }}>{fm(data.totalValue)}</Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Txt v="small">{data.items.length} items</Txt>
                {data.lowCount > 0 && <Badge status="partially_paid" label={`${data.lowCount} running low`} />}
                {data.outCount > 0 && <Badge status="overdue" label={`${data.outCount} out of stock`} />}
              </View>
            </Row>
          </Card>
        )}
        <Row gap={8}>
          <Btn style={{ flex: 1 }} small kind="secondary" icon="notifications-outline" title={`Alerts${alerts.data?.length ? ` (${alerts.data.length})` : ''}`} onPress={() => router.push('/stock/alerts')} />
          <Btn style={{ flex: 1 }} small kind="secondary" icon="document-text-outline" title="Reorder slip" onPress={() => router.push('/stock/reorder')} />
          <Btn style={{ flex: 1 }} small kind="secondary" icon="hourglass-outline" title="Expiry" onPress={() => router.push('/stock/expiry')} />
        </Row>
        {urgent > 0 && <Badge status="overdue" label={`${urgent} need attention`} />}
        <Row>
          <View style={{ flex: 1 }}>
            <SearchBar value={q} onChange={setQ} placeholder="Search name, SKU or barcode" />
          </View>
          <IconBtn icon="barcode-outline" label="Scan a barcode" onPress={() => setScan(true)} />
        </Row>
        <Chips<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'low', label: 'Running low' },
            { value: 'out', label: 'Out of stock' },
          ]}
        />
        {(data?.lowCount ?? 0) + (data?.outCount ?? 0) > 0 && <Btn kind="secondary" icon="hand-left-outline" title="Request what is low" onPress={() => router.push({ pathname: '/request/[id]', params: { id: 'new', reorder: '1' } })} />}
        {shown.length === 0 ? (
          <Empty icon="cube-outline" title={data?.items.length ? 'Nothing matches' : 'No stock items yet'} hint={data?.items.length ? undefined : 'Turn on "Keep stock" for a product in Services & Products, or add opening stock here.'} action={<Btn small icon="pricetags-outline" title="Open catalogue" onPress={() => router.push('/services')} />} />
        ) : (
          shown.map((i) => (
            <Card key={i.id} label={`Stock ${i.name}`} onPress={() => router.push({ pathname: '/stock/[id]', params: { id: i.id } })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontWeight: '700' }}>{i.name}</Txt>
                  <Txt v="small">{[i.sku, i.category, i.costPrice ? `cost ${fm(i.costPrice)}` : ''].filter(Boolean).join(' · ') || ' '}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt style={{ fontWeight: '800' }}>
                    {qtyToString(i.onHand)} {i.unit}
                  </Txt>
                  {i.onHand <= 0 ? <Badge status="overdue" label="Out" /> : i.low ? <Badge status="partially_paid" label="Low" /> : <Txt v="small">{fm(i.value)}</Txt>}
                </View>
              </Row>
            </Card>
          ))
        )}
      </Loader>
      <BarcodeScanner visible={scan} onClose={() => setScan(false)} onCode={scanned} />
    </Screen>
  );
}
