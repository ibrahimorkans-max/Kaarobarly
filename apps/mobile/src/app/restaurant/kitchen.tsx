import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Btn, Card, Chips, Empty, Loader, Row, Screen, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { ORDER_KIND_LABELS, qtyToString, type Kot } from '@/lib/shared';

/** The kitchen display: tickets in order, oldest first. Tap Ready when cooked, Served when it leaves. */
export default function KitchenScreen() {
  const th = useTheme();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const [section, setSection] = useState('');
  const { data, loading, error, reload, setData } = useApi<Kot[]>('/kots');
  const [now, setNow] = useState(Date.now());
  // a kitchen screen stays open: refresh every 10 seconds
  useEffect(() => {
    const t = setInterval(() => {
      reload();
      setNow(Date.now());
    }, 10_000);
    return () => clearInterval(t);
  }, [reload]);
  const sections = [...new Set((data ?? []).map((k) => k.section))];
  const shown = (data ?? []).filter((k) => !section || k.section === section);
  const cols = width >= 1000 ? 3 : width >= 650 ? 2 : 1;

  async function move(k: Kot, status: 'ready' | 'served') {
    setData((data ?? []).map((x) => (x.id === k.id ? { ...x, status } : x)).filter((x) => x.status !== 'served'));
    await api(`/kots/${k.id}/status`, { body: { status } }).catch((e) => toast(e.message, 'error'));
  }

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Kitchen' }} />
      {sections.length > 1 && <Chips value={section} onChange={setSection} options={[{ value: '', label: 'All' }, ...sections.map((s) => ({ value: s, label: s }))]} />}
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {shown.length === 0 ? (
          <Empty icon="flame-outline" title="No tickets" hint="Orders sent to the kitchen show here." />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {shown.map((k) => {
              const mins = Math.max(0, Math.round((now - Date.parse(k.createdAt)) / 60_000));
              const late = mins >= 20 && k.status === 'new';
              return (
                <Card key={k.id} style={{ width: `${100 / cols - 2}%` as any, flexGrow: 1, gap: 6, borderWidth: 2, borderColor: k.status === 'ready' ? th.success : late ? th.danger : 'transparent' }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt style={{ fontWeight: '900', fontSize: 18 }}>{k.kind === 'dine_in' ? `Table ${k.table}` : ORDER_KIND_LABELS[k.kind]}</Txt>
                    <Txt v="small" color={late ? th.danger : th.sub} style={{ fontWeight: '700' }}>
                      {mins} min
                    </Txt>
                  </Row>
                  <Txt v="small">
                    {k.section} · KOT {k.number} · {k.orderNumber}
                  </Txt>
                  {k.items.map((i, n) => (
                    <View key={n}>
                      <Txt style={{ fontSize: 16, fontWeight: '700' }}>
                        {qtyToString(i.qty)} × {i.name}
                      </Txt>
                      {!!i.note && <Txt color={th.warn}>→ {i.note}</Txt>}
                    </View>
                  ))}
                  {k.status === 'new' ? <Btn small icon="checkmark" title="Ready" onPress={() => move(k, 'ready')} /> : <Btn small kind="secondary" icon="walk-outline" title="Served" onPress={() => move(k, 'served')} />}
                </Card>
              );
            })}
          </View>
        )}
      </Loader>
    </Screen>
  );
}
