import { useState } from 'react';
import { AccountSelect } from '@/components/money';
import { Btn, Card, Chips, DateField, Field, KV, Notice, Screen, Select, Txt, fd } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useToast } from '@/lib/app-context';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, moneyToInput, parseMoney, type BusinessProfile, type Client, type MoneyAccount, type PaymentMethod } from '@/lib/shared';

interface Parsed {
  kind: 'payment' | 'expense' | 'income' | 'none';
  amount: number;
  party: string;
  category: string;
  method: PaymentMethod;
  date: string;
  note: string;
}
const EXAMPLES = ['Received 25,000 from Rehman Rice Mills by bank', 'Paid 3,500 for petrol', 'Bijli ka bill 12000 cash diya', 'Ali se 5000 mile Easypaisa par'];

/**
 * Say it or type it: one sentence becomes a payment, expense or income for you to check and save.
 * Speak with the microphone on your phone keyboard. Needs a connection and a plan with AI.
 */
export default function QuickEntry() {
  const toast = useToast();
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const clients = useApi<Client[]>('/clients?limit=100');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const [text, setText] = useState('');
  const [p, setP] = useState<(Parsed & { amountText: string; clientId: string; accountId: string }) | null>(null);
  const [busy, setBusy] = useState('');
  const biz = businesses.data?.[0];

  async function understand(sentence = text) {
    if (sentence.trim().length < 3) return;
    setBusy('parse');
    try {
      const r = await api<Parsed>('/ai/parse-entry', { body: { text: sentence.trim() } });
      if (r.kind === 'none') {
        setP(null);
        return toast('That does not look like money in or out. Try: “Paid 3,500 for petrol”.', 'error');
      }
      const match = (clients.data ?? []).find((c) => c.name.toLowerCase() === r.party.toLowerCase()) ?? (clients.data ?? []).find((c) => r.party && c.name.toLowerCase().includes(r.party.toLowerCase()));
      setP({ ...r, amountText: moneyToInput(Math.round(r.amount * 10 ** (biz?.currencyPrecision ?? 2)), biz?.currencyPrecision ?? 2), clientId: match?.id ?? '', accountId: '' });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function save() {
    if (!p || !biz) return;
    const amount = parseMoney(p.amountText, biz.currencyPrecision);
    if (!amount || amount <= 0) return toast('Check the amount', 'error');
    setBusy('save');
    try {
      if (p.kind === 'payment') {
        if (!p.clientId) throw new Error('Choose who paid');
        await api('/payments', { body: { clientId: p.clientId, businessId: biz.id, amount, date: p.date, method: p.method, notes: p.note, autoAllocate: true, accountId: p.accountId || null } });
        toast('Payment recorded against the oldest unpaid invoices');
      } else {
        await api('/finance/entries', { body: { businessId: biz.id, type: p.kind, category: p.category || (p.kind === 'expense' ? 'Other expense' : 'Other income'), amount, date: p.date, method: p.method, party: p.party, notes: p.note, accountId: p.accountId || null } });
        toast(p.kind === 'expense' ? 'Money out saved' : 'Money in saved');
      }
      setP(null);
      setText('');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const client = (clients.data ?? []).find((c) => c.id === p?.clientId);
  return (
    <Screen>
      <Txt v="sub">Type or speak one sentence (tap the mic on your keyboard). Kaarobarly fills in the record; you check it and save.</Txt>
      <Field label="What happened?" value={text} onChangeText={setText} multiline placeholder="e.g. Received 25,000 from Rehman Rice Mills by bank" />
      <Btn icon="sparkles-outline" title="Understand" onPress={() => understand()} loading={busy === 'parse'} disabled={text.trim().length < 3} />
      {!p && (
        <Card>
          <Txt v="label">Try</Txt>
          {EXAMPLES.map((e) => (
            <Btn
              key={e}
              small
              kind="ghost"
              title={e}
              onPress={() => {
                setText(e);
                void understand(e);
              }}
            />
          ))}
        </Card>
      )}
      {p && (
        <Card style={{ gap: 10 }}>
          <Chips
            value={p.kind as 'payment' | 'expense' | 'income'}
            onChange={(v) => setP({ ...p, kind: v, category: '' })}
            options={[
              { value: 'payment', label: 'Payment from client' },
              { value: 'expense', label: 'Money out' },
              { value: 'income', label: 'Money in' },
            ]}
          />
          <Field label="Amount" money value={p.amountText} onChangeText={(v) => setP({ ...p, amountText: v })} />
          {p.kind === 'payment' ? (
            <Select<Client> label="From" value={client?.name ?? ''} placeholder={p.party ? `Not found: “${p.party}”` : 'Choose who paid'} items={clients.data ?? []} getKey={(c) => c.id} getLabel={(c) => c.name} onSelect={(c) => setP({ ...p, clientId: c.id })} />
          ) : (
            <>
              <Field label={p.kind === 'expense' ? 'Paid to (optional)' : 'From (optional)'} value={p.party} onChangeText={(v) => setP({ ...p, party: v })} />
              <Chips value={p.category} onChange={(v) => setP({ ...p, category: v })} options={(p.kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map((c) => ({ value: c, label: c }))} />
            </>
          )}
          <Chips value={p.method} onChange={(v) => setP({ ...p, method: v })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
          <AccountSelect accounts={accounts.data ?? []} value={p.accountId} onChange={(id) => setP({ ...p, accountId: id })} />
          <DateField label="Date" value={p.date} onChange={(v) => setP({ ...p, date: v })} />
          {!!p.note && <KV k="Note" v={p.note} />}
          <Notice kind="info">Check everything before saving. Dated {fd(p.date)}.</Notice>
          <Btn icon="checkmark" title="Save" onPress={save} loading={busy === 'save'} />
          <Btn kind="ghost" title="Start again" onPress={() => setP(null)} />
        </Card>
      )}
    </Screen>
  );
}
