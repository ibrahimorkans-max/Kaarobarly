import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Btn, Card, Chips, Empty, Field, IconBtn, Loader, Row, Screen, Sheet, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { STOCK_ALERT_INFO, STOCK_ALERT_TYPES, type StockAlert, type StockAlertSettings, type StockAlertType } from '@/lib/shared';

const ACTION_LABEL: Record<StockAlert['action'], string> = { reorder: 'Reorder slip', count: 'Count it', item: 'Open', expiry: 'Expiry', order: 'Open order', labels: 'Print labels', price: 'Check price' };

/** Every open stock and buying alert, most urgent first. Alerts close by themselves when fixed. */
export default function StockAlertsScreen() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing, setData } = useApi<StockAlert[]>('/stock/alerts');
  const settings = useApi<StockAlertSettings>('/stock/alert-settings');
  const [type, setType] = useState<'' | StockAlertType>('');
  const [edit, setEdit] = useState<{ off: StockAlertType[]; deadDays: string; expiryDays: string; runningOutDays: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const color = { danger: th.danger, warn: th.warn, info: th.info };
  const present = [...new Set((data ?? []).map((a) => a.type))];
  const shown = (data ?? []).filter((a) => !type || a.type === type);

  function act(a: StockAlert) {
    if (a.action === 'reorder') router.push('/stock/reorder');
    else if (a.action === 'expiry') router.push('/stock/expiry');
    else if (a.action === 'labels') router.push({ pathname: '/labels', params: { ids: a.itemId } });
    else if (a.action === 'order' && a.refId) router.push({ pathname: '/order/[id]', params: { id: a.refId } });
    else if (a.action === 'price') router.push('/services');
    else if (a.itemId) router.push({ pathname: '/stock/[id]', params: { id: a.itemId } });
  }
  async function dismiss(a: StockAlert) {
    setData((data ?? []).filter((x) => x.key !== a.key));
    await api('/alerts/dismiss', { body: { key: a.key } }).catch((e) => toast(e.message, 'error'));
  }
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      await api('/stock/alert-settings', { method: 'PUT', body: { off: edit.off, deadDays: Number(edit.deadDays) || 60, expiryDays: Number(edit.expiryDays) || 30, runningOutDays: Number(edit.runningOutDays) || 7 } });
      toast('Alert settings saved');
      setEdit(null);
      settings.reload();
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Stock alerts' }} />
      <Row gap={8}>
        <Btn style={{ flex: 1 }} small kind="secondary" icon="document-text-outline" title="Reorder slip" onPress={() => router.push('/stock/reorder')} />
        <Btn style={{ flex: 1 }} small kind="secondary" icon="hourglass-outline" title="Expiry" onPress={() => router.push('/stock/expiry')} />
        {can('stock.manage') && settings.data && <IconBtn icon="options-outline" label="Alert settings" onPress={() => setEdit({ off: settings.data!.off, deadDays: String(settings.data!.deadDays), expiryDays: String(settings.data!.expiryDays), runningOutDays: String(settings.data!.runningOutDays) })} />}
      </Row>
      {present.length > 1 && <Chips value={type} onChange={setType} options={[{ value: '' as const, label: `All (${data?.length ?? 0})` }, ...present.map((t) => ({ value: t, label: `${STOCK_ALERT_INFO[t].label} (${data!.filter((a) => a.type === t).length})` }))]} />}
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {shown.length === 0 ? (
          <Empty icon="checkmark-circle-outline" title="All clear" hint="Stock levels, expiry and orders look fine." />
        ) : (
          shown.map((a) => (
            <Card key={a.key} label={a.title} onPress={() => act(a)}>
              <Row>
                <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: color[a.level] }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="small" color={color[a.level]} style={{ fontWeight: '700' }}>
                    {STOCK_ALERT_INFO[a.type].label}
                  </Txt>
                  <Txt style={{ fontWeight: '700' }}>{a.title}</Txt>
                  <Txt v="small">{a.sub}</Txt>
                  <Txt v="small" color={th.primary} style={{ fontWeight: '700', marginTop: 2 }}>
                    {ACTION_LABEL[a.action]} ›
                  </Txt>
                </View>
                <IconBtn icon="close" label="Dismiss" onPress={() => dismiss(a)} />
              </Row>
            </Card>
          ))
        )}
      </Loader>
      <Sheet visible={!!edit} title="Stock alert settings" onClose={() => setEdit(null)}>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {STOCK_ALERT_TYPES.map((t) => {
            const on = !edit?.off.includes(t);
            return (
              <Pressable key={t} accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => setEdit((e) => e && { ...e, off: on ? [...e.off, t] : e.off.filter((x) => x !== t) })} style={{ paddingVertical: 8 }}>
                <Row>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? th.primary : th.sub} />
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '600' }}>{STOCK_ALERT_INFO[t].label}</Txt>
                    <Txt v="small">{STOCK_ALERT_INFO[t].hint}</Txt>
                  </View>
                </Row>
              </Pressable>
            );
          })}
        </Card>
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Dead stock after (days)" keyboardType="number-pad" value={edit?.deadDays ?? ''} onChangeText={(v) => setEdit((e) => e && { ...e, deadDays: v })} />
          <Field style={{ flex: 1 }} label="Expiry warning (days)" keyboardType="number-pad" value={edit?.expiryDays ?? ''} onChangeText={(v) => setEdit((e) => e && { ...e, expiryDays: v })} />
        </Row>
        <Field label="Running out: stock lasts fewer than (days)" keyboardType="number-pad" value={edit?.runningOutDays ?? ''} onChangeText={(v) => setEdit((e) => e && { ...e, runningOutDays: v })} />
        <Btn title="Save" onPress={save} loading={busy} />
      </Sheet>
    </Screen>
  );
}
