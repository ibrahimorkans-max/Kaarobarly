import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Card, Chips, Empty, IconBtn, Loader, Row, Screen, Section, Txt, fd, fm, todayStr } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import type { CalendarEvent } from '@/lib/shared';

const monthEnd = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};
const shift = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const KIND: Record<string, string> = { invoice: 'Invoice due', installment: 'Installment', bill: 'Bill to pay', cheque_in: 'Cheque to deposit', cheque_out: 'Cheque to clear', loan: 'Loan', recurring: 'Recurring' };

/** Everything due this month: money to collect and money to pay, day by day. */
export default function Calendar() {
  const th = useTheme();
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [dir, setDir] = useState<'' | 'in' | 'out'>('');
  const { data, loading, error, reload, refreshing } = useApi<CalendarEvent[]>(`/calendar?from=${month}-01&to=${monthEnd(month)}`);
  const events = (data ?? []).filter((e) => !dir || e.direction === dir);
  const overdue = events.filter((e) => e.overdue);
  const upcoming = events.filter((e) => !e.overdue);
  const days = [...new Set(upcoming.map((e) => e.date))];
  const sum = (d: 'in' | 'out') => (data ?? []).filter((e) => e.direction === d && !e.overdue).reduce((s, e) => s + e.amount, 0);
  const open = (e: CalendarEvent) => {
    if (e.refType === 'invoice') router.push({ pathname: '/invoice/[id]', params: { id: e.refId } });
    else if (e.refType === 'purchase') router.push({ pathname: '/purchase/[id]', params: { id: e.refId } });
    else if (e.refType === 'loan') router.push({ pathname: '/loan/[id]', params: { id: e.refId } });
    else if (e.refType === 'cheque') router.push('/cheques');
  };
  const row = (e: CalendarEvent, i: number) => (
    <Card key={`${e.refId}-${i}`} label={`${e.title} ${e.party}`} onPress={() => open(e)}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontWeight: '700' }}>{e.party}</Txt>
          <Txt v="small">
            {KIND[e.kind]} · {e.title}
            {e.overdue ? ` · due ${fd(e.date)}` : ''}
          </Txt>
        </View>
        <Txt style={{ fontWeight: '800', color: e.direction === 'in' ? th.success : th.danger }}>
          {e.direction === 'in' ? '+' : '−'} {fm(e.amount)}
        </Txt>
      </Row>
    </Card>
  );

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconBtn icon="chevron-back" label="Previous month" onPress={() => setMonth(shift(month, -1))} />
        <Txt v="h">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</Txt>
        <IconBtn icon="chevron-forward" label="Next month" onPress={() => setMonth(shift(month, 1))} />
      </Row>
      <Row gap={10}>
        <Card style={{ flex: 1 }}>
          <Txt v="small">To collect</Txt>
          <Txt style={{ fontWeight: '800', color: th.success }}>{fm(sum('in'))}</Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt v="small">To pay</Txt>
          <Txt style={{ fontWeight: '800', color: th.danger }}>{fm(sum('out'))}</Txt>
        </Card>
      </Row>
      <Chips
        value={dir}
        onChange={setDir}
        options={[
          { value: '', label: 'All' },
          { value: 'in', label: 'Money in' },
          { value: 'out', label: 'Money out' },
        ]}
      />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {events.length === 0 && <Empty icon="calendar-outline" title="Nothing due" hint="Invoices, installments, supplier bills, cheques and loan payments show up here." />}
        {overdue.length > 0 && month === todayStr().slice(0, 7) && <Section title={`Overdue (${overdue.length})`}>{overdue.map(row)}</Section>}
        {days.map((d) => (
          <Section key={d} title={d === todayStr() ? 'Today' : fd(d)}>
            {upcoming.filter((e) => e.date === d).map(row)}
          </Section>
        ))}
      </Loader>
    </Screen>
  );
}
