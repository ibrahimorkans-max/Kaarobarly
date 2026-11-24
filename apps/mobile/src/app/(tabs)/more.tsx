import { router } from 'expo-router';
import { View } from 'react-native';
import { MenuRow } from '@/components/rows';
import { Chips, Screen, Section, Txt } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useAiStatus } from '@/lib/ai-status';
import { setLang, tr, useLang } from '@/lib/i18n';
import { useAuth } from '@/lib/app-context';
import { lower, useWorkspace } from '@/lib/workspace';

export default function More() {
  const { user, can } = useAuth();
  const { t, on } = useWorkspace();
  const lang = useLang();
  const alerts = useApi<unknown[]>('/alerts');
  const aiOn = !!useAiStatus()?.available;
  return (
    <Screen>
      <View style={{ paddingTop: 0 }}>
        <Txt v="title">{tr('More')}</Txt>
        <Txt v="sub">
          {user?.name} · {user?.role}
        </Txt>
      </View>
      {user?.isPlatformAdmin && (
        <Section title="Kaarobarly SaaS (owner only)">
          <MenuRow icon="shield-checkmark-outline" title="SaaS dashboard" sub="Accounts, plans, revenue and the AI service" onPress={() => router.push('/admin')} />
        </Section>
      )}
      <Section title="Smart tools">
        <MenuRow icon="notifications-outline" title="Alerts" sub={alerts.data?.length ? `${alerts.data.length} need attention` : 'Nothing needs attention'} onPress={() => router.push('/alerts')} />
        {aiOn && <MenuRow icon="chatbubbles-outline" title="Ask Kaarobarly" sub="Questions about your business, in English or Urdu" onPress={() => router.push('/assistant')} />}
        {aiOn && <MenuRow icon="mic-outline" title="Quick entry" sub="Say or type it: “Paid 3,500 for petrol”" onPress={() => router.push('/quick-entry')} />}
        <MenuRow icon="flash-outline" title="Automation" sub="Alert rules and filing rules" onPress={() => router.push('/automation')} />
      </Section>
      <Section title="People">
        {(can('approvals.decide') || can('purchases.approve') || can('invoices.finalize')) && <MenuRow icon="checkmark-done-circle-outline" title="Approvals" sub="Requests, claims and payroll waiting for you" onPress={() => router.push('/approvals')} />}
        {on('payroll') && can('payroll.manage') && <MenuRow icon="calculator-outline" title="Payroll" sub="Salaries, advances and payslips" onPress={() => router.push('/payroll')} />}
        {on('payroll') && can('payroll.manage') && <MenuRow icon="people-outline" title="Employees" sub="Staff, pay rates and advances" onPress={() => router.push('/employees')} />}
        {on('expenseClaims') && <MenuRow icon="receipt-outline" title="Expense claims" sub="Claim money you spent; approve others' claims" onPress={() => router.push('/claims')} />}
        {can('users.manage') && <MenuRow icon="people-circle-outline" title="Team" sub="Who can sign in, and what each person may do" onPress={() => router.push('/team')} />}
      </Section>
      <Section title="Accounts">
        <MenuRow icon="people-outline" title={t('clients')} sub="Profiles, ledgers and statements" onPress={() => router.push('/clients')} />
        {on('finance') && <MenuRow icon="stats-chart-outline" title="Finance" sub="Money in, money out and expenses" onPress={() => router.push('/finance')} />}
        {on('purchases') && <MenuRow icon="bag-handle-outline" title={t('purchases')} sub={`Bills from ${lower(t('suppliers'))}, paid as money out`} onPress={() => router.push('/purchases')} />}
        {on('purchases') && <MenuRow icon="cart-outline" title="Buying" sub="Requests, purchase orders and goods received" onPress={() => router.push('/buying')} />}
        {on('purchases') && <MenuRow icon="storefront-outline" title={t('suppliers')} sub="Who you buy from and what you owe them" onPress={() => router.push('/suppliers')} />}
        {on('inventory') && <MenuRow icon="cube-outline" title="Stock" sub="In hand, value, low stock and counts" onPress={() => router.push('/stock')} />}
        {on('inventory') && <MenuRow icon="pricetag-outline" title="Labels & barcodes" sub="Design and print product and shelf labels" onPress={() => router.push('/labels')} />}
        {on('accounts') && <MenuRow icon="wallet-outline" title="Cash & Bank Accounts" sub="Balances, transfers between accounts" onPress={() => router.push('/accounts')} />}
        {on('accounts') && <MenuRow icon="book-outline" title="Daily Cashbook" sub="Opening, in, out and closing for each day" onPress={() => router.push('/cashbook')} />}
        <MenuRow icon="alarm-outline" title="Collections" sub="Who owes you, how late, and one-tap reminders" onPress={() => router.push('/collections')} />
        <MenuRow icon="calendar-number-outline" title="Bills calendar" sub="What to collect and pay, day by day" onPress={() => router.push('/calendar')} />
        {on('reports') && <MenuRow icon="analytics-outline" title="Cash forecast · Balance sheet" sub="Will there be enough cash? What the business is worth" onPress={() => router.push('/forecast')} />}
        {on('cheques') && <MenuRow icon="card-outline" title="Cheques" sub="Post-dated cheques, deposits and bounces" onPress={() => router.push('/cheques')} />}
        {on('loans') && <MenuRow icon="git-compare-outline" title="Loans" sub="Borrowed and lent, repayments and interest" onPress={() => router.push('/loans')} />}
        {on('budgets') && <MenuRow icon="pie-chart-outline" title="Budgets" sub="Monthly spending limits by category" onPress={() => router.push('/budgets')} />}
        {on('dayClose') && <MenuRow icon="lock-closed-outline" title="Day close" sub="Count the cash and lock the day" onPress={() => router.push('/day-close')} />}
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
      <Section title="Language">
        <Chips
          value={lang}
          onChange={setLang}
          options={[
            { value: 'en', label: 'English' },
            { value: 'ur', label: 'اردو' },
          ]}
        />
        <Txt v="small">Printed documents have their own language setting in Business Profiles.</Txt>
      </Section>
      <Section title="Setup">
        <MenuRow icon="options-outline" title="Business setup" sub="Business type, modules, your words, custom fields" onPress={() => router.push('/workspace')} />
        <MenuRow icon="business-outline" title="Business Profiles" sub={`${t('invoice')} design, signature and issuer details`} onPress={() => router.push('/businesses')} />
        <MenuRow icon="diamond-outline" title="Plan & usage" sub="Your subscription, limits and upgrades" onPress={() => router.push('/plan')} />
        <MenuRow icon="settings-outline" title="Settings & Security" sub="App lock, fingerprint, theme and devices" onPress={() => router.push('/settings')} />
      </Section>
    </Screen>
  );
}
