import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Badge, Btn, Card, Field, KV, Loader, Notice, Progress, Row, Screen, Section, Sheet, Txt, fd, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { PLANS, PLAN_IDS, type PlanId, type PlanState } from '@/lib/shared';

type PlanInfo = PlanState & { request: { plan: PlanId; created_at: string } | null; sales: string };

/** The account's plan, what it allows, how much is used, and asking for an upgrade. */
export default function Plan() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<PlanInfo>('/plan');
  const [ask, setAsk] = useState<{ plan: PlanId; phone: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!ask) return;
    setBusy(true);
    try {
      await api('/plan/request', { body: ask });
      toast('Request sent. We will contact you to complete the upgrade.');
      setAsk(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const bar = (label: string, used: number, limit: number) => (
    <View key={label} style={{ gap: 2 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="sub">{label}</Txt>
        <Txt v="sub">
          {used} / {limit >= 100_000 ? 'unlimited' : limit}
        </Txt>
      </Row>
      {limit > 0 && limit < 100_000 && <Progress value={used} total={limit} word="used" fullIsBad />}
    </View>
  );

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Txt v="small">Your plan</Txt>
                  <Txt style={{ fontWeight: '800', fontSize: 22 }}>{data.chosen === 'trial' ? `Pro trial` : PLANS[data.plan].name}</Txt>
                </View>
                {data.daysLeft !== null && <Badge status={data.daysLeft <= 7 ? 'overdue' : 'paid'} label={data.daysLeft > 0 ? `${data.daysLeft} days left` : 'Ended'} />}
              </Row>
              {data.chosen === 'trial' && data.trialEndsAt && <Txt v="small">Trial ends {fd(data.trialEndsAt)}. After that the account moves to Free unless you upgrade. Nothing is deleted.</Txt>}
              {data.paidUntil && <KV k="Paid until" v={fd(data.paidUntil)} />}
            </Card>
            {data.chosen !== 'trial' && data.chosen !== data.plan && <Notice kind="warn">Your {PLANS[data.chosen as PlanId]?.name ?? ''} plan has ended, so Free limits apply. Your data is safe.</Notice>}
            <Section title="Usage this month">
              <Card style={{ gap: 10 }}>
                {bar('People', data.usage.users, data.limits.users)}
                {bar('Business profiles', data.usage.businesses, data.limits.businesses)}
                {bar('Invoices issued', data.usage.invoicesThisMonth, data.limits.invoicesPerMonth)}
                {bar('AI requests', data.usage.aiThisMonth, data.limits.aiPerMonth)}
                <KV k="Payroll" v={data.limits.payroll ? 'Included' : 'Not included'} />
              </Card>
            </Section>
            {data.request && <Notice kind="info">Upgrade to {PLANS[data.request.plan].name} requested on {fd(data.request.created_at.slice(0, 10))}. We will be in touch.</Notice>}
            <Section title="Plans">
              {PLAN_IDS.map((id) => {
                const p = PLANS[id];
                const current = data.plan === id && data.chosen !== 'trial';
                return (
                  <Card key={id}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Txt style={{ fontWeight: '800' }}>{p.name}</Txt>
                        <Txt v="small">{p.hint}</Txt>
                      </View>
                      <Txt style={{ fontWeight: '800' }}>{p.price ? `${fm(p.price)}/mo` : 'Free'}</Txt>
                    </Row>
                    <Txt v="small">
                      {p.limits.users} {p.limits.users === 1 ? 'person' : 'people'} · {p.limits.businesses} business{p.limits.businesses === 1 ? '' : 'es'} · {p.limits.invoicesPerMonth >= 100_000 ? 'unlimited' : p.limits.invoicesPerMonth} invoices/mo · {p.limits.aiPerMonth ? `${p.limits.aiPerMonth} AI/mo` : 'no AI'}
                      {p.limits.payroll ? ' · payroll' : ''}
                    </Txt>
                    {current ? <Badge status="paid" label="Current plan" /> : id !== 'free' && can('businesses.manage') && <Btn small kind="secondary" title={`Choose ${p.name}`} onPress={() => setAsk({ plan: id, phone: '', note: '' })} />}
                  </Card>
                );
              })}
            </Section>
            {!!data.sales && <Btn kind="ghost" icon="call-outline" title={`Talk to us: ${data.sales}`} onPress={() => Linking.openURL(/@/.test(data.sales) ? `mailto:${data.sales}` : `tel:${data.sales.replace(/[^\d+]/g, '')}`).catch(() => {})} />}
          </>
        )}
      </Loader>
      <Sheet visible={!!ask} title={ask ? `Upgrade to ${PLANS[ask.plan].name}` : ''} onClose={() => setAsk(null)}>
        {ask && <KV k="Price" v={`${fm(PLANS[ask.plan].price)} a month`} bold />}
        <Txt v="sub">We will contact you to arrange payment (bank transfer, JazzCash or Easypaisa) and switch the plan on.</Txt>
        <Field label="Phone / WhatsApp to reach you" value={ask?.phone ?? ''} onChangeText={(v) => setAsk((a) => a && { ...a, phone: v })} keyboardType="phone-pad" />
        <Field label="Anything we should know (optional)" value={ask?.note ?? ''} onChangeText={(v) => setAsk((a) => a && { ...a, note: v })} multiline />
        <Btn title="Send request" onPress={send} loading={busy} />
      </Sheet>
    </Screen>
  );
}
