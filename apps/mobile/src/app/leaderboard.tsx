import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Card, Empty, IconBtn, Loader, Progress, Row, Screen, Txt, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import { percentToString } from '@/lib/shared';

interface Board {
  rows: { employeeId: string; name: string; designation: string; linked: boolean; invoices: number; services: number; sales: number; target: number; progressBp: number; commissionBp: number; commission: number }[];
  currency: string;
  currencyPrecision: number;
}
const shift = (m: string, n: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Sales per person this month against their target, and the commission it earns (paid with payroll). */
export default function LeaderboardScreen() {
  const th = useTheme();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, loading, error, reload } = useApi<Board>(`/people/leaderboard?month=${month}`);
  const m = (v: number) => fm(v, data);
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Targets & commission' }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <IconBtn icon="chevron-back" label="Previous month" onPress={() => setMonth(shift(month, -1))} />
        <Txt v="h">{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</Txt>
        <IconBtn icon="chevron-forward" label="Next month" onPress={() => setMonth(shift(month, 1))} />
      </Row>
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {(data?.rows ?? []).length === 0 ? (
          <Empty icon="trophy-outline" title="No staff yet" hint="Add employees, link their login, and set a target and commission." />
        ) : (
          data!.rows.map((r, i) => (
            <Card key={r.employeeId} style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={8} style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '900', fontSize: 18, color: i === 0 && r.sales ? th.warn : th.sub }}>#{i + 1}</Txt>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '700' }}>{r.name}</Txt>
                    <Txt v="small">
                      {r.invoices} bills{r.services ? ` · ${r.services} services` : ''}
                      {!r.linked ? ' · login not linked' : ''}
                    </Txt>
                  </View>
                </Row>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt style={{ fontWeight: '800' }}>{m(r.sales)}</Txt>
                  {r.commission > 0 && (
                    <Txt v="small" color={th.success}>
                      + {m(r.commission)} ({percentToString(r.commissionBp)}%)
                    </Txt>
                  )}
                </View>
              </Row>
              {r.target > 0 && <Progress value={r.sales} total={r.target} word={`of ${m(r.target)}`} />}
            </Card>
          ))
        )}
      </Loader>
    </Screen>
  );
}
