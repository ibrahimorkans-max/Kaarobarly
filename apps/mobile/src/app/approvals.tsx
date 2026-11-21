import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Empty, Loader, Row, Screen, Txt, fd, fm, type IconName } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import type { ApprovalItem } from '@/lib/shared';
import Ionicons from '@expo/vector-icons/Ionicons';

const ICON: Record<ApprovalItem['kind'], IconName> = { purchase_request: 'hand-left-outline', expense_claim: 'receipt-outline', payroll: 'calculator-outline', recurring_draft: 'repeat-outline' };

/** Everything waiting for your decision, in one list. */
export default function Approvals() {
  const th = useTheme();
  const { data, loading, error, reload, refreshing } = useApi<ApprovalItem[]>('/approvals');
  const open = (a: ApprovalItem) => {
    if (a.kind === 'purchase_request') router.push({ pathname: '/request/[id]', params: { id: a.id } });
    else if (a.kind === 'payroll') router.push({ pathname: '/payroll/[id]', params: { id: a.id } });
    else if (a.kind === 'recurring_draft') router.push({ pathname: '/invoice/[id]', params: { id: a.id } });
    else router.push('/claims');
  };
  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {(data ?? []).length === 0 ? (
          <Empty icon="checkmark-done-circle-outline" title="Nothing waiting" hint="Purchase requests, expense claims, payroll and recurring invoices that need your OK show up here." />
        ) : (
          data!.map((a) => (
            <Card key={`${a.kind}-${a.id}`} label={a.title} onPress={() => open(a)}>
              <Row gap={12}>
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: th.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={ICON[a.kind]} size={20} color={th.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>{a.title}</Txt>
                  <Txt v="small" numberOfLines={1}>
                    {a.byName} · {fd(a.date)} · {a.sub}
                  </Txt>
                </View>
                {a.amount > 0 && <Txt style={{ fontWeight: '800' }}>{fm(a.amount)}</Txt>}
              </Row>
            </Card>
          ))
        )}
      </Loader>
    </Screen>
  );
}
