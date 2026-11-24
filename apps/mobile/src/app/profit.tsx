import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { PeriodChips, periodRange, type PeriodKey } from '@/components/period';
import { Card, Chips, Empty, KV, Loader, Progress, Row, Screen, Txt, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import { percentToString, qtyToString } from '@/lib/shared';

type By = 'item' | 'client' | 'category' | 'cashier';
interface Profit {
  rows: { key: string; name: string; qty: number; revenue: number; cost: number; profit: number; marginBp: number }[];
  totals: { revenue: number; cost: number; profit: number; marginBp: number };
  currency: string;
  currencyPrecision: number;
}

/** Sales, cost and margin by item, customer, category or cashier. */
export default function ProfitScreen() {
  const th = useTheme();
  const [by, setBy] = useState<By>('item');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const r = periodRange(period);
  const { data, loading, error, reload } = useApi<Profit>(`/reports/profit?by=${by}&from=${r.from}&to=${r.to}`);
  const m = (v: number) => fm(v, data);
  const top = Math.max(...(data?.rows ?? []).map((x) => Math.abs(x.profit)), 1);
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Profit' }} />
      <Chips<By> value={by} onChange={setBy} options={[{ value: 'item', label: 'Items' }, { value: 'client', label: 'Customers' }, { value: 'category', label: 'Categories' }, { value: 'cashier', label: 'Cashiers' }]} />
      <PeriodChips value={period} onChange={setPeriod} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <>
            <Card style={{ gap: 2 }}>
              <KV k="Sales (after discounts, before tax)" v={m(data.totals.revenue)} />
              <KV k="Cost of stock sold" v={m(data.totals.cost)} />
              <KV k={`Gross profit · ${percentToString(data.totals.marginBp)}%`} v={m(data.totals.profit)} bold color={data.totals.profit >= 0 ? th.success : th.danger} />
            </Card>
            <Txt v="small">Cost is known for stock items only; services show their full sale as profit.</Txt>
            {data.rows.length === 0 ? (
              <Empty icon="podium-outline" title="No sales in this period" />
            ) : (
              data.rows.map((x) => (
                <Card key={x.key} style={{ gap: 4 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                        {x.name}
                      </Txt>
                      <Txt v="small">
                        {by === 'item' ? `${qtyToString(x.qty)} sold · ` : by === 'client' || by === 'cashier' ? `${x.qty} bills · ` : ''}sales {m(x.revenue)} · cost {m(x.cost)}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt style={{ fontWeight: '800', color: x.profit >= 0 ? th.success : th.danger }}>{m(x.profit)}</Txt>
                      <Txt v="small">{percentToString(x.marginBp)}%</Txt>
                    </View>
                  </Row>
                  <Progress value={Math.max(x.profit, 0)} total={top} word="of the best" />
                </Card>
              ))
            )}
          </>
        )}
      </Loader>
    </Screen>
  );
}
