import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { PeriodChips, periodRange, type PeriodKey } from '@/components/period';
import { Card, KV, Loader, Row, Screen, Section, Txt, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';

interface TaxSummary {
  months: { month: string; taxableSales: number; outputTax: number; purchases: number; inputTax: number; paid: number; payable: number }[];
  totals: { taxableSales: number; outputTax: number; inputTax: number; payable: number; paid: number };
  noNtn: { clientId: string; name: string; sales: number; invoices: number }[];
  currency: string;
  currencyPrecision: number;
}

const monthName = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** Sales tax collected against tax paid on purchases, and what is left to pay, ready for the monthly return. */
export default function TaxScreen() {
  const th = useTheme();
  const [period, setPeriod] = useState<PeriodKey>('year');
  const r = periodRange(period);
  const { data, loading, error, reload } = useApi<TaxSummary>(`/tax/summary?from=${r.from}&to=${r.to}`);
  const m = (v: number) => fm(v, data);
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Tax centre' }} />
      <PeriodChips value={period} onChange={setPeriod} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <>
            <Card style={{ gap: 4 }}>
              <KV k="Sales tax collected (output)" v={m(data.totals.outputTax)} />
              <KV k="Tax paid on purchases (input)" v={`− ${m(data.totals.inputTax)}`} />
              <KV k="Payable for the period" v={m(data.totals.payable)} bold color={data.totals.payable > 0 ? th.warn : th.success} />
              <KV k="Paid to the tax office" v={m(data.totals.paid)} />
              <KV k="Taxable sales" v={m(data.totals.taxableSales)} />
            </Card>
            <Txt v="small">Input tax comes from the sales tax you enter on purchase bills. Tax payments are money-out entries in the Taxes & fees category.</Txt>
            <Section title="By month">
              {data.months.length === 0 && <Txt v="sub">No taxed sales or purchases in this period.</Txt>}
              {[...data.months].reverse().map((x) => (
                <Card key={x.month} style={{ gap: 2 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt style={{ fontWeight: '700' }}>{monthName(x.month)}</Txt>
                    <Txt style={{ fontWeight: '800', color: x.payable > 0 ? th.warn : th.success }}>{m(x.payable)}</Txt>
                  </Row>
                  <Txt v="small">
                    Output {m(x.outputTax)} · input {m(x.inputTax)} · paid {m(x.paid)}
                  </Txt>
                </Card>
              ))}
            </Section>
            {data.noNtn.length > 0 && (
              <Section title="Taxed sales to customers without an NTN">
                {data.noNtn.map((c) => (
                  <Card key={c.clientId} label={c.name} onPress={() => router.push({ pathname: '/client/[id]', params: { id: c.clientId } })}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Txt style={{ fontWeight: '700' }}>{c.name}</Txt>
                        <Txt v="small">{c.invoices} invoices · add their NTN on the customer</Txt>
                      </View>
                      <Txt style={{ fontWeight: '700' }}>{m(c.sales)}</Txt>
                    </Row>
                  </Card>
                ))}
              </Section>
            )}
          </>
        )}
      </Loader>
    </Screen>
  );
}
