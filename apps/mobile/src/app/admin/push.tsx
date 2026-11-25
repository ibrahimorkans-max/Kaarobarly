import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Btn, Card, Field, KV, Loader, Screen, Section, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';

interface ClientConfig {
  projectId: string;
  senderId: string;
  appId: string;
  apiKey: string;
  storageBucket: string;
}
interface FcmStatus {
  ready: boolean;
  projectId: string;
  clientEmail: string;
  devices: number;
  client: ClientConfig | null;
  clientReady: boolean;
  sameProject: boolean;
}

/**
 * SaaS owner: connect Firebase without rebuilding the app.
 * 1) the phone side (values from google-services.json), which phones fetch at sign-in;
 * 2) the server side (service-account key), which sends the notifications.
 */
export default function AdminPushScreen() {
  const th = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<FcmStatus>(user?.isPlatformAdmin ? '/platform/push' : null);
  const [json, setJson] = useState('');
  const [gs, setGs] = useState('');
  const [fields, setFields] = useState<ClientConfig>({ projectId: '', senderId: '', appId: '', apiKey: '', storageBucket: '' });
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (data?.client) setFields(data.client);
  }, [data]);

  async function run(name: string, fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(name);
    try {
      await fn();
      after?.();
      toast(ok);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  const set = (k: keyof ClientConfig) => (v: string) => setFields({ ...fields, [k]: v.trim() });

  if (!user?.isPlatformAdmin) return <Screen>{null}</Screen>;
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Push notifications' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <Card>
            <KV k="Phone connection" v={data.clientReady ? `Set (${data.client?.projectId})` : 'Not set'} bold color={data.clientReady ? th.success : th.warn} />
            <KV k="Server key" v={data.ready ? `Set (${data.projectId})` : 'Not set'} bold color={data.ready ? th.success : th.warn} />
            {data.ready && <KV k="Sender" v={data.clientEmail} />}
            <KV k="Registered phones" v={String(data.devices)} />
            {!data.sameProject && <Txt v="small" color={th.danger}>The phone values and the server key are from different Firebase projects. Both must come from the same project.</Txt>}
          </Card>
        )}
      </Loader>

      <Section title="1. Phone connection (google-services.json)">
        <Card style={{ gap: 10 }}>
          <Txt v="small">
            Firebase console → Project settings → General → Your apps → Android app with package com.zhtrader.kaarobarly → download google-services.json. Paste the whole file below, or fill the four fields by hand. Phones pick these up the next time they open the app; no new app build is needed.
          </Txt>
          <Field
            label="google-services.json"
            value={gs}
            onChangeText={setGs}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 120 } as any}
            placeholder={'{\n  "project_info": { "project_number": "123456789012", "project_id": "kaarobarly-12345", … },\n  "client": [ … ]\n}'}
          />
          <Btn icon="document-text-outline" title="Read the file and save" loading={busy === 'gs'} disabled={gs.trim().length < 50} onPress={() => run('gs', () => api('/platform/push/client', { method: 'PUT', body: { googleServices: gs.trim() } }), 'Phone connection saved', () => setGs(''))} />

          <Txt v="small" color={th.sub}>Or type the values (Project settings → General):</Txt>
          <Field label="Project ID" value={fields.projectId} onChangeText={set('projectId')} autoCapitalize="none" autoCorrect={false} placeholder="kaarobarly-12345" />
          <Field label="Sender ID (project number)" value={fields.senderId} onChangeText={set('senderId')} keyboardType="number-pad" placeholder="123456789012" />
          <Field label="App ID (Android)" value={fields.appId} onChangeText={set('appId')} autoCapitalize="none" autoCorrect={false} placeholder="1:123456789012:android:a1b2c3d4e5f6a7b8" />
          <Field label="Web API key" value={fields.apiKey} onChangeText={set('apiKey')} autoCapitalize="none" autoCorrect={false} placeholder="AIzaSy…" />
          <Field label="Storage bucket (optional)" value={fields.storageBucket} onChangeText={set('storageBucket')} autoCapitalize="none" autoCorrect={false} placeholder="kaarobarly-12345.appspot.com" />
          <Btn icon="save-outline" kind="secondary" title="Save these values" loading={busy === 'fields'} disabled={!fields.projectId || !fields.senderId || !fields.appId || !fields.apiKey} onPress={() => run('fields', () => api('/platform/push/client', { method: 'PUT', body: fields }), 'Phone connection saved')} />
          {data?.clientReady && <Btn small kind="danger" title="Remove phone connection" loading={busy === 'clear'} onPress={() => run('clear', () => api('/platform/push/client', { method: 'DELETE' }), 'Removed')} />}
        </Card>
      </Section>

      <Section title="2. Server key (service account)">
        <Card style={{ gap: 10 }}>
          <Txt v="small">
            Same Firebase project → Project settings → Service accounts → Generate new private key. Paste the whole downloaded file. It stays on the server and never reaches customers' phones.
          </Txt>
          <Field
            label={data?.ready ? 'Service-account JSON (saved; paste to replace)' : 'Service-account JSON'}
            value={json}
            onChangeText={setJson}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 120 } as any}
            placeholder={'{\n  "type": "service_account",\n  "project_id": "kaarobarly-12345",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n…",\n  "client_email": "firebase-adminsdk-…@kaarobarly-12345.iam.gserviceaccount.com"\n}'}
          />
          <Btn icon="key-outline" title="Save key" loading={busy === 'sa'} disabled={json.trim().length < 50} onPress={() => run('sa', () => api('/platform/push', { method: 'PUT', body: { serviceAccount: json.trim() } }), 'Firebase key saved', () => setJson(''))} />
        </Card>
      </Section>
      <Txt v="small" color={th.sub}>
        Phones need the app version that includes the Firebase connector (the next app update). After saving, each owner opens More → Notifications and taps Send test.
      </Txt>
    </Screen>
  );
}
