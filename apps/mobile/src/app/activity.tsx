import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Card, Empty, Loader, Row, Screen, SearchBar, Txt, dt, fm } from '@/components/ui';
import { useApi } from '@/lib/api';

interface Entry {
  id: string;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
  at: string;
  user_name: string | null;
}

const VERBS: Record<string, string> = {
  'invoice.create': 'made an invoice',
  'invoice.finalize': 'finalized an invoice',
  'invoice.cancel': 'cancelled an invoice',
  'payment.create': 'recorded a payment',
  'payment.verify': 'confirmed a payment',
  'pos.sale': 'made a sale',
  'pos.return': 'took a return',
  'pos.cash_in': 'put cash in the drawer',
  'pos.cash_out': 'took cash out of the drawer',
  'order.cancel': 'cancelled an order',
  'stock.adjust': 'changed stock',
  'stock.writeoff': 'wrote off stock',
  'employee.save': 'saved an employee',
  'payroll.create': 'started payroll',
  'giftcard.issue': 'sold a gift card',
  'loyalty.adjust': 'changed loyalty points',
  'promotion.save': 'saved a promotion',
  'reconcile': 'reconciled an account',
  'attendance.mark': 'marked attendance',
};

/** Who did what, newest first: “Ali made a sale · Rs 2,300 · 10:42”. */
export default function ActivityScreen() {
  const { data, loading, error, reload } = useApi<Entry[]>('/audit?limit=100');
  const [q, setQ] = useState('');
  const say = (e: Entry) => {
    let d: any = {};
    try {
      d = JSON.parse(e.detail || '{}');
    } catch {}
    const amount = d.total ?? d.amount ?? d.value;
    const verb = VERBS[e.action] ?? e.action.replace(/[._]/g, ' ');
    return `${e.user_name || 'Someone'} ${verb}${d.name ? ` · ${d.name}` : ''}${typeof amount === 'number' ? ` · ${fm(amount)}` : ''}${d.reason ? ` · ${d.reason}` : ''}`;
  };
  const needle = q.trim().toLowerCase();
  const shown = (data ?? []).filter((e) => !needle || say(e).toLowerCase().includes(needle));
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Activity' }} />
      <SearchBar value={q} onChange={setQ} placeholder="Search names or actions" />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {shown.length === 0 ? (
          <Empty icon="pulse-outline" title="Nothing yet" hint="Needs an internet connection." />
        ) : (
          shown.map((e) => (
            <Card key={e.id}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Txt>{say(e)}</Txt>
                </View>
                <Txt v="small">{dt(e.at)}</Txt>
              </Row>
            </Card>
          ))
        )}
      </Loader>
    </Screen>
  );
}
