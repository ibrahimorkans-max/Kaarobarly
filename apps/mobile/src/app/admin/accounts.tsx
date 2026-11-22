import { useState } from 'react';
import { View } from 'react-native';
import { Badge, Btn, Card, Chips, DateField, Empty, Field, KV, Loader, Row, Screen, SearchBar, Sheet, Txt, fd } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { PLANS, type PlanId, type PlanState } from '@/lib/shared';

type Tenant = PlanState & {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
  lastActive: string | null;
  invoicesTotal: number;
  request: { plan: PlanId; created_at: string } | null;
};

/** For the people running Kaarobarly: every account, its plan, usage and upgrade requests. */
export default function Platform() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<Tenant[]>(user?.isPlatformAdmin ? '/platform/tenants' : null);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'requests' | 'trial'>('all');
  const [edit, setEdit] = useState<{ t: Tenant; plan: PlanId | 'trial'; paidUntil: string; trialDays: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user?.isPlatformAdmin)
    return (
      <Screen>
        <Empty icon="lock-closed-outline" title="Administrators only" />
      </Screen>
    );

  const needle = q.trim().toLowerCase();
  const rows = (data ?? []).filter((t) => (only === 'all' || (only === 'requests' ? !!t.request : t.chosen === 'trial')) && (!needle || `${t.name} ${t.ownerEmail} ${t.ownerName}`.toLowerCase().includes(needle)));

  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      await api(`/platform/tenants/${edit.t.id}/plan`, { method: 'PUT', body: { plan: edit.plan, paidUntil: edit.paidUntil, trialDays: Number(edit.trialDays) || 30 } });
      toast(`${edit.t.name} updated`);
      setEdit(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Row gap={10}>
        <Card style={{ flex: 1 }}>
          <Txt v="small">Accounts</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 20 }}>{data?.length ?? 0}</Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt v="small">Paying</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 20 }}>{(data ?? []).filter((t) => t.chosen !== 'trial' && t.chosen !== 'free' && t.plan !== 'free').length}</Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt v="small">Requests</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 20 }}>{(data ?? []).filter((t) => t.request).length}</Txt>
        </Card>
      </Row>
      <SearchBar value={q} onChange={setQ} placeholder="Search business or owner" />
      <Chips
        value={only}
        onChange={setOnly}
        options={[
          { value: 'all', label: 'All' },
          { value: 'requests', label: 'Upgrade requests' },
          { value: 'trial', label: 'On trial' },
        ]}
      />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {rows.map((t) => (
          <Card key={t.id} label={`Account ${t.name}`} onPress={() => setEdit({ t, plan: t.request?.plan ?? (t.chosen as PlanId | 'trial'), paidUntil: t.paidUntil ?? '', trialDays: '30' })}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '700' }}>{t.name}</Txt>
                <Txt v="small">
                  {t.ownerName} · {t.ownerEmail}
                </Txt>
                <Txt v="small">
                  Joined {fd(t.createdAt.slice(0, 10))} · {t.invoicesTotal} invoices · {t.usage.users} {t.usage.users === 1 ? 'person' : 'people'}{t.lastActive ? ` · active ${fd(t.lastActive.slice(0, 10))}` : ''}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Badge status={t.plan === 'free' ? 'draft' : 'paid'} label={t.chosen === 'trial' ? `Trial · ${t.daysLeft ?? 0}d` : PLANS[t.plan].name} />
                {t.request && <Badge status="partially_paid" label={`Wants ${PLANS[t.request.plan].name}`} />}
              </View>
            </Row>
          </Card>
        ))}
      </Loader>
      <Sheet visible={!!edit} title={edit?.t.name ?? ''} onClose={() => setEdit(null)}>
        {edit && (
          <>
            <KV k="Owner" v={`${edit.t.ownerName} · ${edit.t.ownerEmail}`} />
            <KV k="This month" v={`${edit.t.usage.invoicesThisMonth} invoices · ${edit.t.usage.aiThisMonth} AI`} />
            <Chips value={edit.plan} onChange={(v) => setEdit({ ...edit, plan: v })} options={[{ value: 'trial', label: 'Trial' }, ...(['free', 'starter', 'pro', 'business'] as PlanId[]).map((p) => ({ value: p, label: PLANS[p].name }))]} />
            {edit.plan === 'trial' ? (
              <Field label="Trial days from today" money value={edit.trialDays} onChangeText={(v) => setEdit({ ...edit, trialDays: v })} />
            ) : edit.plan !== 'free' ? (
              <DateField label="Paid until" value={edit.paidUntil} onChange={(v) => setEdit({ ...edit, paidUntil: v })} />
            ) : null}
            <Btn title="Save plan" onPress={save} loading={busy} />
          </>
        )}
      </Sheet>
    </Screen>
  );
}
