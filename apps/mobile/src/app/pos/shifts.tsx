import { Stack, router } from 'expo-router';
import { View } from 'react-native';
import { Badge, Card, Empty, Loader, Row, Screen, Txt, dt, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import type { PosShift } from '@/lib/shared';

/** Every counter shift, newest first, with its cash difference. */
export default function ShiftsScreen() {
  const { data, loading, error, reload, refreshing } = useApi<PosShift[]>('/pos/shifts');
  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Shifts' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {(data ?? []).length === 0 && <Empty icon="time-outline" title="No shifts yet" />}
        {(data ?? []).map((s) => (
          <Card key={s.id} label={`Shift ${s.openedAt.slice(0, 16)}`} onPress={() => router.push({ pathname: '/pos/shift', params: { id: s.id } })}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '700' }}>{s.openedByName}</Txt>
                <Txt v="small">
                  {dt(s.openedAt)} · {s.accountName}
                </Txt>
              </View>
              {s.status === 'open' ? <Badge status="unpaid" label="Open" /> : <Badge status={s.difference ? 'overdue' : 'paid'} label={s.difference ? `Diff ${fm(s.difference)}` : 'Balanced'} />}
            </Row>
          </Card>
        ))}
      </Loader>
    </Screen>
  );
}
