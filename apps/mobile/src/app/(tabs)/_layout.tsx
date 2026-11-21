import { Tabs } from 'expo-router/js-tabs';
import { NavBar } from '@/components/nav-bar';
import { StyledTabBar } from '@/components/tab-bar';
import { useAuth, useTheme } from '@/lib/app-context';
import { useWorkspace } from '@/lib/workspace';

export default function TabsLayout() {
  const th = useTheme();
  const { can } = useAuth();
  const { t, on } = useWorkspace();
  return (
    <Tabs
      tabBar={(props: any) => <StyledTabBar {...props} canCreate={can('invoices.create')} />}
      screenOptions={{
        header: () => <NavBar />,
        sceneStyle: { backgroundColor: th.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="invoices" options={{ title: t('invoices') }} />
      <Tabs.Screen name="create" options={{ title: `Create ${t('invoice')}` }} />
      {/* `hidden` is read by StyledTabBar: a switched-off module leaves the bar */}
      <Tabs.Screen name="purchases" options={{ title: t('purchases'), hidden: !on('purchases') } as any} />
      <Tabs.Screen name="finance" options={{ title: 'Finance', hidden: !on('finance') && !on('accounts') } as any} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
