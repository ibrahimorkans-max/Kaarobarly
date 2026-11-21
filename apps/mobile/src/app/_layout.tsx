import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SplashReveal } from '@/components/splash';
import { NavBar, NavTracker } from '@/components/nav-bar';
import { SyncBanner } from '@/components/sync-ui';
import { Loading } from '@/components/ui';
import { AppProviders, useAuth, useTheme } from '@/lib/app-context';
import { LockProvider } from '@/lib/lock';
import { useLang } from '@/lib/i18n';

function Navigation() {
  const { user, ready } = useAuth();
  const t = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center' }}>
        <Loading />
      </View>
    );
  }
  const base = t.dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: t.bg, card: t.card, text: t.text, border: t.border, primary: t.primary } }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {!user && <SyncBanner />}
      <NavTracker />
      <Stack
        screenOptions={{
          header: ({ options }) => <NavBar title={typeof options.title === 'string' ? options.title : undefined} />,
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerTitleStyle: { fontWeight: '700' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: t.bg },
        }}>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="invoice/new" options={{ title: 'Create Invoice' }} />
          <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
          <Stack.Screen name="client/[id]" options={{ title: 'Client' }} />
          <Stack.Screen name="client/edit" options={{ title: 'Client' }} />
          <Stack.Screen name="payment/new" options={{ title: 'Record Payment' }} />
          <Stack.Screen name="payment/[id]" options={{ title: 'Receipt' }} />
          <Stack.Screen name="business/edit" options={{ title: 'Business Profile' }} />
          <Stack.Screen name="businesses" options={{ title: 'Business Profiles' }} />
          <Stack.Screen name="services" options={{ title: 'Services & Products' }} />
          <Stack.Screen name="payments" options={{ title: 'Payments & Receipts' }} />
          <Stack.Screen name="installments" options={{ title: 'Installments' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="clients" options={{ title: 'Clients' }} />
          <Stack.Screen name="quotations" options={{ title: 'Quotations' }} />
          <Stack.Screen name="quotation/new" options={{ title: 'New Quotation' }} />
          <Stack.Screen name="quotation/[id]" options={{ title: 'Quotation' }} />
          <Stack.Screen name="recurring/index" options={{ title: 'Recurring Invoices' }} />
          <Stack.Screen name="recurring/new" options={{ title: 'New Recurring Invoice' }} />
          <Stack.Screen name="recurring/[id]" options={{ title: 'Recurring Invoice' }} />
          <Stack.Screen name="reports" options={{ title: 'Reports' }} />
          <Stack.Screen name="accounts" options={{ title: 'Cash & Bank Accounts' }} />
          <Stack.Screen name="cashbook" options={{ title: 'Daily Cashbook' }} />
          <Stack.Screen name="statements" options={{ title: 'Profit & Loss · Cash Flow' }} />
          <Stack.Screen name="rates" options={{ title: 'Exchange Rates' }} />
          <Stack.Screen name="purchase/new" options={{ title: 'New Purchase' }} />
          <Stack.Screen name="purchase/[id]" options={{ title: 'Purchase' }} />
          <Stack.Screen name="sync" options={{ title: 'Sync & Offline' }} />
          <Stack.Screen name="setup" options={{ title: 'Set up your business' }} />
          <Stack.Screen name="workspace" options={{ title: 'Business setup' }} />
          <Stack.Screen name="custom-fields" options={{ title: 'Custom fields' }} />
          <Stack.Screen name="buying" options={{ title: 'Buying' }} />
          <Stack.Screen name="suppliers" options={{ title: 'Suppliers' }} />
          <Stack.Screen name="supplier/[id]" options={{ title: 'Supplier' }} />
          <Stack.Screen name="stock/index" options={{ title: 'Stock' }} />
          <Stack.Screen name="stock/[id]" options={{ title: 'Stock' }} />
          <Stack.Screen name="request/[id]" options={{ title: 'Purchase request' }} />
          <Stack.Screen name="order/[id]" options={{ title: 'Purchase order' }} />
          <Stack.Screen name="receipt/[id]" options={{ title: 'Goods received' }} />
          <Stack.Screen name="cheques" options={{ title: 'Cheques' }} />
          <Stack.Screen name="loans" options={{ title: 'Loans' }} />
          <Stack.Screen name="loan/[id]" options={{ title: 'Loan' }} />
          <Stack.Screen name="budgets" options={{ title: 'Budgets' }} />
          <Stack.Screen name="calendar" options={{ title: 'Bills calendar' }} />
          <Stack.Screen name="forecast" options={{ title: 'Cash forecast · Balance sheet' }} />
          <Stack.Screen name="day-close" options={{ title: 'Day close' }} />
          <Stack.Screen name="collections" options={{ title: 'Collections' }} />
          <Stack.Screen name="team" options={{ title: 'Team' }} />
          <Stack.Screen name="employees" options={{ title: 'Employees' }} />
          <Stack.Screen name="payroll/index" options={{ title: 'Payroll' }} />
          <Stack.Screen name="payroll/[id]" options={{ title: 'Payroll' }} />
          <Stack.Screen name="claims" options={{ title: 'Expense claims' }} />
          <Stack.Screen name="approvals" options={{ title: 'Approvals' }} />
          <Stack.Screen name="assistant" options={{ title: 'Ask Kaarobarly' }} />
          <Stack.Screen name="quick-entry" options={{ title: 'Quick entry' }} />
          <Stack.Screen name="ai-settings" options={{ title: 'AI settings' }} />
          <Stack.Screen name="automation" options={{ title: 'Automation' }} />
          <Stack.Screen name="alerts" options={{ title: 'Alerts' }} />
          <Stack.Screen name="plan" options={{ title: 'Plan & usage' }} />
          <Stack.Screen name="platform" options={{ title: 'Kaarobarly admin' }} />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [splash, setSplash] = useState(true);
  // changing the app language redraws every screen with the new words
  const lang = useLang();
  return (
    <SafeAreaProvider>
      <AppProviders>
        <LockProvider>
          <Navigation key={lang} />
        </LockProvider>
      </AppProviders>
      {splash && <SplashReveal onDone={() => setSplash(false)} />}
    </SafeAreaProvider>
  );
}
