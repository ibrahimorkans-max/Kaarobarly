import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { CustomFieldValues } from '@/components/custom-fields';
import { Badge, Btn, Card, Chips, KV, Loader, Row, Screen, Txt, fd, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import { ORDER_STATUS_LABELS, type GoodsReceipt, type Purchase, type PurchaseOrder, type Supplier } from '@/lib/shared';
import { SupplierSheet, supplierToForm, type SupplierForm } from '@/components/supplier-sheet';

type Tab = 'bills' | 'orders' | 'receipts';

export default function SupplierProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const th = useTheme();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<{ supplier: Supplier; purchases: Purchase[]; orders: PurchaseOrder[]; receipts: GoodsReceipt[] }>(`/suppliers/${id}`);
  const [tab, setTab] = useState<Tab>('bills');
  const [form, setForm] = useState<SupplierForm | null>(null);
  const s = data?.supplier;

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: s?.name ?? 'Supplier' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {s && (
          <>
            <Card>
              <Txt v="h">{s.name}</Txt>
              <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <View>
                  <Txt v="small">You owe</Txt>
                  <Txt style={{ fontWeight: '800', fontSize: 22, color: (s.owed ?? 0) > 0 ? th.danger : th.text }}>{fm(s.owed ?? 0)}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt v="small">Bought, all time</Txt>
                  <Txt style={{ fontWeight: '700' }}>{fm(s.bought ?? 0)}</Txt>
                </View>
              </Row>
            </Card>
            <Card>
              {[
                ['Contact', s.contactPerson],
                ['Phone', s.phone],
                ['Email', s.email],
                ['Address', s.address],
                ['NTN', s.ntn],
                ['Opening balance', s.openingBalance ? fm(s.openingBalance) : ''],
                ['Notes', s.notes],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <KV key={k} k={k} v={v} />
                ))}
              <CustomFieldValues entity="supplier" values={s.custom} />
            </Card>
            <Row gap={10}>
              {!!s.phone && <Btn style={{ flex: 1 }} small kind="secondary" icon="call-outline" title="Call" onPress={() => Linking.openURL(`tel:${s.phone.replace(/[^\d+]/g, '')}`)} />}
              {can('purchases.manage') && <Btn style={{ flex: 1 }} small kind="secondary" icon="create-outline" title="Edit" onPress={() => setForm(supplierToForm(s))} />}
              {can('purchases.manage') && <Btn style={{ flex: 1 }} small icon="document-text-outline" title="New PO" onPress={() => router.push({ pathname: '/order/[id]', params: { id: 'new' } })} />}
            </Row>
            <Chips<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'bills', label: `Bills (${data!.purchases.length})` },
                { value: 'orders', label: `Orders (${data!.orders.length})` },
                { value: 'receipts', label: `Received (${data!.receipts.length})` },
              ]}
            />
            {tab === 'bills' &&
              (data!.purchases.length === 0 ? (
                <Txt v="sub">No bills yet.</Txt>
              ) : (
                data!.purchases.map((p) => (
                  <Card key={p.id} label={`Bill ${p.number}`} onPress={() => router.push({ pathname: '/purchase/[id]', params: { id: p.id } })}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View>
                        <Txt style={{ fontWeight: '700' }}>{p.number}{p.billNo ? ` · ${p.billNo}` : ''}</Txt>
                        <Txt v="small">{fd(p.date)}</Txt>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Txt style={{ fontWeight: '700' }}>{fm(p.total, p)}</Txt>
                        <Badge status={p.balance > 0 ? 'unpaid' : 'paid'} label={p.balance > 0 ? `${fm(p.balance, p)} due` : 'Paid'} />
                      </View>
                    </Row>
                  </Card>
                ))
              ))}
            {tab === 'orders' &&
              (data!.orders.length === 0 ? (
                <Txt v="sub">No purchase orders yet.</Txt>
              ) : (
                data!.orders.map((o) => (
                  <Card key={o.id} label={`Order ${o.number}`} onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Txt style={{ fontWeight: '700' }}>
                        {o.number} · {fd(o.date)}
                      </Txt>
                      <Txt v="small">{ORDER_STATUS_LABELS[o.status]}</Txt>
                    </Row>
                  </Card>
                ))
              ))}
            {tab === 'receipts' &&
              (data!.receipts.length === 0 ? (
                <Txt v="sub">Nothing received yet.</Txt>
              ) : (
                data!.receipts.map((g) => (
                  <Card key={g.id} label={`Goods received ${g.number}`} onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: g.id } })}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Txt style={{ fontWeight: '700' }}>
                        {g.number} · {fd(g.date)}
                      </Txt>
                      <Txt v="small">{g.purchaseId ? 'Billed' : 'Not billed'}</Txt>
                    </Row>
                  </Card>
                ))
              ))}
          </>
        )}
      </Loader>
      <SupplierSheet form={form} setForm={setForm} onSaved={() => reload()} />
    </Screen>
  );
}
