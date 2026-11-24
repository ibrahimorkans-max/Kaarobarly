import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { Badge, Btn, Card, Field, Loader, Row, Screen, Section, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';

interface Integrations {
  email: { host: string; port: number; secure: boolean; user: string; fromName: string; fromEmail: string; hasPass: boolean; ready: boolean } | null;
  whatsapp: { phoneNumberId: string; template: string; language: string; copyButton: boolean; hasToken: boolean; ready: boolean } | null;
  firebase: { ready: boolean; projectId: string; clientEmail: string; devices: number };
}

/** SaaS owner: connect email (SMTP), WhatsApp (Meta Cloud API) and Firebase. Secrets stay on the server. */
export default function IntegrationsScreen() {
  const th = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<Integrations>(user?.isPlatformAdmin ? '/platform/integrations' : null);
  const [email, setEmail] = useState({ host: '', port: '587', secure: false, user: '', pass: '', fromName: 'Kaarobarly', fromEmail: '' });
  const [wa, setWa] = useState({ phoneNumberId: '', accessToken: '', template: '', language: 'en', copyButton: true });
  const [testTo, setTestTo] = useState({ email: '', whatsapp: '' });
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (data?.email) setEmail((e) => ({ ...e, host: data.email!.host, port: String(data.email!.port), secure: data.email!.secure, user: data.email!.user, fromName: data.email!.fromName, fromEmail: data.email!.fromEmail }));
    if (data?.whatsapp) setWa((w) => ({ ...w, phoneNumberId: data.whatsapp!.phoneNumberId, template: data.whatsapp!.template, language: data.whatsapp!.language, copyButton: data.whatsapp!.copyButton }));
  }, [data]);

  async function run(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    try {
      await fn();
      toast(ok);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  const status = (ready?: boolean) => <Badge status={ready ? 'paid' : 'draft'} label={ready ? 'Connected' : 'Not set'} />;

  if (!user?.isPlatformAdmin) return <Screen>{null}</Screen>;
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Integrations' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        <Txt v="small">Codes for sign-up verification, forgotten passwords and sign-in go out through these. Customers see only the options that are connected.</Txt>

        <Section title="Email (SMTP)" action={status(data?.email?.ready)}>
          <Card style={{ gap: 10 }}>
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <Field style={{ flex: 2 }} label="SMTP server" value={email.host} onChangeText={(v) => setEmail({ ...email, host: v })} placeholder="smtp.gmail.com" autoCapitalize="none" />
              <Field style={{ flex: 1 }} label="Port" value={email.port} onChangeText={(v) => setEmail({ ...email, port: v })} keyboardType="number-pad" />
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt style={{ flex: 1 }}>SSL from the start (port 465)</Txt>
              <Switch accessibilityLabel="SSL" value={email.secure} onValueChange={(v) => setEmail({ ...email, secure: v, port: v ? '465' : email.port === '465' ? '587' : email.port })} />
            </Row>
            <Field label="Username" value={email.user} onChangeText={(v) => setEmail({ ...email, user: v })} autoCapitalize="none" />
            <Field label={data?.email?.hasPass ? 'Password (saved; type to change)' : 'Password / app password'} value={email.pass} onChangeText={(v) => setEmail({ ...email, pass: v })} secureTextEntry autoCapitalize="none" />
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <Field style={{ flex: 1 }} label="From name" value={email.fromName} onChangeText={(v) => setEmail({ ...email, fromName: v })} />
              <Field style={{ flex: 1.4 }} label="From email" value={email.fromEmail} onChangeText={(v) => setEmail({ ...email, fromEmail: v })} keyboardType="email-address" autoCapitalize="none" />
            </Row>
            <Btn icon="save-outline" title="Save email settings" loading={busy === 'email'} onPress={() => run('email', () => api('/platform/integrations/email', { method: 'PUT', body: { ...email, port: Number(email.port) || 587 } }), 'Email saved')} />
            <Row style={{ alignItems: 'flex-end' }}>
              <Field style={{ flex: 1 }} label="Send a test to" value={testTo.email} onChangeText={(v) => setTestTo({ ...testTo, email: v })} keyboardType="email-address" autoCapitalize="none" />
              <Btn small kind="secondary" title="Test" loading={busy === 'temail'} disabled={!data?.email?.ready || !testTo.email} onPress={() => run('temail', () => api('/platform/integrations/test', { body: { channel: 'email', to: testTo.email } }), 'Test email sent')} />
            </Row>
            <Txt v="small">Gmail: turn on 2-step verification and use an App password, server smtp.gmail.com, port 587.</Txt>
          </Card>
        </Section>

        <Section title="WhatsApp (Meta Cloud API)" action={status(data?.whatsapp?.ready)}>
          <Card style={{ gap: 10 }}>
            <Field label="Phone number ID" value={wa.phoneNumberId} onChangeText={(v) => setWa({ ...wa, phoneNumberId: v })} keyboardType="number-pad" placeholder="From Meta → WhatsApp → API setup" />
            <Field label={data?.whatsapp?.hasToken ? 'Access token (saved; paste to change)' : 'Permanent access token'} value={wa.accessToken} onChangeText={(v) => setWa({ ...wa, accessToken: v })} secureTextEntry autoCapitalize="none" />
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <Field style={{ flex: 2 }} label="Code template name" value={wa.template} onChangeText={(v) => setWa({ ...wa, template: v.trim().toLowerCase() })} autoCapitalize="none" placeholder="kaarobarly_code" />
              <Field style={{ flex: 1 }} label="Language" value={wa.language} onChangeText={(v) => setWa({ ...wa, language: v.trim() })} autoCapitalize="none" placeholder="en" />
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt style={{ flex: 1 }}>Template has a "Copy code" button</Txt>
              <Switch accessibilityLabel="Copy code button" value={wa.copyButton} onValueChange={(v) => setWa({ ...wa, copyButton: v })} />
            </Row>
            <Btn icon="save-outline" title="Save WhatsApp settings" loading={busy === 'wa'} onPress={() => run('wa', () => api('/platform/integrations/whatsapp', { method: 'PUT', body: wa }), 'WhatsApp saved')} />
            <Row style={{ alignItems: 'flex-end' }}>
              <Field style={{ flex: 1 }} label="Send a test code to" value={testTo.whatsapp} onChangeText={(v) => setTestTo({ ...testTo, whatsapp: v })} keyboardType="phone-pad" placeholder="0300 1234567" />
              <Btn small kind="secondary" title="Test" loading={busy === 'twa'} disabled={!data?.whatsapp?.ready || !testTo.whatsapp} onPress={() => run('twa', () => api('/platform/integrations/test', { body: { channel: 'whatsapp', to: testTo.whatsapp } }), 'Test code sent (123456)')} />
            </Row>
            <Txt v="small">In Meta Business Manager create an "Authentication" message template with a one-time-code button; when Meta approves it, use its name here. The token should be a permanent System User token.</Txt>
          </Card>
        </Section>

        <Section title="Firebase" action={status(data?.firebase.ready)}>
          <Card style={{ gap: 8 }}>
            <Row>
              <Ionicons name="logo-firebase" size={22} color="#F5820D" />
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '700' }}>{data?.firebase.ready ? `Project ${data.firebase.projectId}` : 'Push notifications'}</Txt>
                <Txt v="small">{data?.firebase.ready ? `${data.firebase.devices} phones registered` : 'Paste the Firebase service-account key to send notifications'}</Txt>
              </View>
            </Row>
            <Btn small kind="secondary" title={data?.firebase.ready ? 'Change key' : 'Set up'} onPress={() => router.push('/admin/push')} />
            <Txt v="small" color={th.sub}>
              The app also needs google-services.json from the same Firebase project when it is built.
            </Txt>
          </Card>
        </Section>
      </Loader>
    </Screen>
  );
}
