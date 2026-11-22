import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Btn, Card, Field, Row, Screen, Txt } from '@/components/ui';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/app-context';

const STARTERS = ['How is my business doing this month?', 'Who owes me the most?', 'Will I have enough cash next month?', 'What should I reorder?', 'Is mahine mera kharcha kahan zyada hua?'];

/** Ask questions about the business in plain words (English or Urdu). Needs a connection and AI set up. */
export default function Assistant() {
  const th = useTheme();
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string; error?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);

  async function ask(question = q) {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setQ('');
    setBusy(true);
    setChat((c) => [...c, { q: text, a: '' }]);
    try {
      const r = await api<{ answer: string }>('/ai/ask', { body: { question: text } });
      setChat((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, a: r.answer } : x)));
    } catch (e: any) {
      setChat((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, a: e.message, error: true } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={
      <Row style={{ alignItems: 'flex-end' }}>
        <Field style={{ flex: 1 }} label="Ask about your business" value={q} onChangeText={setQ} placeholder="Type, or tap the keyboard mic to speak" onSubmitEditing={() => ask()} returnKeyType="send" />
        <Btn small icon="send" title="Ask" onPress={() => ask()} loading={busy} disabled={q.trim().length < 2} />
      </Row>
    }>
      {chat.length === 0 && (
        <>
          <Txt v="sub">Answers come from your own figures: sales, money owed, cash, stock and budgets. The assistant can explain and suggest; it does not change records.</Txt>
          <View style={{ gap: 8 }}>
            {STARTERS.map((s) => (
              <Btn key={s} small kind="secondary" title={s} onPress={() => ask(s)} />
            ))}
          </View>
        </>
      )}
      {chat.map((m, i) => (
        <View key={i} style={{ gap: 6 }}>
          <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: th.primary, borderRadius: 14, padding: 10 }}>
            <Txt color={th.onPrimary}>{m.q}</Txt>
          </View>
          <Card style={{ maxWidth: '95%' }}>
            {m.a ? <Txt color={m.error ? th.danger : undefined}>{m.a}</Txt> : <Txt v="sub">Thinking…</Txt>}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
