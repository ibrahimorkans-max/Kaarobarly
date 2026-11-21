import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { MenuRow } from '@/components/rows';
import { Badge, Btn, Card, Chips, Empty, Loader, Row, Screen, Txt, fd, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useAuth } from '@/lib/app-context';
import { ORDER_STATUS_LABELS, qtyToString, type GoodsReceipt, type PurchaseOrder, type PurchaseRequest } from '@/lib/shared';

type Tab = 'requests' | 'orders' | 'receipts';
const REQ_TONE: Record<string, string> = { pending: 'draft', approved: 'paid', rejected: 'cancelled', ordered: 'unpaid' };
const ORDER_TONE: Record<string, string> = { draft: 'draft', sent: 'unpaid', partial: 'partially_paid', received: 'paid', closed: 'paid', cancelled: 'cancelled' };
const REQ_LABEL: Record<string, string> = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', ordered: 'Ordered' };

/** Buying: demand (purchase requests), purchase orders and goods received. */
export default function Buying() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>(can('purchases.manage') ? 'orders' : 'requests');
  const requests = useApi<PurchaseRequest[]>(tab === 'requests' ? '/purchase-requests' : null);
  const orders = useApi<PurchaseOrder[]>(tab === 'orders' ? '/purchase-orders' : null);
  const receipts = useApi<GoodsReceipt[]>(tab === 'receipts' ? '/goods-receipts' : null);
  const reorder = useApi<{ itemId: string }[]>('/stock/reorder');
  const current = tab === 'requests' ? requests : tab === 'orders' ? orders : receipts;

  return (
    <Screen onRefresh={current.reload} refreshing={current.refreshing}>
      <Row gap={10}>
        <View style={{ flex: 1 }}>
          <MenuRow icon="storefront-outline" title="Suppliers" onPress={() => router.push('/suppliers')} />
        </View>
        <View style={{ flex: 1 }}>
          <MenuRow icon="cube-outline" title="Stock" sub={reorder.data?.length ? `${reorder.data.length} to reorder` : undefined} onPress={() => router.push('/stock')} />
        </View>
      </Row>
      <Chips<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'requests', label: 'Requests' },
          { value: 'orders', label: 'Purchase orders' },
          { value: 'receipts', label: 'Goods received' },
        ]}
      />

      {tab === 'requests' && (
        <>
          {can('purchases.request') && <Btn icon="add" title="Request items" onPress={() => router.push({ pathname: '/request/[id]', params: { id: 'new' } })} />}
          <Loader loading={requests.loading && !requests.data} error={requests.data ? '' : requests.error} onRetry={requests.reload}>
            {(requests.data ?? []).length === 0 ? (
              <Empty icon="hand-left-outline" title="No requests yet" hint="Staff ask for what they need here; a manager approves it and it becomes a purchase order." />
            ) : (
              requests.data!.map((r) => (
                <Card key={r.id} label={`Request ${r.number}`} onPress={() => router.push({ pathname: '/request/[id]', params: { id: r.id } })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }}>
                        {r.number} · {r.requestedByName}
                      </Txt>
                      <Txt v="small" numberOfLines={1}>
                        {r.lines.map((l) => `${l.name} ${qtyToString(l.qty)} ${l.unit}`.trim()).join(', ')}
                      </Txt>
                      <Txt v="small">{fd(r.date)}{r.neededBy ? ` · needed by ${fd(r.neededBy)}` : ''}</Txt>
                    </View>
                    <Badge status={REQ_TONE[r.status]} label={REQ_LABEL[r.status]} />
                  </Row>
                </Card>
              ))
            )}
          </Loader>
        </>
      )}

      {tab === 'orders' && (
        <>
          {can('purchases.manage') && <Btn icon="add" title="New purchase order" onPress={() => router.push({ pathname: '/order/[id]', params: { id: 'new' } })} />}
          <Loader loading={orders.loading && !orders.data} error={orders.data ? '' : orders.error} onRetry={orders.reload}>
            {(orders.data ?? []).length === 0 ? (
              <Empty icon="document-text-outline" title="No purchase orders yet" hint="Send suppliers a PO, then record the goods as they arrive." />
            ) : (
              orders.data!.map((o) => (
                <Card key={o.id} label={`Purchase order ${o.number}`} onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }}>
                        {o.number} · {o.supplierName}
                      </Txt>
                      <Txt v="small">
                        {fd(o.date)}
                        {o.expectedDate ? ` · expected ${fd(o.expectedDate)}` : ''}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Txt style={{ fontWeight: '700' }}>{fm(o.total, o)}</Txt>
                      <Badge status={ORDER_TONE[o.status]} label={ORDER_STATUS_LABELS[o.status]} />
                    </View>
                  </Row>
                </Card>
              ))
            )}
          </Loader>
        </>
      )}

      {tab === 'receipts' && (
        <>
          {can('purchases.manage') && <Btn icon="add" title="Record goods received" onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: 'new' } })} />}
          <Loader loading={receipts.loading && !receipts.data} error={receipts.data ? '' : receipts.error} onRetry={receipts.reload}>
            {(receipts.data ?? []).length === 0 ? (
              <Empty icon="cube-outline" title="Nothing received yet" hint="Record goods as they arrive. Stock goes up and you can make the bill from it." />
            ) : (
              receipts.data!.map((g) => (
                <Card key={g.id} label={`Goods received ${g.number}`} onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: g.id } })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }}>
                        {g.number} · {g.supplierName}
                      </Txt>
                      <Txt v="small">
                        {fd(g.date)}
                        {g.orderNumber ? ` · ${g.orderNumber}` : ''}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Txt style={{ fontWeight: '700' }}>{fm(g.total, g)}</Txt>
                      <Badge status={g.purchaseId ? 'paid' : 'unpaid'} label={g.purchaseId ? `Billed ${g.purchaseNumber}` : 'Not billed'} />
                    </View>
                  </Row>
                </Card>
              ))
            )}
          </Loader>
        </>
      )}
    </Screen>
  );
}
