import { useState } from 'react';
import { View } from 'react-native';
import { AccountSelect } from '@/components/money';
import { Badge, Btn, Card, Chips, DateField, Empty, Field, KV, Loader, Row, Screen, Select, Sheet, Txt, addDays, confirm, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { CHEQUE_STATUS_LABELS, parseMoney, type BusinessProfile, type Cheque, type Client, type MoneyAccount, type Supplier } from '@/lib/shared';
import { useWorkspace } from '@/lib/workspace';

type Dir = 'in' | 'out';
const TONE: Record<string, string> = { pending: 'unpaid', deposited: 'partially_paid', cleared: 'paid', bounced: 'overdue', cancelled: 'cancelled' };

interface Form {
  direction: Dir;
  number: string;
  bank: string;
  party: string;
  clientId: string | null;
  supplierId: string | null;
  amount: string;
  chequeDate: string;
  accountId: string;
  notes: string;
}

/** Cheques received and issued: post-dated cheques, deposits, clearing and bounces. */
export default function Cheques() {
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { t } = useWorkspace();
  const [dir, setDir] = useState<Dir>('in');
  const [show, setShow] = useState<'open' | ''>('open');
  const list = useApi<Cheque[]>(`/cheques?direction=${dir}${show ? `&status=${show}` : ''}`);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const clients = useApi<Client[]>('/clients?limit=100');
  const suppliers = useApi<Supplier[]>('/suppliers');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const [form, setForm] = useState<Form | null>(null);
  const [act, setAct] = useState<{ cheque: Cheque; accountId: string } | null>(null);
  const [busy, setBusy] = useState('');
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const total = (list.data ?? []).filter((c) => c.status === 'pending' || c.status === 'deposited').reduce((s, c) => s + c.amount, 0);

  async function save() {
    if (!form) return;
    const amount = parseMoney(form.amount);
    if (!form.number.trim()) return toast('Enter the cheque number', 'error');
    if (!amount || amount <= 0) return toast('Enter the amount', 'error');
    const businessId = businesses.data?.[0]?.id;
    if (!businessId) return;
    setBusy('save');
    try {
      await api('/cheques', { body: { businessId, direction: form.direction, number: form.number.trim(), bank: form.bank.trim(), party: form.party.trim(), clientId: form.clientId, supplierId: form.supplierId, amount, chequeDate: form.chequeDate, accountId: form.accountId || null, notes: form.notes.trim() } });
      toast('Cheque saved');
      setForm(null);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function move(c: Cheque, status: 'deposited' | 'cleared' | 'bounced' | 'cancelled', accountId?: string) {
    if ((status === 'bounced' || status === 'cancelled') && !(await confirm(status === 'bounced' ? 'Cheque bounced?' : 'Cancel cheque?', status === 'bounced' && c.paymentId ? 'The payment it paid is cancelled and the invoices are due again.' : 'It stays in the list for your records.', status === 'bounced' ? 'Mark bounced' : 'Cancel cheque'))) return;
    setBusy(c.id + status);
    try {
      await api(`/cheques/${c.id}/status`, { body: { status, accountId: accountId || undefined } });
      toast(`Cheque ${CHEQUE_STATUS_LABELS[status].toLowerCase()}${status === 'cleared' && c.direction === 'in' && c.clientId && !c.paymentId ? ' · payment recorded' : ''}`);
      setAct(null);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      <Chips<Dir>
        value={dir}
        onChange={setDir}
        options={[
          { value: 'in', label: 'Received' },
          { value: 'out', label: 'Issued' },
        ]}
      />
      <Card>
        <Txt v="small">{dir === 'in' ? 'Cheques in hand, not cleared yet' : 'Issued cheques not cleared yet'}</Txt>
        <Txt style={{ fontWeight: '800', fontSize: 22, color: dir === 'in' ? th.success : th.danger }}>{fm(total)}</Txt>
      </Card>
      <Row gap={8}>
        <View style={{ flex: 1 }}>
          <Chips
            value={show}
            onChange={setShow}
            options={[
              { value: 'open', label: 'Open' },
              { value: '', label: 'All' },
            ]}
          />
        </View>
        {can('finance.manage') && <Btn small icon="add" title="Add cheque" onPress={() => setForm({ direction: dir, number: '', bank: '', party: '', clientId: null, supplierId: null, amount: '', chequeDate: todayStr(), accountId: '', notes: '' })} />}
      </Row>
      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={list.reload}>
        {(list.data ?? []).length === 0 ? (
          <Empty icon="card-outline" title="No cheques here" hint={dir === 'in' ? 'Record post-dated cheques from customers so you know when to deposit them.' : 'Record cheques you give suppliers so the money is planned for.'} />
        ) : (
          list.data!.map((c) => {
            const due = (c.status === 'pending' || c.status === 'deposited') && c.chequeDate <= todayStr();
            return (
              <Card key={c.id}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt style={{ fontWeight: '700' }}>{c.party}</Txt>
                    <Txt v="small">
                      #{c.number}
                      {c.bank ? ` · ${c.bank}` : ''} · dated {fd(c.chequeDate)}
                    </Txt>
                    {due && c.status === 'pending' && <Txt v="small" color={th.warn}>Ready to deposit</Txt>}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Txt style={{ fontWeight: '800' }}>{fm(c.amount, c)}</Txt>
                    <Badge status={TONE[c.status]} label={CHEQUE_STATUS_LABELS[c.status]} />
                  </View>
                </Row>
                {can('finance.manage') && (c.status === 'pending' || c.status === 'deposited' || c.status === 'bounced') && (
                  <Row gap={8} style={{ marginTop: 8 }}>
                    {c.status !== 'deposited' && <Btn style={{ flex: 1 }} small kind="secondary" title="Deposited" onPress={() => move(c, 'deposited')} loading={busy === c.id + 'deposited'} />}
                    {c.status !== 'bounced' && <Btn style={{ flex: 1 }} small title="Cleared" onPress={() => (c.direction === 'in' && c.clientId && !c.paymentId ? setAct({ cheque: c, accountId: c.accountId ?? '' }) : move(c, 'cleared'))} />}
                    {c.status !== 'bounced' && <Btn style={{ flex: 1 }} small kind="danger" title={c.status === 'pending' ? 'Cancel' : 'Bounced'} onPress={() => move(c, c.status === 'pending' ? 'cancelled' : 'bounced')} />}
                  </Row>
                )}
              </Card>
            );
          })
        )}
      </Loader>

      <Sheet visible={!!form} title={form?.direction === 'in' ? 'Cheque received' : 'Cheque issued'} onClose={() => setForm(null)}>
        {form?.direction === 'in' ? (
          <Select<Client>
            label={`From (${t('client').toLowerCase()})`}
            value={form.party}
            placeholder={`Choose a ${t('client').toLowerCase()}`}
            items={clients.data ?? []}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            onSelect={(c) => set({ clientId: c.id, party: c.name })}
            onAdd={(typed) => set({ clientId: null, party: typed })}
            addLabel="Someone else"
          />
        ) : (
          <Select<Supplier>
            label="To"
            value={form?.party ?? ''}
            placeholder="Choose a supplier"
            items={suppliers.data ?? []}
            getKey={(s) => s.id}
            getLabel={(s) => s.name}
            onSelect={(s) => set({ supplierId: s.id, party: s.name })}
            onAdd={(typed) => set({ supplierId: null, party: typed })}
            addLabel="Someone else"
          />
        )}
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Cheque no." value={form?.number ?? ''} onChangeText={(v) => set({ number: v })} keyboardType="number-pad" />
          <Field style={{ flex: 1 }} label="Bank" value={form?.bank ?? ''} onChangeText={(v) => set({ bank: v })} placeholder="HBL, MCB…" />
        </Row>
        <Field label="Amount" money value={form?.amount ?? ''} onChangeText={(v) => set({ amount: v })} />
        <DateField label="Date on the cheque" value={form?.chequeDate ?? todayStr()} onChange={(v) => set({ chequeDate: v })} quick={[{ label: 'Today', value: todayStr() }, { label: '+15 days', value: addDays(todayStr(), 15) }, { label: '+30 days', value: addDays(todayStr(), 30) }]} />
        <AccountSelect label={form?.direction === 'in' ? 'Deposit into' : 'Drawn on'} accounts={(accounts.data ?? []).filter((a) => a.type === 'bank')} value={form?.accountId ?? ''} onChange={(id) => set({ accountId: id })} />
        <Field label="Notes (optional)" value={form?.notes ?? ''} onChangeText={(v) => set({ notes: v })} />
        <Btn title="Save cheque" onPress={save} loading={busy === 'save'} />
      </Sheet>

      <Sheet visible={!!act} title="Cheque cleared" onClose={() => setAct(null)}>
        {act && (
          <>
            <KV k={act.cheque.party} v={fm(act.cheque.amount, act.cheque)} bold />
            <Txt v="sub">A payment is recorded for {act.cheque.party} and set against their oldest unpaid {t('invoices').toLowerCase()}.</Txt>
            <AccountSelect label="Money arrived in" accounts={accounts.data ?? []} value={act.accountId} onChange={(id) => setAct({ ...act, accountId: id })} />
            <Btn title="Record payment" onPress={() => move(act.cheque, 'cleared', act.accountId)} loading={busy === act.cheque.id + 'cleared'} />
          </>
        )}
      </Sheet>
    </Screen>
  );
}
