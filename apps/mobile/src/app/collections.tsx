import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Badge, Btn, Card, Chips, DateField, Empty, Field, Loader, Row, Screen, Sheet, Txt, addDays, fd, fm, todayStr } from '@/components/ui';
import { API_URL, api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { DEFAULT_REMINDER, REMINDER_CHANNEL_LABELS, fillTemplate, type BusinessProfile, type CollectionRow, type ReminderChannel } from '@/lib/shared';
import { lower, useWorkspace } from '@/lib/workspace';

const digits = (s: string) => {
  const d = s.replace(/[^\d]/g, '');
  // Pakistani numbers written 03xx… become 923xx… for WhatsApp
  return d.startsWith('0') ? `92${d.slice(1)}` : d;
};

/** Who owes money and how late, with one-tap reminders by WhatsApp, SMS or call. */
export default function Collections() {
  const th = useTheme();
  const toast = useToast();
  const { t } = useWorkspace();
  const { data, loading, error, reload, refreshing } = useApi<CollectionRow[]>('/collections');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const [filter, setFilter] = useState<'overdue' | 'all'>('overdue');
  const [log, setLog] = useState<{ row: CollectionRow; channel: ReminderChannel; note: string; promiseDate: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const b = businesses.data?.[0];
  const rows = (data ?? []).filter((r) => filter === 'all' || r.overdue > 0);
  const totalOverdue = (data ?? []).reduce((s, r) => s + r.overdue, 0);
  const totalOutstanding = (data ?? []).reduce((s, r) => s + r.outstanding, 0);

  const message = (r: CollectionRow) =>
    fillTemplate(b?.reminderTemplate || DEFAULT_REMINDER, {
      client: r.clientName,
      amount: fm(r.overdue || r.outstanding),
      invoices: r.invoices.map((i) => i.number).join(', '),
      due: r.daysOverdue > 0 ? ` (${r.daysOverdue} days overdue)` : '',
      business: b?.tradingName || b?.legalName || '',
      link: r.portalToken ? `See your statement: ${API_URL}/p/${r.portalToken}` : '',
    });

  async function send(r: CollectionRow, channel: ReminderChannel) {
    const text = encodeURIComponent(message(r));
    const phone = digits(r.whatsapp || r.phone);
    let url = '';
    if (channel === 'whatsapp') url = `https://wa.me/${phone}?text=${text}`;
    else if (channel === 'sms') url = `sms:${phone}${Platform.OS === 'ios' ? '&' : '?'}body=${text}`;
    else if (channel === 'email') url = `mailto:${r.email}?subject=${encodeURIComponent(`Payment reminder from ${b?.tradingName || b?.legalName || ''}`)}&body=${text}`;
    else if (channel === 'call') url = `tel:${phone}`;
    if ((channel !== 'email' && !phone) || (channel === 'email' && !r.email)) return toast(`No ${channel === 'email' ? 'email' : 'phone number'} saved for ${r.clientName}`, 'error');
    try {
      await Linking.openURL(url);
    } catch {
      return toast('Could not open that app on this device', 'error');
    }
    setLog({ row: r, channel, note: '', promiseDate: '' });
  }

  async function saveLog() {
    if (!log) return;
    setBusy(true);
    try {
      await api('/reminders', { body: { clientId: log.row.clientId, invoiceId: log.row.invoices[0]?.id ?? null, channel: log.channel, note: log.note, promiseDate: log.promiseDate } });
      toast('Reminder noted');
      setLog(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Row gap={10}>
        <Card style={{ flex: 1 }}>
          <Txt v="small">Overdue</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 18, color: th.danger }}>{fm(totalOverdue)}</Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt v="small">All unpaid</Txt>
          <Txt style={{ fontWeight: '800', fontSize: 18 }}>{fm(totalOutstanding)}</Txt>
        </Card>
      </Row>
      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'overdue', label: 'Overdue' },
          { value: 'all', label: 'Everyone who owes' },
        ]}
      />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {rows.length === 0 ? (
          <Empty icon="checkmark-done-outline" title={filter === 'overdue' ? 'Nothing overdue' : 'Nobody owes you money'} hint={`Unpaid ${lower(t('invoices'))} show here with a reminder button.`} />
        ) : (
          rows.map((r) => (
            <Card key={r.clientId} label={`${r.clientName} owes ${fm(r.outstanding)}`} onPress={() => router.push({ pathname: '/client/[id]', params: { id: r.clientId } })}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontWeight: '700' }}>{r.clientName}</Txt>
                  <Txt v="small" numberOfLines={1}>
                    {r.invoices.map((i) => i.number).join(', ')}
                  </Txt>
                  {r.lastReminder && (
                    <Txt v="small">
                      Reminded {fd(r.lastReminder.createdAt.slice(0, 10))} by {REMINDER_CHANNEL_LABELS[r.lastReminder.channel]}
                      {r.lastReminder.promiseDate ? ` · promised ${fd(r.lastReminder.promiseDate)}` : ''}
                    </Txt>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt style={{ fontWeight: '800' }}>{fm(r.outstanding)}</Txt>
                  {r.daysOverdue > 0 ? <Badge status="overdue" label={`${r.daysOverdue} days late`} /> : <Badge status="unpaid" label="Not due yet" />}
                </View>
              </Row>
              <Row gap={8} style={{ marginTop: 8 }}>
                <Btn style={{ flex: 1 }} small icon="logo-whatsapp" title="WhatsApp" onPress={() => send(r, 'whatsapp')} />
                <Btn style={{ flex: 1 }} small kind="secondary" icon="chatbubble-outline" title="SMS" onPress={() => send(r, 'sms')} />
                <Btn style={{ flex: 1 }} small kind="secondary" icon="call-outline" title="Call" onPress={() => send(r, 'call')} />
              </Row>
            </Card>
          ))
        )}
      </Loader>
      <Sheet visible={!!log} title={`${log ? REMINDER_CHANNEL_LABELS[log.channel] : ''} · ${log?.row.clientName ?? ''}`} onClose={() => setLog(null)}>
        <Txt v="sub">Note what was agreed so the team knows (optional).</Txt>
        <Field label="Note" value={log?.note ?? ''} onChangeText={(v) => setLog((l) => l && { ...l, note: v })} placeholder="e.g. will pay half on Friday" />
        <DateField label="Promised to pay by (optional)" value={log?.promiseDate ?? ''} onChange={(v) => setLog((l) => l && { ...l, promiseDate: v })} quick={[{ label: 'Tomorrow', value: addDays(todayStr(), 1) }, { label: 'In a week', value: addDays(todayStr(), 7) }]} />
        <Btn title="Save" onPress={saveLog} loading={busy} />
        <Btn kind="ghost" title="Skip" onPress={() => setLog(null)} />
      </Sheet>
    </Screen>
  );
}
