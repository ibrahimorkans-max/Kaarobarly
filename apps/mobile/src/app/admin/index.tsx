import { router } from 'expo-router';
import { View } from 'react-native';
import { MenuRow } from '@/components/rows';
import { Card, Empty, KV, Loader, Row, Screen, Section, Txt, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useAuth } from '@/lib/app-context';
import { PLANS, PLAN_IDS } from '@/lib/shared';

interface Overview {
  accounts: number;
  newThisMonth: number;
  byPlan: Record<string, number>;
  trials: number;
  paying: number;
  mrr: number;
  openRequests: number;
  invoicesThisMonth: number;
  aiThisMonth: number;
  users: number;
  ai: { ready: boolean; model: string };
}

/** The SaaS owner's own area: the whole service at a glance. Customers never see it. */
export default function AdminHome() {
  const { user } = useAuth();
  const { data: o, loading, error, reload, refreshing } = useApi<Overview>(user?.isPlatformAdmin ? '/platform/overview' : null);

  if (!user?.isPlatformAdmin)
    return (
      <Screen>
        <Empty icon="lock-closed-outline" title="Not available" />
      </Screen>
    );

  const tile = (label: string, value: string) => (
    <Card style={{ flex: 1 }}>
      <Txt v="small">{label}</Txt>
      <Txt style={{ fontWeight: '800', fontSize: 20 }}>{value}</Txt>
    </Card>
  );

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <View>
        <Txt v="title">Kaarobarly SaaS</Txt>
        <Txt v="sub">Signed in as {user.email} · service owner</Txt>
      </View>
      <Loader loading={loading && !o} error={o ? '' : error} onRetry={reload}>
        {o && (
          <>
            <Row gap={10}>
              {tile('Accounts', String(o.accounts))}
              {tile('Paying', String(o.paying))}
              {tile('Monthly revenue', fm(o.mrr))}
            </Row>
            <Row gap={10}>
              {tile('On trial', String(o.trials))}
              {tile('New this month', String(o.newThisMonth))}
              {tile('Upgrade requests', String(o.openRequests))}
            </Row>
            <Card>
              <Txt v="label">Accounts by plan</Txt>
              {PLAN_IDS.map((p) => (
                <KV key={p} k={PLANS[p].name} v={String(o.byPlan[p] ?? 0)} />
              ))}
            </Card>
            <Card>
              <Txt v="label">This month across all accounts</Txt>
              <KV k="Invoices issued" v={String(o.invoicesThisMonth)} />
              <KV k="AI requests" v={String(o.aiThisMonth)} />
              <KV k="People signed up" v={String(o.users)} />
            </Card>
          </>
        )}
      </Loader>
      <Section title="Manage">
        <MenuRow icon="business-outline" title="Accounts & plans" sub="Every customer account, usage, upgrade requests" onPress={() => router.push('/admin/accounts')} />
        <MenuRow icon="people-outline" title="Partners" sub="Resellers and the sign-ups they bring" onPress={() => router.push('/admin/partners')} />
        <MenuRow icon="sparkles-outline" title="AI service" sub={o ? (o.ai.ready ? `Ready · ${o.ai.model}` : 'Not set up: customers have no AI') : 'Provider and key for every account'} onPress={() => router.push('/admin/ai')} />
      </Section>
    </Screen>
  );
}
