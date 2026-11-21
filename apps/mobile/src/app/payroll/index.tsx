import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Badge, Btn, Card, Empty, IconBtn, Loader, Row, Screen, Txt, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useToast } from '@/lib/app-context';
import { RUN_STATUS_LABELS, type BusinessProfile, type PayrollRun } from '@/lib/shared';

const TONE: Record<string, string> = { draft: 'draft', submitted: 'partially_paid', approved: 'unpaid', paid: 'paid' };
const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shift = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};

/** Monthly payroll runs. */
export default function Payroll() {
  const toast = useToast();
  const list = useApi<PayrollRun[]>('/payroll');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const exists = (list.data ?? []).some((r) => r.month === month);

  async function start() {
    setBusy(true);
    try {
      const run = await api<PayrollRun>('/payroll', { body: { businessId: businesses.data?.[0]?.id, month } });
      router.push({ pathname: '/payroll/[id]', params: { id: run.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconBtn icon="chevron-back" label="Previous month" onPress={() => setMonth(shift(month, -1))} />
          <Txt v="h">{label(month)}</Txt>
          <IconBtn icon="chevron-forward" label="Next month" onPress={() => setMonth(shift(month, 1))} />
        </Row>
        <Btn icon="calculator-outline" title={exists ? 'Already started' : `Start ${label(month)} payroll`} onPress={start} loading={busy} disabled={exists} />
      </Card>
      <Btn kind="secondary" icon="people-outline" title="Employees & advances" onPress={() => router.push('/employees')} />
      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={list.reload}>
        {(list.data ?? []).length === 0 ? (
          <Empty icon="calculator-outline" title="No payroll yet" hint="Start a month: every active employee gets a payslip you can adjust for days, overtime, bonus and deductions." />
        ) : (
          list.data!.map((r) => (
            <Card key={r.id} label={`Payroll ${r.month}`} onPress={() => router.push({ pathname: '/payroll/[id]', params: { id: r.id } })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Txt style={{ fontWeight: '700' }}>{label(r.month)}</Txt>
                  <Txt v="small">{r.slips.length} payslips</Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt style={{ fontWeight: '800' }}>{fm(r.net, r)}</Txt>
                  <Badge status={TONE[r.status]} label={RUN_STATUS_LABELS[r.status]} />
                </View>
              </Row>
            </Card>
          ))
        )}
      </Loader>
    </Screen>
  );
}
