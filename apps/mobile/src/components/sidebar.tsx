import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth, useTheme } from '@/lib/app-context';
import { tr } from '@/lib/i18n';
import type { ModuleKey, TermKey } from '@/lib/shared';
import { local } from '@/lib/storage';
import { useWorkspace } from '@/lib/workspace';
import { AnimatedMark } from './animated-mark';
import { Wordmark } from './logo';
import type { IconName } from './ui';

type Item = { icon: IconName; title: string; href: string; mod?: ModuleKey; admin?: boolean };
type Group = { title: string; items: Item[] };

/** Every page, grouped the way a desktop business app reads, in this business's own words. */
function groups(t: (k: TermKey) => string): Group[] {
  return [
    {
      title: 'Sell',
      items: [
        { icon: 'grid-outline', title: 'Home', href: '/' },
        { icon: 'scan-outline', title: 'POS counter', href: '/pos', mod: 'pos' },
        { icon: 'restaurant-outline', title: 'Restaurant', href: '/restaurant', mod: 'restaurant' },
        { icon: 'document-text-outline', title: t('invoices'), href: '/invoices' },
        { icon: 'document-outline', title: t('quotations'), href: '/quotations', mod: 'quotations' },
        { icon: 'people-outline', title: t('clients'), href: '/clients' },
        { icon: 'cash-outline', title: 'Payments', href: '/payments', mod: 'payments' },
        { icon: 'alarm-outline', title: 'Collections', href: '/collections' },
        { icon: 'repeat-outline', title: 'Recurring', href: '/recurring', mod: 'recurring' },
        { icon: 'pricetags-outline', title: t('items'), href: '/services' },
      ],
    },
    {
      title: 'Buy & stock',
      items: [
        { icon: 'bag-handle-outline', title: t('purchases'), href: '/purchases', mod: 'purchases' },
        { icon: 'time-outline', title: 'Unpaid purchases', href: '/payables', mod: 'purchases' },
        { icon: 'cart-outline', title: 'Buying', href: '/buying', mod: 'purchases' },
        { icon: 'storefront-outline', title: t('suppliers'), href: '/suppliers', mod: 'purchases' },
        { icon: 'cube-outline', title: 'Stock', href: '/stock', mod: 'inventory' },
      ],
    },
    {
      title: 'Money',
      items: [
        { icon: 'stats-chart-outline', title: 'Finance', href: '/finance', mod: 'finance' },
        { icon: 'wallet-outline', title: 'Accounts', href: '/accounts', mod: 'accounts' },
        { icon: 'book-outline', title: 'Cashbook', href: '/cashbook', mod: 'accounts' },
        { icon: 'card-outline', title: 'Cheques', href: '/cheques', mod: 'cheques' },
        { icon: 'git-compare-outline', title: 'Loans', href: '/loans', mod: 'loans' },
        { icon: 'pie-chart-outline', title: 'Budgets', href: '/budgets', mod: 'budgets' },
        { icon: 'lock-closed-outline', title: 'Day close', href: '/day-close', mod: 'dayClose' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { icon: 'trending-up-outline', title: 'Profit & Loss', href: '/statements', mod: 'reports' },
        { icon: 'bar-chart-outline', title: 'Reports', href: '/reports', mod: 'reports' },
        { icon: 'analytics-outline', title: 'Forecast', href: '/forecast', mod: 'reports' },
        { icon: 'notifications-outline', title: 'Alerts', href: '/alerts' },
        { icon: 'calendar-number-outline', title: 'Calendar', href: '/calendar' },
      ],
    },
    {
      title: 'Team',
      items: [
        { icon: 'calculator-outline', title: 'Payroll', href: '/payroll', mod: 'payroll' },
        { icon: 'receipt-outline', title: 'Claims', href: '/claims', mod: 'expenseClaims' },
        { icon: 'checkmark-done-circle-outline', title: 'Approvals', href: '/approvals' },
      ],
    },
    {
      title: 'Setup',
      items: [
        { icon: 'business-outline', title: 'Businesses', href: '/businesses' },
        { icon: 'options-outline', title: 'Business setup', href: '/workspace' },
        { icon: 'settings-outline', title: 'Settings', href: '/settings' },
        { icon: 'apps-outline', title: 'All tools', href: '/more' },
        { icon: 'shield-checkmark-outline', title: 'Tijar SaaS', href: '/admin', admin: true },
      ],
    },
  ];
}

const COLLAPSED_KEY = 'tijar.sidebarCollapsed';

/** The desktop sidebar: logo, a "new invoice" button, every page in groups, and who is signed in. */
export function Sidebar() {
  const th = useTheme();
  const pathname = usePathname();
  const { user, can } = useAuth();
  const { t, on } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    local.get<boolean>(COLLAPSED_KEY).then((v) => setCollapsed(!!v)).catch(() => {});
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      void local.set(COLLAPSED_KEY, !c).catch(() => {});
      return !c;
    });
  };
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
  const width = collapsed ? 76 : 248;

  return (
    <View style={{ width, backgroundColor: th.card, borderRightWidth: 1, borderRightColor: th.border }}>
      <View style={{ height: 62, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: collapsed ? 0 : 18, justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <Pressable accessibilityRole="link" accessibilityLabel="Tijar home" onPress={() => router.navigate('/')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <AnimatedMark size={32} />
          {!collapsed && <Wordmark height={18} onDark={th.dark} />}
        </Pressable>
      </View>

      {can('invoices.create') && (
        <View style={{ paddingHorizontal: collapsed ? 14 : 14, paddingBottom: 10 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`New ${t('invoice')}`}
            onPress={() => router.navigate('/invoice/new')}
            style={({ pressed, hovered }: any) => ({
              height: 44,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: th.primary,
              opacity: pressed ? 0.85 : 1,
              transform: [{ translateY: hovered ? -1 : 0 }],
              boxShadow: '0 6px 16px rgba(15,138,111,0.3)',
            }) as any}>
            <Ionicons name="add" size={20} color={th.onPrimary} />
            {!collapsed && <Text style={{ color: th.onPrimary, fontWeight: '800', fontSize: 15 }}>{tr(`New ${t('invoice')}`)}</Text>}
          </Pressable>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {groups(t).map((g) => {
          const items = g.items.filter((i) => (!i.mod || on(i.mod)) && (!i.admin || user?.isPlatformAdmin));
          if (!items.length) return null;
          return (
            <View key={g.title} style={{ marginTop: 10 }}>
              {collapsed ? (
                <View style={{ height: 1, backgroundColor: th.border, marginHorizontal: 12, marginBottom: 6 }} />
              ) : (
                <Text style={{ color: th.sub, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 12, marginBottom: 4 }}>{tr(g.title)}</Text>
              )}
              {items.map((i) => {
                const on = active(i.href);
                return (
                  <Pressable
                    key={i.href}
                    accessibilityRole="link"
                    accessibilityLabel={i.title}
                    accessibilityState={{ selected: on }}
                    onPress={() => router.navigate(i.href as never)}
                    style={({ hovered }: any) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      height: 40,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      backgroundColor: on ? th.primarySoft : hovered ? th.neutralSoft : 'transparent',
                    }) as any}>
                    {on && <View style={{ position: 'absolute', left: 0, top: 9, bottom: 9, width: 3, borderRadius: 2, backgroundColor: th.primary }} />}
                    <Ionicons name={(on ? i.icon.replace('-outline', '') : i.icon) as IconName} size={19} color={on ? th.primary : th.sub} />
                    {!collapsed && (
                      <Text numberOfLines={1} style={{ flex: 1, color: on ? th.primary : th.text, fontWeight: on ? '800' : '600', fontSize: 14 }}>
                        {tr(i.title)}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: th.border, padding: 10, gap: 6 }}>
        {!collapsed && user && (
          <Pressable accessibilityRole="link" onPress={() => router.navigate('/plan')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: th.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: th.onPrimary, fontWeight: '900' }}>{(user.name || '?').trim().charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: th.text, fontWeight: '700', fontSize: 13 }}>{user.name}</Text>
              <Text numberOfLines={1} style={{ color: th.sub, fontSize: 12 }}>{user.tenantName}</Text>
            </View>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onPress={toggle} style={{ height: 34, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 8, paddingHorizontal: 10 }}>
          <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-back'} size={18} color={th.sub} />
          {!collapsed && <Text style={{ color: th.sub, fontWeight: '600', fontSize: 13 }}>{tr('Collapse')}</Text>}
        </Pressable>
      </View>
    </View>
  );
}
