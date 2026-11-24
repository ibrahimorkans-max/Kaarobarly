import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Btn, Card, Chips, Field, KV, Row, Screen, Section, Select, Txt, fd, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, parseMoney, type MoneyAccount } from '@/lib/shared';

interface Row_ {
  index: number;
  date: string;
  description: string;
  amount: number;
  match: { key: string; date: string; label: string; party: string } | null;
}
interface Preview {
  rows: Row_[];
  matched: number;
  unmatched: number;
  bookOnly: { key: string; date: string; label: string; party: string; amount: number }[];
}
interface Status {
  lastDate: string;
  matched: number;
  openLast90: number;
  openAmount: number;
}

/** Read dates like 2026-11-24, 24/11/2026, 24-11-26 or 24 Nov 2026. */
function parseDate(s: string): string | null {
  const t = s.trim().replace(/"/g, '');
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = Date.parse(t);
  if (!Number.isNaN(d)) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }
  return null;
}
const num = (s: string) => {
  const t = (s ?? '').replace(/["\s,]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!t) return 0;
  return parseMoney(t.replace(/^-/, '')) !== null ? (t.startsWith('-') ? -1 : 1) * (parseMoney(t.replace(/^-/, '')) ?? 0) : NaN;
};

/**
 * Pasted statement → rows. Columns are found from the header: date, description/narration,
 * amount, or debit/withdrawal and credit/deposit.
 */
function parseStatement(text: string): { rows: { date: string; description: string; amount: number }[]; skipped: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], skipped: 0 };
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = (l: string) => l.split(new RegExp(`${sep}(?=(?:[^"]*"[^"]*")*[^"]*$)`)).map((x) => x.trim());
  const head = split(lines[0]).map((h) => h.toLowerCase().replace(/"/g, ''));
  const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  let di = find('date');
  let ni = find('desc', 'narration', 'particular', 'detail', 'remark');
  let ai = find('amount');
  const dr = find('debit', 'withdraw', 'dr');
  const cr = find('credit', 'deposit', 'cr');
  const hasHeader = di >= 0;
  if (!hasHeader) [di, ni, ai] = [0, 1, 2];
  const rows: { date: string; description: string; amount: number }[] = [];
  let skipped = 0;
  for (const l of lines.slice(hasHeader ? 1 : 0)) {
    const c = split(l);
    const date = parseDate(c[di] ?? '');
    let amount = NaN;
    if (ai >= 0 && c[ai]) amount = num(c[ai]);
    else if (dr >= 0 || cr >= 0) amount = (cr >= 0 ? num(c[cr]) || 0 : 0) - (dr >= 0 ? Math.abs(num(c[dr]) || 0) : 0);
    if (!date || !amount || Number.isNaN(amount)) {
      skipped++;
      continue;
    }
    rows.push({ date, description: (ni >= 0 ? c[ni] : '').replace(/"/g, '').slice(0, 300), amount });
  }
  return { rows, skipped };
}

/** Match a bank or wallet statement against what was recorded; add what was missed (charges, profit). */
export default function ReconcileScreen() {
  const th = useTheme();
  const toast = useToast();
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const [accountId, setAccountId] = useState('');
  const status = useApi<Status>(accountId ? `/reconcile/status/${accountId}` : null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [add, setAdd] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const account = (accounts.data ?? []).find((a) => a.id === accountId);
  const m = (v: number) => fm(v, account ? { currency: account.currency, currencyPrecision: undefined } : undefined);

  async function check() {
    const { rows, skipped } = parseStatement(text);
    if (!rows.length) return toast('No rows found. Paste the statement with a header row: Date, Description, Amount (or Debit, Credit).', 'error');
    setBusy(true);
    try {
      const p = await api<Preview>('/reconcile/preview', { body: { accountId, rows } });
      setPreview(p);
      setAdd({});
      if (skipped) toast(`${skipped} lines could not be read and were skipped`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview) return;
    setBusy(true);
    try {
      await api('/reconcile/confirm', {
        body: {
          accountId,
          matches: preview.rows.filter((r) => r.match).map((r) => ({ key: r.match!.key, date: r.date, description: r.description, amount: r.amount })),
          add: preview.rows.filter((r) => !r.match && add[r.index]).map((r) => ({ date: r.date, description: r.description, amount: r.amount, category: add[r.index] })),
        },
      });
      toast('Reconciled');
      setPreview(null);
      setText('');
      status.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Bank reconciliation' }} />
      <Select<MoneyAccount> label="Account" placeholder="Choose a bank or wallet" value={account?.name ?? ''} items={(accounts.data ?? []).filter((a) => a.type !== 'cash')} getKey={(a) => a.id} getLabel={(a) => a.name} getSub={(a) => a.type} onSelect={(a) => (setAccountId(a.id), setPreview(null))} />
      {status.data && (
        <Card>
          <KV k="Last reconciled up to" v={status.data.lastDate ? fd(status.data.lastDate) : 'Never'} />
          <KV k="Not yet matched (last 90 days)" v={`${status.data.openLast90} entries`} />
        </Card>
      )}
      {!!accountId && !preview && (
        <>
          <Field label="Paste the statement" value={text} onChangeText={setText} multiline style={{ minHeight: 160 } as any} placeholder={'Date, Description, Amount\n24/11/2026, IBFT FROM ALI, 25000\n25/11/2026, SMS CHARGES, -150'} autoCapitalize="none" />
          <Txt v="small">Copy the rows from your bank's Excel or CSV download (with the header row) and paste them here. Debit/Credit columns work too.</Txt>
          <Btn icon="git-merge-outline" title="Match" onPress={check} loading={busy} disabled={!text.trim()} />
        </>
      )}
      {preview && (
        <>
          <Card>
            <KV k="Matched" v={String(preview.matched)} color={th.success} bold />
            <KV k="On the statement only" v={String(preview.unmatched)} color={preview.unmatched ? th.warn : undefined} />
            <KV k="In your records only" v={String(preview.bookOnly.length)} color={preview.bookOnly.length ? th.warn : undefined} />
          </Card>
          <Section title="Statement">
            {preview.rows.map((r) => (
              <Card key={r.index} style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Ionicons name={r.match ? 'checkmark-circle' : 'help-circle-outline'} size={20} color={r.match ? th.success : th.warn} />
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                      {r.description || 'No description'}
                    </Txt>
                    <Txt v="small">{fd(r.date)}{r.match ? ` · ${r.match.label}${r.match.party ? ` · ${r.match.party}` : ''}` : ' · not in your records'}</Txt>
                  </View>
                  <Txt style={{ fontWeight: '800', color: r.amount > 0 ? th.success : th.danger }}>{m(r.amount)}</Txt>
                </Row>
                {!r.match && (
                  <>
                    <Txt v="small">Add it as:</Txt>
                    <Chips value={add[r.index] ?? ''} onChange={(v) => setAdd((a) => ({ ...a, [r.index]: v }))} options={[{ value: '', label: 'Skip' }, ...(r.amount > 0 ? [...INCOME_CATEGORIES] : [...EXPENSE_CATEGORIES]).map((c) => ({ value: c, label: c }))]} />
                  </>
                )}
              </Card>
            ))}
          </Section>
          {preview.bookOnly.length > 0 && (
            <Section title="In your records, not on the statement">
              {preview.bookOnly.map((b) => (
                <Pressable key={b.key}>
                  <Card>
                    <KV k={`${fd(b.date)} · ${b.label}${b.party ? ` · ${b.party}` : ''}`} v={m(b.amount)} />
                  </Card>
                </Pressable>
              ))}
              <Txt v="small">Check these: a cheque not yet cleared, or an entry in the wrong account.</Txt>
            </Section>
          )}
          <Row gap={10}>
            <Btn style={{ flex: 1 }} kind="ghost" title="Back" onPress={() => setPreview(null)} />
            <Btn style={{ flex: 2 }} icon="checkmark-done-outline" title="Confirm" onPress={confirm} loading={busy} />
          </Row>
        </>
      )}
    </Screen>
  );
}
