import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { AUTH, AuthButton, AuthField, AuthLink, AuthShell } from '@/components/auth-art';
import { useAuth } from '@/lib/app-context';
import { tr } from '@/lib/i18n';

/** Create an account: business, owner, email, WhatsApp and password. A code then confirms the email or number. */
export default function Signup() {
  const { register } = useAuth();
  const [f, setF] = useState({ businessName: '', name: '', email: '', phone: '', password: '', referralCode: '' });
  const [partner, setPartner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit() {
    const e: Record<string, string> = {};
    if (f.businessName.trim().length < 2) e.businessName = 'Enter your business name';
    if (f.name.trim().length < 2) e.name = 'Enter your name';
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Enter a valid email';
    if (f.phone.trim() && f.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter the number like 0300 1234567';
    if (f.password.length < 8) e.password = 'At least 8 characters';
    setErrors(e);
    setError('');
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const ch = await register({ businessName: f.businessName.trim(), name: f.name.trim(), email: f.email.trim(), password: f.password, phone: f.phone.trim() || undefined, referralCode: f.referralCode.trim() || undefined });
      // confirm the email or number when the service can send codes
      if (ch.email || (ch.whatsapp && f.phone.trim())) router.replace('/verify');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell pose="star" title="Create Account" subtitle="Set up your business in a minute" footer={<AuthLink text="Already have an account?" link="Login" onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} />}>
      <AuthField icon="storefront-outline" label="Business name" value={f.businessName} onChangeText={set('businessName')} autoCapitalize="words" error={errors.businessName} />
      <AuthField icon="person-outline" label="Your name" value={f.name} onChangeText={set('name')} autoCapitalize="words" autoComplete="name" error={errors.name} />
      <AuthField icon="mail-outline" label="Email Address" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} error={errors.email} />
      <AuthField icon="logo-whatsapp" label="WhatsApp number (optional)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" error={errors.phone} />
      <AuthField icon="lock-closed-outline" label="Password (8+ characters)" password value={f.password} onChangeText={set('password')} autoComplete="new-password" error={errors.password} onSubmitEditing={submit} />
      {partner ? (
        <AuthField icon="ribbon-outline" label="Partner code (optional)" value={f.referralCode} onChangeText={set('referralCode')} autoCapitalize="characters" />
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setPartner(true)}>
          <Text style={{ color: AUTH.accent, fontWeight: '700', fontSize: 13.5, textAlign: 'right' }}>{tr('Have a partner code?')}</Text>
        </Pressable>
      )}
      {!!error && <Text style={{ color: AUTH.danger, textAlign: 'center' }}>{error}</Text>}
      <AuthButton title="Sign up" onPress={submit} loading={busy} />
      <Text style={{ color: AUTH.sub, fontSize: 12, textAlign: 'center' }}>{tr('Your data stays private to your business.')}</Text>
    </AuthShell>
  );
}
