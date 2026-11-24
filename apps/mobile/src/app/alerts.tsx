import { router } from 'expo-router';
import { View } from 'react-native';
import { Btn, Card, Empty, IconBtn, Loader, Row, Screen, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';

interface Alert {
  key: string;
  level: 'info' | 'warn' | 'danger';
  title: string;
  sub: string;
  refType: string;
  refId: string;
}

/** Things that need attention, from your alert rules. Works offline. */
export default function Alerts() {
  const th = useTheme();
  const toast = useToast();
  const { data, loading, error, reload, refreshing, setData } = useApi<Alert[]>('/alerts');
  const color = { danger: th.danger, warn: th.warn, info: th.info };
  const open = (a: Alert) => {
    if (a.refType === 'invoice') router.push({ pathname: '/invoice/[id]', params: { id: a.refId } });
    else if (a.refType === 'stock') router.push({ pathname: '/stock/[id]', params: { id: a.refId } });
    else if (a.refType === 'purchase') router.push({ pathname: '/purchase/[id]', params: { id: a.refId } });
    else if (a.refType === 'cheque') router.push('/cheques');
    else if (a.refType === 'shift') router.push({ pathname: '/pos/shift', params: { id: a.refId } });
    else router.push('/finance');
  };
  async function dismiss(a: Alert) {
    setData((data ?? []).filter((x) => x.key !== a.key));
    await api('/alerts/dismiss', { body: { key: a.key } }).catch((e) => toast(e.message, 'error'));
  }
  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Btn small kind="ghost" icon="flash-outline" title="Alert rules" onPress={() => router.push('/automation')} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {(data ?? []).length === 0 ? (
          <Empty icon="notifications-off-outline" title="All clear" hint="Nothing needs attention. Set what to watch in Automation." />
        ) : (
          data!.map((a) => (
            <Card key={a.key} label={a.title} onPress={() => open(a)}>
              <Row>
                <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: color[a.level] }} />
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>{a.title}</Txt>
                  <Txt v="small">{a.sub}</Txt>
                </View>
                <IconBtn icon="close" label="Dismiss" onPress={() => dismiss(a)} />
              </Row>
            </Card>
          ))
        )}
      </Loader>
    </Screen>
  );
}
