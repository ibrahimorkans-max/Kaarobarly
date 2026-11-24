import { Stack } from 'expo-router';
import { useState } from 'react';
import { PeriodChips, periodRange, type PeriodKey } from '@/components/period';
import { Card, Empty, KV, Loader, Row, Screen, Txt, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import { percentToString } from '@/lib/shared';

interface Perf {
  rows: { userId: string; name: string; shifts: number; bills: number; sales: number; averageBill: number; discounts: number; discountBp: number; returns: number; returnsTotal: number; voids: number; variance: number; shortShifts: number }[];
  currency: string;
  currencyPrecision: number;
}

/** How each cashier did: bills, average bill, discounts, returns, cancelled orders and drawer differences. */
export default function CashiersScreen() {
  const th = useTheme();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const r = periodRange(period);
  const { data, loading, error, reload } = useApi<Perf>(`/reports/cashiers?from=${r.from}&to=${r.to}`);
  const m = (v: number) => fm(v, data);
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Cashier performance' }} />
      <PeriodChips value={period} onChange={setPeriod} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {(data?.rows ?? []).length === 0 ? (
          <Empty icon="speedometer-outline" title="No shifts in this period" />
        ) : (
          data!.rows.map((c) => (
            <Card key={c.userId} style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="h">{c.name}</Txt>
                <Txt style={{ fontWeight: '800' }}>{m(c.sales)}</Txt>
              </Row>
              <KV k="Shifts · bills" v={`${c.shifts} · ${c.bills}`} />
              <KV k="Average bill" v={m(c.averageBill)} />
              <KV k="Discounts given" v={`${m(c.discounts)} (${percentToString(c.discountBp)}%)`} color={c.discountBp > 500 ? th.warn : undefined} />
              <KV k="Returns" v={`${c.returns} · ${m(c.returnsTotal)}`} />
              {c.voids > 0 && <KV k="Cancelled orders" v={String(c.voids)} color={th.warn} />}
              <KV k="Drawer difference" v={`${m(c.variance)}${c.shortShifts ? ` · ${c.shortShifts} short` : ''}`} color={c.variance < 0 ? th.danger : c.variance > 0 ? th.warn : th.success} bold />
            </Card>
          ))
        )}
      </Loader>
    </Screen>
  );
}
