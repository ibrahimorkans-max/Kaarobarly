import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { Badge, Btn, Card, Chips, Empty, Field, IconBtn, Loader, Row, Screen, Section, Sheet, Txt, confirm, dt } from '@/components/ui';
import { API_URL, api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';

interface Key {
  id: string;
  name: string;
  prefix: string;
  role: string;
  createdAt: string;
  lastUsedAt: string;
  revoked: boolean;
  key?: string;
}
interface Hook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
  lastStatus: string;
  lastAt: string;
}
const EVENTS: [string, string][] = [
  ['invoice.finalize', 'Invoice finalized'],
  ['invoice.cancel', 'Invoice cancelled'],
  ['payment.record', 'Payment recorded'],
  ['pos.sale', 'Counter sale'],
  ['pos.return', 'Counter return'],
  ['order.online', 'Online order'],
  ['stock.writeoff', 'Stock written off'],
  ['giftcard.issue', 'Gift card sold'],
];

/** API keys for other software, and webhooks that tell it when things happen. Owner only, online only. */
export default function DeveloperScreen() {
  const th = useTheme();
  const toast = useToast();
  const keys = useApi<Key[]>('/developer/keys');
  const hooks = useApi<Hook[]>('/developer/webhooks');
  const [newKey, setNewKey] = useState<{ name: string; role: string } | null>(null);
  const [shown, setShown] = useState<Key | null>(null);
  const [hook, setHook] = useState<{ url: string; events: string[] } | null>(null);

  async function createKey() {
    if (!newKey) return;
    try {
      const k = await api<Key>('/developer/keys', { body: newKey });
      setNewKey(null);
      setShown(k);
      keys.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function revoke(k: Key) {
    if (!(await confirm(`Revoke ${k.name}?`, 'Software using this key stops working at once.', 'Revoke'))) return;
    await api(`/developer/keys/${k.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
    keys.reload();
  }
  async function saveHook() {
    if (!hook) return;
    try {
      await api('/developer/webhooks', { body: hook });
      setHook(null);
      hooks.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function test(h: Hook) {
    try {
      const r = await api<{ status: string }>(`/developer/webhooks/${h.id}/test`, { method: 'POST' });
      toast(r.status.startsWith('2') ? `Delivered (${r.status})` : `Not delivered: ${r.status}`, r.status.startsWith('2') ? undefined : 'error');
      hooks.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function removeHook(h: Hook) {
    if (!(await confirm('Delete this webhook?', h.url, 'Delete'))) return;
    await api(`/developer/webhooks/${h.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
    hooks.reload();
  }

  return (
    <Screen onRefresh={() => (keys.reload(), hooks.reload())}>
      <Stack.Screen options={{ title: 'Developers' }} />
      <Card style={{ gap: 4 }}>
        <Txt v="small">REST API address</Txt>
        <Txt selectable style={{ fontWeight: '700' }}>
          {API_URL}
        </Txt>
        <Txt v="small">Send the key in the X-Api-Key header, e.g. GET /invoices, POST /clients. Keys cannot change users, plans or settings.</Txt>
      </Card>
      <Section title="API keys" action={<Btn small kind="ghost" icon="add" title="Key" onPress={() => setNewKey({ name: '', role: 'accountant' })} />}>
        <Loader loading={keys.loading && !keys.data} error={keys.data ? '' : keys.error} onRetry={keys.reload}>
          {(keys.data ?? []).length === 0 && <Empty icon="key-outline" title="No API keys" hint="Make one for your website, accountant software or a delivery app." />}
          {(keys.data ?? []).map((k) => (
            <Card key={k.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>{k.name}</Txt>
                  <Txt v="small">
                    {k.prefix}… · {k.role} · {k.lastUsedAt ? `used ${dt(k.lastUsedAt)}` : 'never used'}
                  </Txt>
                </View>
                {k.revoked ? <Badge status="cancelled" label="Revoked" /> : <IconBtn icon="close-circle-outline" label={`Revoke ${k.name}`} color={th.danger} onPress={() => revoke(k)} />}
              </Row>
            </Card>
          ))}
        </Loader>
      </Section>
      <Section title="Webhooks" action={<Btn small kind="ghost" icon="add" title="Webhook" onPress={() => setHook({ url: 'https://', events: ['invoice.finalize', 'payment.record'] })} />}>
        {(hooks.data ?? []).length === 0 && <Txt v="sub">A webhook sends a signed POST to your address when something happens.</Txt>}
        {(hooks.data ?? []).map((h) => (
          <Card key={h.id} style={{ gap: 6 }}>
            <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
              {h.url}
            </Txt>
            <Txt v="small">{h.events.map((e) => EVENTS.find((x) => x[0] === e)?.[1] ?? e).join(', ')}</Txt>
            <Txt v="small" selectable>
              Signing secret: {h.secret}
            </Txt>
            {!!h.lastStatus && (
              <Txt v="small" color={h.lastStatus.startsWith('2') ? th.success : th.danger}>
                Last delivery: {h.lastStatus} · {dt(h.lastAt)}
              </Txt>
            )}
            <Row gap={8}>
              <Btn small style={{ flex: 1 }} kind="secondary" title="Send a test" onPress={() => test(h)} />
              <Btn small style={{ flex: 1 }} kind="ghost" title="Delete" onPress={() => removeHook(h)} />
            </Row>
          </Card>
        ))}
        <Txt v="small">Check the X-Kaarobarly-Signature header: sha256 HMAC of the body with the signing secret.</Txt>
      </Section>

      <Sheet visible={!!newKey} title="New API key" onClose={() => setNewKey(null)}>
        <Field label="Name" value={newKey?.name ?? ''} onChangeText={(v) => setNewKey((k) => k && { ...k, name: v })} placeholder="Website, Daraz sync…" />
        <Txt v="label">What it can do</Txt>
        <Chips value={newKey?.role ?? 'accountant'} onChange={(v) => setNewKey((k) => k && { ...k, role: v })} options={[{ value: 'viewer', label: 'Read only' }, { value: 'staff', label: 'Staff' }, { value: 'accountant', label: 'Accountant' }, { value: 'manager', label: 'Manager' }]} />
        <Btn icon="key-outline" title="Make key" onPress={createKey} />
      </Sheet>
      <Sheet visible={!!shown} title="Copy your key now" onClose={() => setShown(null)}>
        <Txt selectable style={{ fontWeight: '800', fontSize: 15 }}>
          {shown?.key}
        </Txt>
        <Txt v="small" color={th.warn}>
          It is shown only once. Keep it secret, like a password.
        </Txt>
        <Btn icon="share-outline" title="Share / copy" onPress={() => Share.share({ message: shown?.key ?? '' })} />
        <Btn kind="ghost" title="Done" onPress={() => setShown(null)} />
      </Sheet>
      <Sheet visible={!!hook} title="New webhook" onClose={() => setHook(null)}>
        <Field label="Your https:// address" value={hook?.url ?? ''} onChangeText={(v) => setHook((h) => h && { ...h, url: v })} autoCapitalize="none" keyboardType="url" />
        <Txt v="label">Send when</Txt>
        {EVENTS.map(([k, label]) => {
          const on = !!hook?.events.includes(k);
          return (
            <Pressable key={k} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setHook((h) => h && { ...h, events: on ? h.events.filter((x) => x !== k) : [...h.events, k] })} style={{ paddingVertical: 6 }}>
              <Row>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? th.primary : th.sub} />
                <Txt>{label}</Txt>
              </Row>
            </Pressable>
          );
        })}
        <Btn title="Save" onPress={saveHook} />
      </Sheet>
    </Screen>
  );
}
