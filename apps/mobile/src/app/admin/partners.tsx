import { Stack } from 'expo-router';
import { Share, View } from 'react-native';
import { Btn, Card, Empty, Loader, Row, Screen, Select, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';

interface Partner {
  tenantId: string;
  name: string;
  referralCode: string;
  signups: number;
  paying: number;
}

/** Resellers: give an account a referral code; sign-ups with it are credited to them. SaaS owner only. */
export default function PartnersScreen() {
  const toast = useToast();
  const { user } = useAuth();
  const partners = useApi<Partner[]>(user?.isPlatformAdmin ? '/platform/partners' : null);
  const tenants = useApi<{ id: string; name: string }[]>(user?.isPlatformAdmin ? '/platform/tenants' : null);

  async function set(tenantId: string, partner: boolean) {
    try {
      await api(`/platform/tenants/${tenantId}/partner`, { method: 'PUT', body: { partner } });
      partners.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  if (!user?.isPlatformAdmin) return <Screen>{null}</Screen>;
  const ids = new Set((partners.data ?? []).map((p) => p.tenantId));
  return (
    <Screen onRefresh={partners.reload}>
      <Stack.Screen options={{ title: 'Partners' }} />
      <Select<{ id: string; name: string }> label="Make an account a partner" placeholder="Choose an account" value="" items={(tenants.data ?? []).filter((t) => !ids.has(t.id))} getKey={(t) => t.id} getLabel={(t) => t.name} onSelect={(t) => set(t.id, true)} />
      <Txt v="small">New businesses enter the partner's code when they sign up; the sign-up is credited to the partner.</Txt>
      <Loader loading={partners.loading && !partners.data} error={partners.data ? '' : partners.error} onRetry={partners.reload}>
        {(partners.data ?? []).length === 0 && <Empty icon="people-outline" title="No partners yet" />}
        {(partners.data ?? []).map((p) => (
          <Card key={p.tenantId} style={{ gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '700' }}>{p.name}</Txt>
                <Txt v="small">
                  Code {p.referralCode} · {p.signups} sign-ups · {p.paying} paying
                </Txt>
              </View>
            </Row>
            <Row gap={8}>
              <Btn small style={{ flex: 1 }} kind="secondary" title="Share code" onPress={() => Share.share({ message: `Sign up for Kaarobarly with partner code ${p.referralCode}` })} />
              <Btn small style={{ flex: 1 }} kind="ghost" title="Remove partner" onPress={() => set(p.tenantId, false)} />
            </Row>
          </Card>
        ))}
      </Loader>
    </Screen>
  );
}
