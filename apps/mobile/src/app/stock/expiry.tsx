import { Stack, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { Btn, Card, Chips, Empty, KV, Loader, Row, Screen, Sheet, Field, Txt, fd, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import type { Paper } from '@/lib/pdf';
import { parseQty, percentToString, qtyToString, type BusinessProfile, type ExpiryBatch, type ExpiryReport } from '@/lib/shared';
import { returnSlipHtml } from '@/lib/stock-docs';

type Bucket = 'expired' | 'd7' | 'd30' | 'd90';
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'expired', label: 'Expired' },
  { key: 'd7', label: '7 days' },
  { key: 'd30', label: '30 days' },
  { key: 'd90', label: '90 days' },
];
const inBucket = (b: ExpiryBatch, k: Bucket) => (b.daysLeft ?? 999) < 0 ? k === 'expired' : (b.daysLeft ?? 999) <= 7 ? k === 'd7' : (b.daysLeft ?? 999) <= 30 ? k === 'd30' : k === 'd90';

/** Stock at risk from expiry: what is expired or close, its value, and what to do about it. */
export default function ExpiryScreen() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<ExpiryReport>('/stock/expiry');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const business = businesses.data?.[0];
  const [bucket, setBucket] = useState<Bucket>('expired');
  const [view, setView] = useState(false);
  const [off, setOff] = useState<{ b: ExpiryBatch; qty: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const m = (v: number) => fm(v, data);
  const shown = (data?.batches ?? []).filter((b) => inBucket(b, bucket));
  const returnable = (data?.batches ?? []).filter((b) => (b.daysLeft ?? 999) <= 30);
  const build = useCallback((paper: Paper) => (business ? returnSlipHtml(returnable, business, paper) : ''), [business, returnable]);
  const tone: Record<Bucket, string> = { expired: th.danger, d7: th.danger, d30: th.warn, d90: th.info };

  async function writeOff() {
    if (!off) return;
    const qty = parseQty(off.qty);
    if (!qty || qty <= 0) return toast('Enter a quantity', 'error');
    setBusy(true);
    try {
      const r = await api<{ loss: number }>('/stock/write-off', { body: { itemId: off.b.itemId, batchNo: off.b.batchNo, expiry: off.b.expiry, qty, reason: off.reason } });
      toast(`Written off · loss ${m(r.loss)}`);
      setOff(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Expiry' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {BUCKETS.map((x) => (
                <Pressable key={x.key} accessibilityRole="button" accessibilityState={{ selected: bucket === x.key }} onPress={() => setBucket(x.key)} style={{ width: '47%', flexGrow: 1 }}>
                  <Card style={{ gap: 2, borderWidth: 2, borderColor: bucket === x.key ? tone[x.key] : 'transparent' }}>
                    <Txt v="small">{x.label}</Txt>
                    <Txt style={{ fontWeight: '800', fontSize: 22, color: data.buckets[x.key].count ? tone[x.key] : th.text }}>{data.buckets[x.key].count}</Txt>
                    <Txt v="small">{m(data.buckets[x.key].value)} at risk</Txt>
                  </Card>
                </Pressable>
              ))}
            </View>
            <Card>
              <KV k="Written off this month" v={m(data.lossThisMonth)} />
            </Card>
            {returnable.length > 0 && <Btn kind="secondary" icon="return-up-back-outline" title="Return-to-supplier slip" onPress={() => setView(true)} disabled={!business} />}
            {shown.length === 0 ? (
              <Empty icon="leaf-outline" title={bucket === 'expired' ? 'Nothing expired' : 'Nothing expiring in this window'} hint="Turn on Batches and expiry for an item, then record expiry dates when goods arrive." />
            ) : (
              shown.map((b) => (
                <Card key={`${b.itemId}|${b.batchNo}|${b.expiry}`} style={{ gap: 6 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }}>{b.name}</Txt>
                      <Txt v="small">
                        {b.batchNo ? `Batch ${b.batchNo} · ` : ''}
                        {(b.daysLeft ?? 0) < 0 ? `expired ${fd(b.expiry)}` : `expires ${fd(b.expiry)} (${b.daysLeft} days)`}
                        {b.supplierName ? ` · ${b.supplierName}` : ''}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt style={{ fontWeight: '800' }}>
                        {qtyToString(b.qty)} {b.unit}
                      </Txt>
                      <Txt v="small">{m(b.value)}</Txt>
                    </View>
                  </Row>
                  {b.suggestedDiscountBp > 0 && (
                    <Txt v="small" color={th.primary}>
                      Clear it at {percentToString(b.suggestedDiscountBp)}% off: {m(Math.round((b.salePrice * (10000 - b.suggestedDiscountBp)) / 10000))} instead of {m(b.salePrice)}
                    </Txt>
                  )}
                  <Row gap={8}>
                    <Btn small style={{ flex: 1 }} kind="secondary" title="Open item" onPress={() => router.push({ pathname: '/stock/[id]', params: { id: b.itemId } })} />
                    {b.suggestedDiscountBp > 0 && <Btn small style={{ flex: 1 }} kind="secondary" icon="pricetag-outline" title="Labels" onPress={() => router.push({ pathname: '/labels', params: { ids: b.itemId } })} />}
                    {can('stock.manage') && <Btn small style={{ flex: 1 }} kind={(b.daysLeft ?? 0) < 0 ? 'danger' : 'ghost'} title="Write off" onPress={() => setOff({ b, qty: qtyToString(b.qty), reason: (b.daysLeft ?? 0) < 0 ? 'Expired' : '' })} />}
                  </Row>
                </Card>
              ))
            )}
          </>
        )}
      </Loader>
      <Sheet visible={!!off} title={`Write off ${off?.b.name ?? ''}`} onClose={() => setOff(null)}>
        <Field label="Quantity" money value={off?.qty ?? ''} onChangeText={(v) => setOff((o) => o && { ...o, qty: v })} />
        <Chips value={off?.reason ?? ''} onChange={(v) => setOff((o) => o && { ...o, reason: v })} options={['Expired', 'Damaged', 'Returned to supplier'].map((r) => ({ value: r, label: r }))} />
        <Field label="Reason" value={off?.reason ?? ''} onChangeText={(v) => setOff((o) => o && { ...o, reason: v })} />
        <Btn kind="danger" title="Write off" onPress={writeOff} loading={busy} />
      </Sheet>
      {view && business && <DocumentViewer visible={view} onClose={() => setView(false)} title="Return to supplier" fileName="return-slip" build={build} defaultPaper="A4" papers={[{ value: 'A4', label: 'A4' }, { value: 'thermal', label: 'Thermal 80mm' }]} />}
    </Screen>
  );
}
