import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AUTH, AuthButton, AuthField, AuthShell, CodeBoxes } from '@/components/auth-art';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/app-context';
import { tr } from '@/lib/i18n';
import type { User } from '@/lib/shared';

type Channel = 'email' | 'whatsapp';

/**
 * Forgot password (mode=reset) or sign in with a code (mode=login): get a code by WhatsApp or
 * email, then enter it (and a new password when resetting). Ends signed in.
 */
export default function Forgot() {
  const params = useLocalSearchParams<{ mode?: string; channel?: string; login?: string }>();
  const mode = params.mode === 'login' ? 'login' : 'reset';
  const { adoptSession } = useAuth();
  const [channels, setChannels] = useState({ email: false, whatsapp: false });
  const [channel, setChannel] = useState<Channel>(params.channel === 'whatsapp' ? 'whatsapp' : 'email');
  const [login, setLogin] = useState(params.login ?? '');
  const [step, setStep] = useState<1 | 2>(1);
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ email: boolean; whatsapp: boolean }>('/auth/channels', { auth: false })
      .then((c) => {
        setChannels(c);
        if (!c[channel]) setChannel(c.email ? 'email' : 'whatsapp');
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send() {
    setError('');
    if (!login.trim()) return setError(channel === 'whatsapp' ? 'Enter your WhatsApp number' : 'Enter your email');
    setBusy(true);
    try {
      const r = await api<{ sentTo: string }>('/auth/code', { auth: false, body: { login: login.trim(), purpose: mode, channel } });
      setSentTo(r.sentTo);
      setStep(2);
      setWait(30);
      setCode('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function finish(v = code) {
    setError('');
    if (v.length !== 6) return setError('Enter the 6-digit code');
    if (mode === 'reset' && password.length < 8) return setError('Choose a new password of at least 8 characters');
    setBusy(true);
    try {
      const s = await api<{ accessToken: string; refreshToken: string; user: User }>(mode === 'reset' ? '/auth/reset' : '/auth/login-code', {
        auth: false,
        body: { login: login.trim(), code: v, ...(mode === 'reset' ? { password } : {}), deviceName: 'app' },
      });
      await adoptSession(s);
    } catch (e: any) {
      setError(e.message);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const none = !channels.email && !channels.whatsapp;
  if (step === 1)
    return (
      <AuthShell pose="key" title={mode === 'reset' ? 'Forgot Password?' : 'Sign in with a code'} subtitle={mode === 'reset' ? "No worries! We'll send you a code to reset it" : "We'll send a one-time code, no password needed"}>
        {none ? (
          <Text style={{ color: AUTH.sub, textAlign: 'center', lineHeight: 20 }}>{tr('Codes by email or WhatsApp are not switched on yet. Ask the Tijar team, or your business owner, to reset your password.')}</Text>
        ) : (
          <>
            {channels.email && channels.whatsapp && (
              <View style={{ flexDirection: 'row', backgroundColor: AUTH.accentSoft, borderRadius: 14, padding: 4 }}>
                {(['email', 'whatsapp'] as Channel[]).map((c) => (
                  <Pressable key={c} accessibilityRole="tab" accessibilityState={{ selected: channel === c }} onPress={() => setChannel(c)} style={{ flex: 1, height: 42, borderRadius: 11, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: channel === c ? '#fff' : 'transparent' }}>
                    <Ionicons name={c === 'email' ? 'mail-outline' : 'logo-whatsapp'} size={18} color={channel === c ? (c === 'email' ? AUTH.accent : '#25D366') : AUTH.sub} />
                    <Text style={{ fontWeight: '800', color: channel === c ? AUTH.text : AUTH.sub }}>{tr(c === 'email' ? 'Email' : 'WhatsApp')}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <AuthField
              icon={channel === 'whatsapp' ? 'logo-whatsapp' : 'mail-outline'}
              label={channel === 'whatsapp' ? 'WhatsApp number' : 'Email Address'}
              value={login}
              onChangeText={setLogin}
              keyboardType={channel === 'whatsapp' ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={send}
            />
            {!!error && <Text style={{ color: AUTH.danger, textAlign: 'center' }}>{error}</Text>}
            <AuthButton title="Send code" onPress={send} loading={busy} />
          </>
        )}
      </AuthShell>
    );

  return (
    <AuthShell pose="mail" title="Enter the code" subtitle={sentTo ? `${tr('We sent a 6-digit code to')} ${sentTo}` : 'If an account matches, a code is on its way'}>
      <CodeBoxes value={code} onChange={setCode} onDone={mode === 'login' ? finish : undefined} />
      {mode === 'reset' && <AuthField icon="lock-closed-outline" label="New password (8+ characters)" password value={password} onChangeText={setPassword} autoComplete="new-password" onSubmitEditing={() => finish()} />}
      {!!error && <Text style={{ color: AUTH.danger, textAlign: 'center' }}>{error}</Text>}
      <AuthButton title={mode === 'reset' ? 'Reset password' : 'Sign in'} onPress={() => finish()} loading={busy} disabled={code.length !== 6} />
      <View style={{ alignItems: 'center', gap: 10 }}>
        {wait > 0 ? (
          <Text style={{ color: AUTH.sub }}>
            {tr('Resend code in')} 0:{String(wait).padStart(2, '0')}
          </Text>
        ) : (
          <Text accessibilityRole="button" onPress={send} style={{ color: AUTH.accent, fontWeight: '800' }}>
            {tr('Resend code')}
          </Text>
        )}
        <Text accessibilityRole="button" onPress={() => setStep(1)} style={{ color: AUTH.sub, fontWeight: '700' }}>
          {tr(channel === 'whatsapp' ? 'Change number' : 'Change email')}
        </Text>
      </View>
    </AuthShell>
  );
}
