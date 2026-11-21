import { useState } from 'react';
import { View } from 'react-native';
import { Bars } from '@/components/charts';
import { Card, Chips, KV, Loader, Notice, Row, Screen, Section, Txt, fd, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import type { BalanceSheet, CashForecast } from '@/lib/shared';

/** Will there be enough cash? Week by week from today, plus where the business stands now. */
export default function Forecast() {
  const th = useTheme();
  const [days, setDays] = useState<'30' | '60' | '90'>('30');
  const { data: f, loading, error, reload, refreshing } = useApi<CashForecast>(`/forecast?days=${days}`);
  const bs = useApi<BalanceSheet>('/reports/balance-sheet');
  const money = (v: number) => fm(v, f ?? undefined);

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Chips
        value={days}
        onChange={setDays}
        options={[
          { value: '30', label: 'Next 30 days' },
          { value: '60', label: '60 days' },
          { value: '90', label: '90 days' },
        ]}
      />
      <Loader loading={loading && !f} error={f ? '' : error} onRetry={reload}>
        {f && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Txt v="small">Cash & bank now</Txt>
                  <Txt style={{ fontWeight: '800', fontSize: 22 }}>{money(f.opening)}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt v="small">Expected in {f.days} days</Txt>
                  <Txt style={{ fontWeight: '800', fontSize: 22, color: (f.weeks[f.weeks.length - 1]?.closing ?? 0) < 0 ? th.danger : th.text }}>{money(f.weeks[f.weeks.length - 1]?.closing ?? f.opening)}</Txt>
                </View>
              </Row>
            </Card>
            {f.lowest.balance < 0 ? (
              <Notice kind="danger">
                Cash runs out around {fd(f.lowest.date)} ({money(f.lowest.balance)}). Collect overdue money or move payments.
              </Notice>
            ) : f.lowest.balance < f.regularCosts ? (
              <Notice kind="warn">
                Lowest point {money(f.lowest.balance)} around {fd(f.lowest.date)}, less than one month of running costs.
              </Notice>
            ) : null}
            <Card>
              <Txt v="label">Expected balance, week by week</Txt>
              <Bars values={f.weeks.map((w) => Math.max(w.closing, 0))} labels={f.weeks.map((w) => fd(w.start).split(' ').slice(0, 2).join(' '))} color={th.primary} soft={th.primarySoft} />
            </Card>
            <Section title="Week by week">
              {f.weeks.map((w) => (
                <Card key={w.start}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt style={{ fontWeight: '700' }}>
                      {fd(w.start)} – {fd(w.end)}
                    </Txt>
                    <Txt style={{ fontWeight: '800', color: w.closing < 0 ? th.danger : th.text }}>{money(w.closing)}</Txt>
                  </Row>
                  <Txt v="small">
                    in {money(w.moneyIn)} · out {money(w.moneyOut)}
                  </Txt>
                </Card>
              ))}
            </Section>
            <Card>
              <KV k="Overdue from clients (not counted)" v={money(f.overdueIn)} />
              <KV k="Overdue to pay (not counted)" v={money(f.overdueOut)} />
              <KV k="Running costs per month (estimate)" v={money(f.regularCosts)} />
              <Txt v="small">Counts invoices, installments, supplier bills, cheques and loan payments by their due dates, plus your average everyday spending over the last 3 months.</Txt>
            </Card>
          </>
        )}
      </Loader>
      {bs.data && (
        <Section title="Balance sheet today">
          <Card>
            <Txt v="label">What the business has</Txt>
            {bs.data.assets.map((a) => (
              <KV key={a.label} k={a.label} v={fm(a.amount, bs.data!)} />
            ))}
            <KV k="Total" v={fm(bs.data.totalAssets, bs.data)} bold />
          </Card>
          <Card>
            <Txt v="label">What it owes</Txt>
            {bs.data.liabilities.length === 0 ? <Txt v="small">Nothing owed.</Txt> : bs.data.liabilities.map((a) => <KV key={a.label} k={a.label} v={fm(a.amount, bs.data!)} />)}
            <KV k="Total" v={fm(bs.data.totalLiabilities, bs.data)} bold />
          </Card>
          <Card>
            <KV k="Net worth (owner's equity)" v={fm(bs.data.equity, bs.data)} bold color={bs.data.equity < 0 ? th.danger : th.success} />
          </Card>
        </Section>
      )}
    </Screen>
  );
}
