import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { LineEditor, toEditLines, type EditLine } from '@/components/line-editor';
import { Badge, Btn, Card, DateField, Field, KV, Loading, Row, Screen, Section, Txt, confirm, fd, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { qtyToString, type BusinessProfile, type PurchaseRequest } from '@/lib/shared';

/** A purchase request (demand): raise it, approve or reject it, then order it. */
export default function RequestScreen() {
  const { id, reorder } = useLocalSearchParams<{ id: string; reorder?: string }>();
  const isNew = id === 'new';
  const toast = useToast();
  const { user, can } = useAuth();
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const existing = useApi<PurchaseRequest>(isNew ? null : `/purchase-requests/${id}`);
  const low = useApi<{ itemId: string; name: string; unit: string; onHand: number; reorderLevel: number }[]>(isNew && reorder ? '/stock/reorder' : null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState('');
  const r = existing.data;
  const editable = isNew || (r?.status === 'pending' && (r.requestedBy === user?.id || can('purchases.approve')));

  // from Stock › Request what is low: enough of each to get back above its reorder level
  useEffect(() => {
    if (!low.data) return;
    setLines(low.data.map((x) => ({ itemId: x.itemId, name: x.name, unit: x.unit, unitPrice: 0, qty: Math.max(x.reorderLevel * 2 - x.onHand, 1000) })));
    setNotes('Restock items running low');
  }, [low.data]);

  useEffect(() => {
    if (!r) return;
    setLines(toEditLines(r.lines));
    setNeededBy(r.neededBy);
    setNotes(r.notes);
  }, [r]);

  async function save() {
    if (!lines.length) return toast('Add at least one item', 'error');
    const businessId = r?.businessId ?? businesses.data?.[0]?.id;
    if (!businessId) return toast('Add a business profile first', 'error');
    setBusy('save');
    try {
      const body = { businessId, neededBy, notes, lines: lines.map(({ maxQty: _m, orderLine: _o, ...l }) => l) };
      const saved = await api<PurchaseRequest>(isNew ? '/purchase-requests' : `/purchase-requests/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(isNew ? `Request ${saved.number} sent for approval` : 'Request updated');
      if (isNew) router.replace({ pathname: '/request/[id]', params: { id: saved.id } });
      else existing.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(decision);
    try {
      await api(`/purchase-requests/${id}/decide`, { body: { decision, note: decisionNote } });
      toast(decision === 'approved' ? 'Request approved' : 'Request rejected');
      existing.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!(await confirm('Delete request?', 'This request will be removed.', 'Delete'))) return;
    try {
      await api(`/purchase-requests/${id}`, { method: 'DELETE' });
      toast('Request deleted');
      router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  if (!isNew && !r)
    return (
      <Screen>
        <Loading />
      </Screen>
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Request items' : r!.number }} />
      {r && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="h">{r.number}</Txt>
            <Badge status={{ pending: 'draft', approved: 'paid', rejected: 'cancelled', ordered: 'unpaid' }[r.status]} label={r.status === 'pending' ? 'Waiting for approval' : r.status[0].toUpperCase() + r.status.slice(1)} />
          </Row>
          <KV k="Requested by" v={`${r.requestedByName} · ${fd(r.date)}`} />
          {!!r.decidedByName && <KV k={r.status === 'rejected' ? 'Rejected by' : 'Approved by'} v={`${r.decidedByName}${r.decisionNote ? ` · ${r.decisionNote}` : ''}`} />}
        </Card>
      )}

      <Section title="Items needed">
        {editable ? (
          <LineEditor lines={lines} onChange={setLines} prices={false} />
        ) : (
          <Card>
            {r!.lines.map((l, i) => (
              <KV key={i} k={l.name} v={`${qtyToString(l.qty)} ${l.unit}`} />
            ))}
          </Card>
        )}
      </Section>

      {editable ? (
        <>
          <DateField label="Needed by (optional)" value={neededBy} onChange={setNeededBy} quick={[{ label: 'Today', value: todayStr() }]} />
          <Field label="Why / where it is needed (optional)" value={notes} onChangeText={setNotes} multiline />
          <Btn icon="send-outline" title={isNew ? 'Send for approval' : 'Save changes'} onPress={save} loading={busy === 'save'} disabled={!!busy} />
        </>
      ) : (
        !!r?.notes && <Txt v="sub">{r.notes}</Txt>
      )}

      {r?.status === 'pending' && can('purchases.approve') && (
        <Section title="Decision">
          <Field label="Note (optional)" value={decisionNote} onChangeText={setDecisionNote} />
          <Row gap={10}>
            <Btn style={{ flex: 1 }} kind="danger" title="Reject" onPress={() => decide('rejected')} loading={busy === 'rejected'} disabled={!!busy} />
            <Btn style={{ flex: 2 }} icon="checkmark" title="Approve" onPress={() => decide('approved')} loading={busy === 'approved'} disabled={!!busy} />
          </Row>
        </Section>
      )}
      {r?.status === 'approved' && can('purchases.manage') && (
        <Btn icon="document-text-outline" title="Make purchase order" onPress={() => router.push({ pathname: '/order/[id]', params: { id: 'new', requestId: r.id } })} />
      )}
      {r?.status === 'ordered' && r.orderId && <Btn kind="secondary" icon="open-outline" title="Open purchase order" onPress={() => router.push({ pathname: '/order/[id]', params: { id: r.orderId! } })} />}
      {r && r.status !== 'ordered' && (r.requestedBy === user?.id || can('purchases.approve')) && <Btn kind="ghost" title="Delete request" onPress={remove} />}
      <View style={{ height: 20 }} />
    </Screen>
  );
}
