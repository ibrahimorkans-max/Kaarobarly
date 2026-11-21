import { useState } from 'react';
import { Image, View } from 'react-native';
import { AccountSelect } from '@/components/money';
import { Badge, Btn, Card, Chips, DateField, Empty, Field, KV, Loader, Row, Screen, Sheet, Txt, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { pickImage } from '@/lib/image';
import { EXPENSE_CATEGORIES, parseMoney, type BusinessProfile, type ExpenseClaim, type MoneyAccount } from '@/lib/shared';

const TONE: Record<string, string> = { pending: 'draft', approved: 'unpaid', rejected: 'cancelled', paid: 'paid' };
const LABEL: Record<string, string> = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', paid: 'Paid' };

/** Staff claim money they spent for the business; a manager approves and pays it. */
export default function Claims() {
  const toast = useToast();
  const { user, can } = useAuth();
  const list = useApi<ExpenseClaim[]>('/expense-claims');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const [form, setForm] = useState<{ date: string; category: string; amount: string; description: string; receipt: string } | null>(null);
  const [decide, setDecide] = useState<{ claim: ExpenseClaim; note: string; accountId: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [show, setShow] = useState<'open' | 'all'>('open');
  const shown = (list.data ?? []).filter((c) => show === 'all' || c.status === 'pending' || c.status === 'approved');

  async function submit() {
    if (!form) return;
    const amount = parseMoney(form.amount);
    if (!amount || amount <= 0) return toast('Enter the amount', 'error');
    if (!form.description.trim()) return toast('What was it for?', 'error');
    setBusy('save');
    try {
      await api('/expense-claims', { body: { businessId: businesses.data?.[0]?.id, date: form.date, category: form.category, amount, description: form.description.trim(), receipt: form.receipt } });
      toast('Claim sent for approval');
      setForm(null);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function act(kind: 'approved' | 'rejected' | 'pay') {
    if (!decide) return;
    setBusy(kind);
    try {
      if (kind === 'pay') await api(`/expense-claims/${decide.claim.id}/pay`, { body: { accountId: decide.accountId || null } });
      else await api(`/expense-claims/${decide.claim.id}/decide`, { body: { decision: kind, note: decide.note, pay: kind === 'approved' && can('finance.manage'), accountId: decide.accountId || null } });
      toast(kind === 'rejected' ? 'Claim rejected' : 'Claim paid');
      setDecide(null);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      {can('expenses.claim') && <Btn icon="add" title="Claim an expense" onPress={() => setForm({ date: todayStr(), category: 'Fuel & transport', amount: '', description: '', receipt: '' })} />}
      <Chips
        value={show}
        onChange={setShow}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'all', label: 'All' },
        ]}
      />
      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={list.reload}>
        {shown.length === 0 ? (
          <Empty icon="receipt-outline" title="No claims" hint="Spent your own money on fuel, supplies or a client lunch? Claim it here with a photo of the receipt." />
        ) : (
          shown.map((c) => {
            const canDecide = can('approvals.decide') && c.status === 'pending' && (c.claimedBy !== user?.id || user?.role === 'owner');
            const canPay = can('finance.manage') && c.status === 'approved';
            return (
              <Card key={c.id} label={`Claim ${c.number}`} onPress={canDecide || canPay ? () => setDecide({ claim: c, note: '', accountId: '' }) : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '700' }}>
                      {c.claimedByName} · {c.category}
                    </Txt>
                    <Txt v="small" numberOfLines={2}>
                      {c.number} · {fd(c.date)} · {c.description}
                    </Txt>
                    {!!c.decisionNote && <Txt v="small">“{c.decisionNote}”</Txt>}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Txt style={{ fontWeight: '800' }}>{fm(c.amount)}</Txt>
                    <Badge status={TONE[c.status]} label={LABEL[c.status]} />
                  </View>
                </Row>
                {(canDecide || canPay) && <Txt v="small">Tap to {canDecide ? 'approve or reject' : 'pay'}</Txt>}
              </Card>
            );
          })
        )}
      </Loader>
      <Sheet visible={!!form} title="Claim an expense" onClose={() => setForm(null)}>
        <Field label="Amount" money value={form?.amount ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, amount: v })} />
        <Chips value={form?.category ?? ''} onChange={(v) => setForm((f) => f && { ...f, category: v })} options={EXPENSE_CATEGORIES.filter((x) => x !== 'Owner withdrawal' && x !== 'Salaries').map((x) => ({ value: x, label: x }))} />
        <Field label="What was it for?" value={form?.description ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, description: v })} placeholder="e.g. Rickshaw to client site" />
        <DateField label="Date spent" value={form?.date ?? todayStr()} onChange={(v) => setForm((f) => f && { ...f, date: v })} />
        {!!form?.receipt && <Image source={{ uri: form.receipt }} style={{ width: '100%', height: 140, borderRadius: 10 }} resizeMode="contain" accessibilityLabel="Receipt photo" />}
        <Btn
          kind="secondary"
          icon="camera-outline"
          title={form?.receipt ? 'Replace receipt photo' : 'Attach receipt photo'}
          onPress={async () => {
            const img = await pickImage();
            if (img) setForm((f) => f && { ...f, receipt: img });
          }}
        />
        {!!form?.receipt && (
          <Btn
            kind="ghost"
            icon="sparkles-outline"
            title="Read the receipt (AI)"
            loading={busy === 'read'}
            onPress={async () => {
              if (!form) return;
              setBusy('read');
              try {
                const b = await api<{ supplier: string; date: string; total: number; lines: { name: string }[] }>('/ai/scan-bill', { body: { image: form.receipt } });
                setForm((f) => f && { ...f, amount: b.total ? String(b.total) : f.amount, date: b.date || f.date, description: f.description || [b.supplier, b.lines.map((l) => l.name).slice(0, 3).join(', ')].filter(Boolean).join(' · ') });
                toast('Receipt read. Check the amount.');
              } catch (e: any) {
                toast(e.message, 'error');
              } finally {
                setBusy('');
              }
            }}
          />
        )}
        <Btn title="Send for approval" onPress={submit} loading={busy === 'save'} />
      </Sheet>
      <Sheet visible={!!decide} title={decide ? `${decide.claim.number} · ${decide.claim.claimedByName}` : ''} onClose={() => setDecide(null)}>
        {decide && (
          <>
            <KV k={decide.claim.category} v={fm(decide.claim.amount)} bold />
            <Txt v="sub">{decide.claim.description}</Txt>
            {!decide.claim.hasReceipt && <Txt v="small">No receipt attached.</Txt>}
            {can('finance.manage') && <AccountSelect label="Pay from" accounts={accounts.data ?? []} value={decide.accountId} onChange={(id) => setDecide({ ...decide, accountId: id })} />}
            {decide.claim.status === 'pending' ? (
              <>
                <Field label="Note (optional)" value={decide.note} onChangeText={(v) => setDecide({ ...decide, note: v })} />
                <Row gap={10}>
                  <Btn style={{ flex: 1 }} kind="danger" title="Reject" onPress={() => act('rejected')} loading={busy === 'rejected'} />
                  <Btn style={{ flex: 2 }} icon="checkmark" title={can('finance.manage') ? 'Approve & pay' : 'Approve'} onPress={() => act('approved')} loading={busy === 'approved'} />
                </Row>
              </>
            ) : (
              <Btn icon="cash-outline" title="Pay now" onPress={() => act('pay')} loading={busy === 'pay'} />
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}
