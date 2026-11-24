import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { Badge, Btn, Card, Chips, Field, IconBtn, KV, Loader, Row, Screen, Section, Sheet, Txt, dt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney, percentToString, parsePercent, type GiftCard, type LoyaltyAccount, type LoyaltySettings, type PosShift } from '@/lib/shared';

/** Loyalty points and tiers, member lookup, and gift cards. */
export default function LoyaltyScreen() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const settings = useApi<LoyaltySettings>('/loyalty/settings');
  const cards = useApi<GiftCard[]>('/gift-cards');
  const shift = useApi<{ shift: PosShift | null }>('/pos/shift');
  const [tab, setTab] = useState<'members' | 'cards' | 'settings'>('members');
  const [form, setForm] = useState<{ enabled: boolean; spend: string; value: string; min: string; tiers: { name: string; min: string; pct: string }[] } | null>(null);
  const [phone, setPhone] = useState('');
  const [member, setMember] = useState<LoyaltyAccount | null>(null);
  const [adjust, setAdjust] = useState<{ points: string; reason: string } | null>(null);
  const [sell, setSell] = useState<{ amount: string; name: string } | null>(null);
  const [issued, setIssued] = useState<GiftCard | null>(null);
  const [busy, setBusy] = useState(false);
  const s = settings.data;

  useEffect(() => {
    if (s && !form) setForm({ enabled: s.enabled, spend: moneyToInput(s.spendPerPoint), value: moneyToInput(s.pointValue), min: String(s.minRedeem), tiers: s.tiers.map((t) => ({ name: t.name, min: String(t.minPoints), pct: percentToString(t.discountBp) })) });
  }, [s, form]);

  async function saveSettings() {
    if (!form) return;
    const spendPerPoint = parseMoney(form.spend);
    const pointValue = parseMoney(form.value);
    if (!spendPerPoint || pointValue === null) return toast('Enter the amounts', 'error');
    const tiers = form.tiers.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), minPoints: Math.max(0, Math.floor(Number(t.min) || 0)), discountBp: parsePercent(t.pct || '0') ?? 0 }));
    setBusy(true);
    try {
      await api('/loyalty/settings', { method: 'PUT', body: { enabled: form.enabled, spendPerPoint, pointValue, minRedeem: Math.max(0, Math.floor(Number(form.min) || 0)), tiers } });
      toast('Loyalty saved');
      settings.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function find() {
    try {
      setMember(await api<LoyaltyAccount>(`/loyalty/find?phone=${encodeURIComponent(phone)}`));
    } catch (e: any) {
      setMember(null);
      toast(e.message, 'error');
    }
  }
  async function saveAdjust() {
    if (!adjust || !member) return;
    try {
      setMember(await api<LoyaltyAccount>(`/loyalty/clients/${member.clientId}/adjust`, { body: { points: Math.trunc(Number(adjust.points) || 0), reason: adjust.reason } }));
      setAdjust(null);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function sellCard() {
    if (!sell) return;
    const amount = parseMoney(sell.amount);
    if (!amount || amount <= 0) return toast('Enter the amount', 'error');
    setBusy(true);
    try {
      const g = await api<GiftCard>('/gift-cards', { body: { amount, clientName: sell.name, shiftId: shift.data?.shift?.id ?? null } });
      setSell(null);
      setIssued(g);
      cards.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={() => (settings.reload(), cards.reload())}>
      <Stack.Screen options={{ title: 'Loyalty & gift cards' }} />
      <Chips value={tab} onChange={setTab} options={[{ value: 'members', label: 'Members' }, { value: 'cards', label: 'Gift cards' }, ...(can('pos.manage') ? [{ value: 'settings' as const, label: 'Settings' }] : [])]} />
      <Loader loading={settings.loading && !s} error={s ? '' : settings.error} onRetry={settings.reload}>
        {tab === 'members' && (
          <>
            {s && !s.enabled && <Txt v="sub">Loyalty is off. Turn it on in Settings.</Txt>}
            <Row style={{ alignItems: 'flex-end' }}>
              <Field style={{ flex: 1 }} label="Customer phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
              <Btn small title="Find" onPress={find} disabled={phone.replace(/\D/g, '').length < 7} />
            </Row>
            {member && (
              <Card style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt v="h">{member.name}</Txt>
                  {member.tier && <Badge status="paid" label={member.tier.name} />}
                </Row>
                <KV k="Points" v={String(member.points)} bold />
                <KV k="Worth" v={fm(member.points * (s?.pointValue ?? 0))} />
                <KV k="Earned in total" v={String(member.lifetime)} />
                {member.nextTier && <Txt v="small">{member.nextTier.minPoints - member.lifetime} more points to {member.nextTier.name}</Txt>}
                {can('pos.manage') && <Btn small kind="secondary" title="Add or remove points" onPress={() => setAdjust({ points: '', reason: '' })} />}
                {member.history.map((h) => (
                  <Row key={h.id} style={{ justifyContent: 'space-between' }}>
                    <Txt v="small" style={{ flex: 1 }}>
                      {dt(h.at)} · {h.reason}
                    </Txt>
                    <Txt style={{ fontWeight: '700', color: h.points > 0 ? th.success : th.danger }}>
                      {h.points > 0 ? '+' : ''}
                      {h.points}
                    </Txt>
                  </Row>
                ))}
              </Card>
            )}
          </>
        )}
        {tab === 'cards' && (
          <>
            <Btn icon="gift-outline" title="Sell a gift card" onPress={() => setSell({ amount: '', name: '' })} />
            {!shift.data?.shift && <Txt v="small">Open a shift at the counter so the cash goes into the drawer.</Txt>}
            {(cards.data ?? []).map((g) => (
              <Card key={g.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '800', letterSpacing: 1 }}>{g.code}</Txt>
                    <Txt v="small">
                      {g.clientName || 'No name'} · sold {dt(g.createdAt)} for {fm(g.initial)}
                    </Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt style={{ fontWeight: '800' }}>{fm(g.balance)}</Txt>
                    <Badge status={g.status === 'active' ? 'paid' : 'cancelled'} label={g.status} />
                  </View>
                </Row>
              </Card>
            ))}
          </>
        )}
        {tab === 'settings' && form && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>Loyalty points</Txt>
                  <Txt v="small">Named customers earn points at the counter and spend them later</Txt>
                </View>
                <Switch accessibilityLabel="Loyalty points" value={form.enabled} onValueChange={(v) => setForm({ ...form, enabled: v })} />
              </Row>
            </Card>
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <Field style={{ flex: 1 }} label="Spend for 1 point" money value={form.spend} onChangeText={(v) => setForm({ ...form, spend: v })} />
              <Field style={{ flex: 1 }} label="1 point is worth" money value={form.value} onChangeText={(v) => setForm({ ...form, value: v })} />
            </Row>
            <Field label="Spend at least (points)" keyboardType="number-pad" value={form.min} onChangeText={(v) => setForm({ ...form, min: v })} />
            <Section title="Tiers" action={<Btn small kind="ghost" icon="add" title="Tier" onPress={() => setForm({ ...form, tiers: [...form.tiers, { name: '', min: '', pct: '' }] })} />}>
              {form.tiers.map((t, i) => (
                <Row key={i} gap={6} style={{ alignItems: 'flex-end' }}>
                  <Field style={{ flex: 1.2 }} label="Name" value={t.name} onChangeText={(v) => setForm({ ...form, tiers: form.tiers.map((x, k) => (k === i ? { ...x, name: v } : x)) })} />
                  <Field style={{ flex: 1 }} label="From points" keyboardType="number-pad" value={t.min} onChangeText={(v) => setForm({ ...form, tiers: form.tiers.map((x, k) => (k === i ? { ...x, min: v } : x)) })} />
                  <Field style={{ flex: 0.8 }} label="Off %" money value={t.pct} onChangeText={(v) => setForm({ ...form, tiers: form.tiers.map((x, k) => (k === i ? { ...x, pct: v } : x)) })} />
                  <IconBtn icon="close" label={`Remove tier ${t.name}`} onPress={() => setForm({ ...form, tiers: form.tiers.filter((_, k) => k !== i) })} />
                </Row>
              ))}
              <Txt v="small">Tiers go by points earned in total. Members get the tier's discount on every bill.</Txt>
            </Section>
            <Btn title="Save" onPress={saveSettings} loading={busy} />
          </>
        )}
      </Loader>
      <Sheet visible={!!adjust} title="Adjust points" onClose={() => setAdjust(null)}>
        <Field label="Points (minus to remove)" keyboardType="numbers-and-punctuation" value={adjust?.points ?? ''} onChangeText={(v) => setAdjust((a) => a && { ...a, points: v })} />
        <Field label="Reason" value={adjust?.reason ?? ''} onChangeText={(v) => setAdjust((a) => a && { ...a, reason: v })} />
        <Btn title="Save" onPress={saveAdjust} />
      </Sheet>
      <Sheet visible={!!sell} title="Sell a gift card" onClose={() => setSell(null)}>
        <Field label="Amount" money value={sell?.amount ?? ''} onChangeText={(v) => setSell((x) => x && { ...x, amount: v })} />
        <Field label="For (optional)" value={sell?.name ?? ''} onChangeText={(v) => setSell((x) => x && { ...x, name: v })} />
        <Btn icon="gift-outline" title="Take payment and issue" onPress={sellCard} loading={busy} />
      </Sheet>
      <Sheet visible={!!issued} title="Gift card ready" onClose={() => setIssued(null)}>
        <Txt style={{ fontSize: 28, fontWeight: '900', textAlign: 'center', letterSpacing: 2 }}>{issued?.code}</Txt>
        <KV k="Balance" v={fm(issued?.balance ?? 0)} bold />
        <Txt v="small">Write the code on the card or send it to the customer. It is spent by entering the code at the counter.</Txt>
        <Btn title="Done" onPress={() => setIssued(null)} />
      </Sheet>
    </Screen>
  );
}
