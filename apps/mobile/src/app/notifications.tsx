import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { Btn, Card, KV, Loader, Notice, Row, Screen, Section, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { registerPush, type PushState } from '@/lib/push';

const EVENTS: [string, string, string][] = [
  ['payment', 'Payments received', 'When a payment is recorded'],
  ['online_order', 'Online orders', 'A customer ordered from your shop link'],
  ['shift_variance', 'Drawer short or over', 'A shift closed with a cash difference'],
  ['claim', 'Expense claims', 'A claim is waiting for approval'],
  ['purchase_request', 'Purchase requests', 'A request is waiting for approval'],
  ['daily_digest', 'Morning summary', 'At 9 am: overdue invoices and stock alerts'],
];

/** Push notifications on this phone, and (owner) what the business is told about. */
export default function NotificationsScreen() {
  const th = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload, setData } = useApi<{ off: string[]; ready: boolean; devices: number }>('/push/settings');
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState('');
  const owner = user?.role === 'owner';

  async function turnOn() {
    setBusy('on');
    const s = await registerPush(true);
    setState(s);
    setBusy('');
    reload();
    if (s === 'denied') toast('Notifications are blocked: allow them in the phone settings', 'error');
  }
  async function test() {
    setBusy('test');
    try {
      const r = await api<{ sent: number }>('/push/test', { method: 'POST' });
      toast(r.sent ? 'Sent: it should arrive in a moment' : 'Nothing was sent: this phone is not registered yet', r.sent ? undefined : 'error');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function toggle(k: string) {
    if (!data) return;
    const off = data.off.includes(k) ? data.off.filter((x) => x !== k) : [...data.off, k];
    setData({ ...data, off });
    await api('/push/settings', { method: 'PUT', body: { off } }).catch((e) => toast(e.message, 'error'));
  }

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <>
            {!data.ready && <Notice kind="warn">Push notifications are not switched on for Kaarobarly yet. The service owner adds the Firebase key in the admin area.</Notice>}
            {Platform.OS === 'web' && <Notice kind="info">Push notifications work in the Android app.</Notice>}
            <Card style={{ gap: 6 }}>
              <KV k="This phone" v={data.devices ? 'Registered' : state === 'denied' ? 'Blocked in phone settings' : state === 'unavailable' ? 'Firebase not connected yet' : state === 'restart' ? 'Close and reopen the app' : 'Not registered'} bold color={data.devices ? th.success : th.warn} />
              <Row gap={8}>
                <Btn style={{ flex: 1 }} small icon="notifications-outline" title={data.devices ? 'Register again' : 'Turn on'} onPress={turnOn} loading={busy === 'on'} disabled={Platform.OS === 'web'} />
                <Btn style={{ flex: 1 }} small kind="secondary" title="Send a test" onPress={test} loading={busy === 'test'} disabled={!data.devices} />
              </Row>
              {state === 'denied' && Platform.OS !== 'web' && <Btn small kind="ghost" title="Open phone settings" onPress={() => Linking.openSettings()} />}
            </Card>
            <Section title={owner ? 'Tell owners and managers about' : 'What you are told about'}>
              <Card style={{ gap: 0, paddingVertical: 4 }}>
                {EVENTS.map(([k, label, hint]) => {
                  const on = !data.off.includes(k);
                  return (
                    <Pressable key={k} accessibilityRole="switch" accessibilityState={{ checked: on }} disabled={!owner} onPress={() => toggle(k)} style={{ paddingVertical: 9 }}>
                      <Row>
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? th.primary : th.sub} />
                        <View style={{ flex: 1 }}>
                          <Txt style={{ fontWeight: '600' }}>{label}</Txt>
                          <Txt v="small">{hint}</Txt>
                        </View>
                      </Row>
                    </Pressable>
                  );
                })}
              </Card>
              <Txt v="small">Notifications go to the phones of owners and managers.</Txt>
            </Section>
          </>
        )}
      </Loader>
    </Screen>
  );
}
