import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Linking, Share, View } from 'react-native';
import { Btn, Card, Chips, Empty, IconBtn, KV, Loader, Row, Screen, Section, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';

interface Anomaly {
  key: string;
  kind: string;
  level: 'warn' | 'danger';
  title: string;
  sub: string;
  refType: string;
  refId: string;
}
interface Report {
  income: number;
  expenses: number;
  profit: number;
  changePct: number | null;
  collected: number;
  owed: number;
  lowStock: number;
  text: string;
  currency: string;
  currencyPrecision: number;
}
const shift = (m: string, n: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Things that look wrong, and the month in plain words, ready for WhatsApp. */
export default function InsightsScreen() {
  const th = useTheme();
  const toast = useToast();
  const odd = useApi<Anomaly[]>('/insights/anomalies');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [lang, setLang] = useState<'en' | 'ur'>('en');
  const rep = useApi<Report>(`/insights/monthly?month=${month}&lang=${lang}`);
  const m = (v: number) => fm(v, rep.data);

  function open(a: Anomaly) {
    if (a.refType === 'invoice') router.push({ pathname: '/invoice/[id]', params: { id: a.refId } });
    else if (a.refType === 'payment') router.push({ pathname: '/payment/[id]', params: { id: a.refId } });
    else if (a.refType === 'shift') router.push({ pathname: '/pos/shift', params: { id: a.refId } });
    else if (a.refType === 'user') router.push('/cashiers');
    else router.push('/finance');
  }
  async function dismiss(a: Anomaly) {
    odd.setData((odd.data ?? []).filter((x) => x.key !== a.key));
    await api('/alerts/dismiss', { body: { key: a.key } }).catch((e) => toast(e.message, 'error'));
  }

  return (
    <Screen onRefresh={() => (odd.reload(), rep.reload())}>
      <Stack.Screen options={{ title: 'Insights' }} />
      <Section title="Worth a look">
        <Loader loading={odd.loading && !odd.data} error={odd.data ? '' : odd.error} onRetry={odd.reload}>
          {(odd.data ?? []).length === 0 ? (
            <Empty icon="shield-checkmark-outline" title="Nothing unusual" hint="Checks the last 2 weeks for double payments, big discounts, drawer differences, many returns or cancels, and large withdrawals." />
          ) : (
            odd.data!.map((a) => (
              <Card key={a.key} label={a.title} onPress={() => open(a)}>
                <Row>
                  <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: a.level === 'danger' ? th.danger : th.warn }} />
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '700' }}>{a.title}</Txt>
                    <Txt v="small">{a.sub}</Txt>
                  </View>
                  <IconBtn icon="checkmark" label="Checked, hide it" onPress={() => dismiss(a)} />
                </Row>
              </Card>
            ))
          )}
        </Loader>
      </Section>
      <Section title="Monthly report">
        <Row style={{ justifyContent: 'space-between' }}>
          <IconBtn icon="chevron-back" label="Previous month" onPress={() => setMonth(shift(month, -1))} />
          <Txt style={{ fontWeight: '700' }}>{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</Txt>
          <IconBtn icon="chevron-forward" label="Next month" onPress={() => setMonth(shift(month, 1))} />
        </Row>
        <Chips value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو' }]} />
        <Loader loading={rep.loading && !rep.data} error={rep.data ? '' : rep.error} onRetry={rep.reload}>
          {rep.data && (
            <>
              <Card style={{ gap: 2 }}>
                <KV k="Income" v={m(rep.data.income)} />
                <KV k="Expenses" v={m(rep.data.expenses)} />
                <KV k={rep.data.profit >= 0 ? 'Profit' : 'Loss'} v={m(Math.abs(rep.data.profit))} bold color={rep.data.profit >= 0 ? th.success : th.danger} />
                {rep.data.changePct !== null && <KV k="Against last month" v={`${rep.data.changePct >= 0 ? '+' : ''}${rep.data.changePct}%`} />}
                <KV k="Collected" v={m(rep.data.collected)} />
                <KV k="Customers owe" v={m(rep.data.owed)} />
              </Card>
              <Card>
                <Txt selectable style={{ writingDirection: lang === 'ur' ? 'rtl' : 'ltr' } as any}>
                  {rep.data.text}
                </Txt>
              </Card>
              <Row gap={10}>
                <Btn style={{ flex: 1 }} kind="secondary" icon="logo-whatsapp" title="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(rep.data!.text)}`)} />
                <Btn style={{ flex: 1 }} kind="secondary" icon="share-social-outline" title="Share" onPress={() => Share.share({ message: rep.data!.text })} />
              </Row>
            </>
          )}
        </Loader>
      </Section>
    </Screen>
  );
}
