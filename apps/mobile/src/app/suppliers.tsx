import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SupplierSheet, blankSupplier, type SupplierForm } from '@/components/supplier-sheet';
import { Btn, Card, Empty, Loader, Row, Screen, SearchBar, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import type { Supplier } from '@/lib/shared';
import { lower, useWorkspace } from '@/lib/workspace';

export default function Suppliers() {
  const th = useTheme();
  const { can } = useAuth();
  const { t } = useWorkspace();
  const [q, setQ] = useState('');
  const list = useApi<Supplier[]>('/suppliers');
  const [form, setForm] = useState<SupplierForm | null>(null);
  const needle = q.trim().toLowerCase();
  const shown = (list.data ?? []).filter((s) => !needle || `${s.name} ${s.phone} ${s.contactPerson}`.toLowerCase().includes(needle));
  const owed = (list.data ?? []).reduce((a, s) => a + Math.max(s.owed ?? 0, 0), 0);

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      <Stack.Screen options={{ title: t('suppliers') }} />
      {owed > 0 && (
        <Card>
          <Txt v="small">You owe {lower(t('suppliers'))}</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 22, color: th.danger }}>{fm(owed)}</Txt>
        </Card>
      )}
      <SearchBar value={q} onChange={setQ} placeholder={`Search ${lower(t('suppliers'))}`} />
      {can('purchases.manage') && <Btn icon="add" title={`Add ${lower(t('supplier'))}`} onPress={() => setForm(blankSupplier)} />}
      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={list.reload}>
        {shown.length === 0 ? (
          <Empty icon="storefront-outline" title={needle ? 'Nothing matches' : `No ${lower(t('suppliers'))} yet`} hint="Suppliers are also added when you save a purchase bill with a new name." />
        ) : (
          shown.map((s) => (
            <Card key={s.id} label={`Supplier ${s.name}`} onPress={() => router.push({ pathname: '/supplier/[id]', params: { id: s.id } })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }}>{s.name}</Txt>
                  <Txt v="small">{[s.contactPerson, s.phone].filter(Boolean).join(' · ') || 'No contact details'}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {(s.owed ?? 0) > 0 ? <Txt style={{ fontWeight: '700', color: th.danger }}>{fm(s.owed!)}</Txt> : <Txt v="small">Nothing owed</Txt>}
                  {!!s.bought && <Txt v="small">bought {fm(s.bought)}</Txt>}
                </View>
              </Row>
            </Card>
          ))
        )}
      </Loader>
      <SupplierSheet form={form} setForm={setForm} onSaved={() => list.reload()} />
    </Screen>
  );
}
