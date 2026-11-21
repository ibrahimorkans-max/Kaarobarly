import { router } from 'expo-router';
import { View } from 'react-native';
import { MenuRow } from '@/components/rows';
import { Screen, Section, Txt } from '@/components/ui';
import { useAuth } from '@/lib/app-context';
import { lower, useWorkspace } from '@/lib/workspace';

export default function More() {
  const { user } = useAuth();
  const { t, on } = useWorkspace();
  return (
    <Screen>
      <View style={{ paddingTop: 0 }}>
        <Txt v="title">More</Txt>
        <Txt v="sub">
          {user?.name} · {user?.role}
        </Txt>
      </View>
      <Section title="Accounts">
        <MenuRow icon="people-outline" title={t('clients')} sub="Profiles, ledgers and statements" onPress={() => router.push('/clients')} />
        {on('finance') && <MenuRow icon="stats-chart-outline" title="Finance" sub="Money in, money out and expenses" onPress={() => router.push('/finance')} />}
        {on('purchases') && <MenuRow icon="bag-handle-outline" title={t('purchases')} sub={`Bills from ${lower(t('suppliers'))}, paid as money out`} onPress={() => router.push('/purchases')} />}
        {on('accounts') && <MenuRow icon="wallet-outline" title="Cash & Bank Accounts" sub="Balances, transfers between accounts" onPress={() => router.push('/accounts')} />}
        {on('accounts') && <MenuRow icon="book-outline" title="Daily Cashbook" sub="Opening, in, out and closing for each day" onPress={() => router.push('/cashbook')} />}
        {on('reports') && <MenuRow icon="trending-up-outline" title="Profit & Loss · Cash Flow" sub="Is the business making money?" onPress={() => router.push('/statements')} />}
        {on('multiCurrency') && <MenuRow icon="globe-outline" title="Exchange Rates" sub={`Multi-currency ${lower(t('invoices'))} and accounts`} onPress={() => router.push('/rates')} />}
        {on('quotations') && <MenuRow icon="document-outline" title={t('quotations')} sub={`Price quotes you can turn into ${lower(t('invoices'))}`} onPress={() => router.push('/quotations')} />}
        {on('recurring') && <MenuRow icon="repeat-outline" title={`Recurring ${t('invoices')}`} sub="Schedules, and drafts awaiting approval" onPress={() => router.push('/recurring')} />}
        {on('reports') && <MenuRow icon="bar-chart-outline" title="Reports" sub={`Collections, ${lower(t('clients'))}, ${lower(t('items'))} · PDF & Excel`} onPress={() => router.push('/reports')} />}
        <MenuRow icon="pricetags-outline" title={t('items')} sub="Your catalogue and default prices" onPress={() => router.push('/services')} />
        <MenuRow icon="cash-outline" title="Payments" sub="Record and review payments" onPress={() => router.push('/payments')} />
        {on('installments') && <MenuRow icon="calendar-outline" title="Installments" sub="Scheduled and overdue installments" onPress={() => router.push('/installments')} />}
        <MenuRow icon="receipt-outline" title="Receipts" sub="Reprint or share any receipt" onPress={() => router.push('/payments')} />
      </Section>
      <Section title="Setup">
        <MenuRow icon="options-outline" title="Business setup" sub="Business type, modules, your words, custom fields" onPress={() => router.push('/workspace')} />
        <MenuRow icon="business-outline" title="Business Profiles" sub={`${t('invoice')} design, signature and issuer details`} onPress={() => router.push('/businesses')} />
        <MenuRow icon="settings-outline" title="Settings & Security" sub="App lock, fingerprint, theme and devices" onPress={() => router.push('/settings')} />
      </Section>
    </Screen>
  );
}
