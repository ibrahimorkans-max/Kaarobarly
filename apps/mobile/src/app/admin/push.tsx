import { Stack } from 'expo-router';
import { useState } from 'react';
import { Btn, Card, Field, KV, Loader, Screen, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';

/** SaaS owner: the Firebase service-account key that lets the server send push notifications. */
export default function AdminPushScreen() {
  const th = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<{ ready: boolean; projectId: string; clientEmail: string; devices: number }>(user?.isPlatformAdmin ? '/platform/push' : null);
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api('/platform/push', { method: 'PUT', body: { serviceAccount: json.trim() } });
      setJson('');
      toast('Firebase key saved');
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  if (!user?.isPlatformAdmin) return <Screen>{null}</Screen>;
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Push notifications' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <Card>
            <KV k="Status" v={data.ready ? 'Ready' : 'Not set up'} bold color={data.ready ? th.success : th.warn} />
            {data.ready && <KV k="Firebase project" v={data.projectId} />}
            {data.ready && <KV k="Sender" v={data.clientEmail} />}
            <KV k="Registered phones" v={String(data.devices)} />
          </Card>
        )}
      </Loader>
      <Txt v="small">
        In the Firebase console (same project as the app's google-services.json): Project settings → Service accounts → Generate new private key. Paste the whole downloaded file here. It stays on the server and never reaches customers' phones.
      </Txt>
      <Field label="Service-account JSON" value={json} onChangeText={setJson} multiline autoCapitalize="none" style={{ minHeight: 140 } as any} placeholder='{"type": "service_account", "project_id": …}' />
      <Btn icon="key-outline" title="Save key" onPress={save} loading={busy} disabled={json.trim().length < 50} />
    </Screen>
  );
}
