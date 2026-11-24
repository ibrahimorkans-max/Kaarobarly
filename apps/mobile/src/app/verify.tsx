import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AUTH, AuthButton, AuthShell, CodeBoxes } from '@/components/auth-art';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/app-context';
import { tr } from '@/lib/i18n';
import type { User } from '@/lib/shared';

type Channel = 'email' | 'whatsapp';

/** Confirm the email (or WhatsApp number) with a 6-digit code. Can be skipped. */
export default function Verify() {
  const { user, updateUser } = useAuth();
  const [channels, setChannels] = useState({ email: false, whatsapp: false });
  const [channel, setChannel] = useState<Channel>('email');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const first = useRef(true);

  useEffect(() => {
    api<{ email: boolean; whatsapp: boolean }>('/auth/channels', { auth: false })
      .then((c) => {
        setChannels(c);
        const ch: Channel = c.email ? 'email' : 'whatsapp';
        setChannel(ch);
        if (first.current && (c.email || (c.whatsapp && user?.phone))) {
          first.current = false;
          void send(ch);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send(ch: Channel = channel) {
    setBusy('send');
    setError('');
    try {
      const r = await api<{ sentTo: string }>('/auth/verify/send', { body: { channel: ch } });
      setSentTo(r.sentTo);
      setChannel(ch);
      setWait(30);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  async function confirm(v = code) {
    if (v.length !== 6) return setError('Enter the 6-digit code');
    setBusy('check');
    setError('');
    try {
      const u = await api<User>('/auth/verify', { body: { code: v } });
      updateUser(u);
      router.replace('/');
    } catch (e: any) {
      setError(e.message);
      setCode('');
    } finally {
      setBusy('');
    }
  }

  const canWhatsApp = channels.whatsapp && !!user?.phone;
  return (
    <AuthShell
      pose="mail"
      title="Verify it's you"
      subtitle={sentTo ? `${tr('We sent a 6-digit code to')} ${sentTo}` : channel === 'whatsapp' ? 'We will send a code on WhatsApp' : 'We will send a code to your email'}
      back={false}
      footer={
        <Pressable accessibilityRole="button" onPress={() => router.replace('/')}>
          <Text style={{ color: AUTH.sub, fontWeight: '700' }}>{tr('Skip for now')}</Text>
        </Pressable>
      }>
      <CodeBoxes value={code} onChange={setCode} onDone={confirm} />
      {!!error && <Text style={{ color: AUTH.danger, textAlign: 'center' }}>{error}</Text>}
      <AuthButton title="Verify" onPress={() => confirm()} loading={busy === 'check'} disabled={code.length !== 6} />
      <View style={{ alignItems: 'center', gap: 10 }}>
        {wait > 0 ? (
          <Text style={{ color: AUTH.sub }}>
            {tr('Resend code in')} 0:{String(wait).padStart(2, '0')}
          </Text>
        ) : (
          <Text accessibilityRole="button" onPress={() => send()} style={{ color: AUTH.accent, fontWeight: '800' }}>
            {busy === 'send' ? tr('Sending…') : tr(sentTo ? 'Resend code' : 'Send code')}
          </Text>
        )}
        {channels.email && canWhatsApp && (
          <Text accessibilityRole="button" onPress={() => send(channel === 'email' ? 'whatsapp' : 'email')} style={{ color: AUTH.sub, fontWeight: '700' }}>
            {tr(channel === 'email' ? 'Send it on WhatsApp instead' : 'Send it by email instead')}
          </Text>
        )}
      </View>
    </AuthShell>
  );
}
