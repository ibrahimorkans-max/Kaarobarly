import { tr } from '@/lib/i18n';
import { Ionicons } from '@expo/vector-icons';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useTheme } from '@/lib/app-context';
import type { ModuleKey, TermKey } from '@/lib/shared';
import { useWorkspace } from '@/lib/workspace';
import { SyncBanner } from './sync-ui';
import { MAX_WIDTH, Sheet, Txt, type IconName } from './ui';

// ------------------------------------------------------------ history
// The app keeps its own list of visited pages so Forward works on phones too, not only in a browser.

let entries: string[] = [];
let index = -1;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

function visit(href: string) {
  if (entries[index] === href) return;
  if (index > 0 && entries[index - 1] === href) index--;
  else if (entries[index + 1] === href) index++;
  else {
    entries = [...entries.slice(0, index + 1), href].slice(-100);
    index = entries.length - 1;
  }
  emit();
}

const HOME = '/';

export const navHistory = {
  canBack: () => index > 0 || router.canGoBack(),
  canForward: () => index < entries.length - 1,
  back() {
    if (router.canGoBack()) router.back();
    else if (index > 0) router.navigate(entries[index - 1] as never);
    else router.navigate(HOME);
  },
  forward() {
    if (index < entries.length - 1) router.push(entries[index + 1] as never);
  },
  reset() {
    entries = [];
    index = -1;
    emit();
  },
};

function useHistoryVersion() {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => version,
  );
}

/** Records every page the user lands on. Mount once, inside the router. */
export function NavTracker() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const segments = pathname.split('/').map(decodeURIComponent);
  const query = Object.entries(params)
    .filter(([, v]) => typeof v === 'string' && !segments.includes(v))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join('&');
  const href = query ? `${pathname}?${query}` : pathname;
  useEffect(() => visit(href), [href]);
  return null;
}

// ------------------------------------------------------------ bar

type Jump = { icon: IconName; title: string; href: string; mod?: ModuleKey };
/** Pages in the Go to menu, in this business's words, without switched-off modules. */
function jumps(t: (k: TermKey) => string, on: (m: ModuleKey) => boolean): Jump[] {
  const all: Jump[] = [
    { icon: 'grid-outline', title: 'Home', href: '/' },
    { icon: 'document-text-outline', title: t('invoices'), href: '/invoices' },
    { icon: 'add-circle-outline', title: `New ${t('invoice')}`, href: '/invoice/new' },
    { icon: 'people-outline', title: t('clients'), href: '/clients' },
    { icon: 'cash-outline', title: 'Payments', href: '/payments', mod: 'payments' },
    { icon: 'document-outline', title: t('quotations'), href: '/quotations', mod: 'quotations' },
    { icon: 'repeat-outline', title: 'Recurring', href: '/recurring', mod: 'recurring' },
    { icon: 'bag-handle-outline', title: t('purchases'), href: '/purchases', mod: 'purchases' },
    { icon: 'cart-outline', title: 'Buying', href: '/buying', mod: 'purchases' },
    { icon: 'storefront-outline', title: t('suppliers'), href: '/suppliers', mod: 'purchases' },
    { icon: 'cube-outline', title: 'Stock', href: '/stock', mod: 'inventory' },
    { icon: 'stats-chart-outline', title: 'Finance', href: '/finance', mod: 'finance' },
    { icon: 'wallet-outline', title: 'Accounts', href: '/accounts', mod: 'accounts' },
    { icon: 'book-outline', title: 'Cashbook', href: '/cashbook', mod: 'accounts' },
    { icon: 'trending-up-outline', title: 'Profit & Loss', href: '/statements', mod: 'reports' },
    { icon: 'alarm-outline', title: 'Collections', href: '/collections' },
    { icon: 'calendar-number-outline', title: 'Calendar', href: '/calendar' },
    { icon: 'analytics-outline', title: 'Forecast', href: '/forecast', mod: 'reports' },
    { icon: 'card-outline', title: 'Cheques', href: '/cheques', mod: 'cheques' },
    { icon: 'git-compare-outline', title: 'Loans', href: '/loans', mod: 'loans' },
    { icon: 'pie-chart-outline', title: 'Budgets', href: '/budgets', mod: 'budgets' },
    { icon: 'lock-closed-outline', title: 'Day close', href: '/day-close', mod: 'dayClose' },
    { icon: 'bar-chart-outline', title: 'Reports', href: '/reports', mod: 'reports' },
    { icon: 'pricetags-outline', title: t('items'), href: '/services' },
    { icon: 'business-outline', title: 'Businesses', href: '/businesses' },
    { icon: 'options-outline', title: 'Business setup', href: '/workspace' },
    { icon: 'settings-outline', title: 'Settings', href: '/settings' },
    { icon: 'menu-outline', title: 'More', href: '/more' },
  ];
  return all.filter((j) => !j.mod || on(j.mod));
}

function NavBtn({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.primarySoft : t.bg,
        borderWidth: 1,
        borderColor: t.border,
        opacity: disabled ? 0.35 : 1,
      })}>
      <Ionicons name={icon} size={20} color={disabled ? t.sub : t.text} />
    </Pressable>
  );
}

/** Top navigation bar shown on every signed-in page: back, forward, title, home and a jump menu. */
export function NavBar({ title }: { title?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { user } = useAuth();
  const [menu, setMenu] = useState(false);
  const { t: term, on } = useWorkspace();
  useHistoryVersion();
  const isHome = pathname === '/';
  const go = (href: string) => {
    setMenu(false);
    if (href !== pathname) router.navigate(href as never);
  };
  return (
    <View style={{ backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 8, paddingHorizontal: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' }}>
          <NavBtn icon="chevron-back" label="Back" onPress={navHistory.back} disabled={!navHistory.canBack() && isHome} />
          <NavBtn icon="chevron-forward" label="Forward" onPress={navHistory.forward} disabled={!navHistory.canForward()} />
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 17, fontWeight: '800', marginLeft: 4 }}>
            {title ? tr(title) : 'Kaarobarly'}
          </Text>
          <NavBtn icon={isHome ? 'home' : 'home-outline'} label="Home" onPress={() => go('/')} disabled={isHome} />
          <NavBtn icon="apps-outline" label="Go to page" onPress={() => setMenu(true)} />
        </View>
      </View>
      {!!user && <SyncBanner embedded />}
      <Sheet visible={menu} title={tr('Go to')} onClose={() => setMenu(false)}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {jumps(term, on).map((j) => {
            const active = j.href === pathname;
            return (
              <Pressable
                key={j.href}
                accessibilityRole="button"
                accessibilityLabel={j.title}
                onPress={() => go(j.href)}
                style={({ pressed }) => ({
                  width: '30%',
                  flexGrow: 1,
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: 14,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active ? t.primary : t.border,
                  backgroundColor: active || pressed ? t.primarySoft : t.card,
                })}>
                <Ionicons name={j.icon} size={22} color={t.primary} />
                <Txt v="small" style={{ fontWeight: '700', color: t.text }} numberOfLines={1}>
                  {tr(j.title)}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}
