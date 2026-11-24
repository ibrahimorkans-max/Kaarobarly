import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AUTH, AuthAlternatives, AuthButton, AuthField, AuthLink, AuthShell } from '@/components/auth-art';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/app-context';
import { tr } from '@/lib/i18n';
import { local } from '@/lib/storage';

/** Sign in with email or WhatsApp number and password, or with a code sent by WhatsApp or email. */
export default function Login() {
  const { signIn } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [channels, setChannels] = useState({ email: false, whatsapp: false });

  useEffect(() => {
    // first launch on this device: show the introduction once
    local
      .get<boolean>('kaarobarly.onboarded')
      .then((seen) => !seen && router.replace('/onboarding'))
      .catch(() => {});
    api<{ email: boolean; whatsapp: boolean }>('/auth/channels', { auth: false })
      .then(setChannels)
      .catch(() => {});
  }, []);

  async function submit() {
    setError('');
    if (!login.trim() || !password) return setError('Enter your email or WhatsApp number, and your password.');
    setBusy(true);
    try {
      await signIn(login.trim(), password);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const alt = [
    ...(channels.whatsapp ? [{ icon: 'logo-whatsapp' as const, color: '#25D366', label: 'WhatsApp code', onPress: () => router.push({ pathname: '/forgot', params: { mode: 'login', channel: 'whatsapp', login } }) }] : []),
    ...(channels.email ? [{ icon: 'mail' as const, color: AUTH.accent, label: 'Email code', onPress: () => router.push({ pathname: '/forgot', params: { mode: 'login', channel: 'email', login } }) }] : []),
  ];

  return (
    <AuthShell pose="wave" title="Welcome Back!" subtitle="Let's get you signed in" back={false} footer={<AuthLink text="Don't have an account?" link="Sign up" onPress={() => router.push('/signup')} />}>
      <AuthField icon="person-outline" label="Email or WhatsApp number" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="username" />
      <AuthField icon="lock-closed-outline" label="Password" password value={password} onChangeText={setPassword} autoComplete="current-password" onSubmitEditing={submit} returnKeyType="go" />
      <View style={{ alignItems: 'flex-end' }}>
        <Text accessibilityRole="link" onPress={() => router.push({ pathname: '/forgot', params: { mode: 'reset', login } })} style={{ color: AUTH.accent, fontWeight: '700', fontSize: 13.5 }}>
          {tr('Forgot Password?')}
        </Text>
      </View>
      {!!error && <Text style={{ color: AUTH.danger, textAlign: 'center' }}>{error}</Text>}
      <AuthButton title="Login" onPress={submit} loading={busy} />
      <AuthAlternatives items={alt} />
    </AuthShell>
  );
}
