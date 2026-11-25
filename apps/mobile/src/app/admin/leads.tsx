import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Badge, Btn, Card, Chips, Empty, Loader, Row, Screen, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';

interface Lead {
  id: string;
  name: string;
  business: string;
  phone: string;
  email: string;
  plan: string;
  message: string;
  status: 'new' | 'contacted' | 'won' | 'closed';
  createdAt: string;
}
type Filter = '' | Lead['status'];
const NEXT: Record<Lead['status'], { to: Lead['status']; label: string }[]> = {
  new: [{ to: 'contacted', label: 'Contacted' }, { to: 'closed', label: 'Close' }],
  contacted: [{ to: 'won', label: 'Signed up' }, { to: 'closed', label: 'Close' }],
  won: [{ to: 'contacted', label: 'Reopen' }],
  closed: [{ to: 'new', label: 'Reopen' }],
};
const BADGE: Record<Lead['status'], string> = { new: 'sent', contacted: 'draft', won: 'paid', closed: 'void' };

/** SaaS owner: people who filled in the website's contact form. */
export default function Leads() {
  const th = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('');
  const { data, loading, error, reload } = useApi<{ leads: Lead[]; counts: Record<string, number> }>(user?.isPlatformAdmin ? `/platform/site/leads${filter ? `?status=${filter}` : ''}` : null);

  async function move(l: Lead, to: Lead['status']) {
    try {
      await api(`/platform/site/leads/${l.id}`, { method: 'PUT', body: { status: to } });
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function remove(l: Lead) {
    try {
      await api(`/platform/site/leads/${l.id}`, { method: 'DELETE' });
      toast('Lead deleted');
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  const wa = (p: string) => p.replace(/\D/g, '').replace(/^0/, '92');
  const c = data?.counts ?? {};

  if (!user?.isPlatformAdmin) return <Screen>{null}</Screen>;
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Website leads' }} />
      <Chips<Filter>
        options={[
          { value: '', label: 'All' },
          { value: 'new', label: `New${c.new ? ` ${c.new}` : ''}` },
          { value: 'contacted', label: 'Contacted' },
          { value: 'won', label: 'Signed up' },
          { value: 'closed', label: 'Closed' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && !data.leads.length && <Empty icon="mail-open-outline" title="No leads yet" hint="When visitors fill in the contact form on the website, they appear here." />}
        {data?.leads.map((l) => (
          <Card key={l.id} style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '800', fontSize: 16 }}>{l.name}</Txt>
                {!!l.business && <Txt v="small">{l.business}</Txt>}
              </View>
              <Badge status={BADGE[l.status]} label={l.status === 'won' ? 'Signed up' : l.status[0].toUpperCase() + l.status.slice(1)} />
            </Row>
            {!!l.message && <Txt>{l.message}</Txt>}
            <Txt v="small" color={th.sub}>
              {new Date(l.createdAt).toLocaleString()}
              {l.plan ? ` · interested in ${l.plan}` : ''}
            </Txt>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {!!l.phone && <Btn small kind="secondary" icon="logo-whatsapp" title="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${wa(l.phone)}`)} />}
              {!!l.phone && <Btn small kind="secondary" icon="call-outline" title="Call" onPress={() => Linking.openURL(`tel:${l.phone.replace(/[^\d+]/g, '')}`)} />}
              {!!l.email && <Btn small kind="secondary" icon="mail-outline" title="Email" onPress={() => Linking.openURL(`mailto:${l.email}`)} />}
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {NEXT[l.status].map((n) => (
                <Btn key={n.to} small title={n.label} kind={n.to === 'closed' ? 'ghost' : 'primary'} onPress={() => move(l, n.to)} />
              ))}
              <View style={{ flex: 1 }} />
              <Btn small kind="danger" icon="trash-outline" title="Delete" onPress={() => remove(l)} />
            </Row>
          </Card>
        ))}
      </Loader>
      <Row gap={6} style={{ justifyContent: 'center', opacity: 0.7 }}>
        <Ionicons name="lock-closed-outline" size={14} color={th.sub} />
        <Txt v="small">Only the service owner sees leads.</Txt>
      </Row>
    </Screen>
  );
}
