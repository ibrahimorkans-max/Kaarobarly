import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BarcodeScanner } from '@/components/scanner';
import { Btn, Card, Chips, Field, IconBtn, KV, Row, Screen, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { POS_TENDER_LABELS, qtyToString, type Invoice, type PosShift } from '@/lib/shared';

type RefundTender = 'cash' | 'card' | 'jazzcash' | 'easypaisa' | 'bank_transfer';
const REFUND_TENDERS: RefundTender[] = ['cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer'];

/** Take goods back: find the sale by receipt number (or its QR), pick what comes back, refund. */
export default function ReturnsScreen() {
  const toast = useToast();
  const { can } = useAuth();
  const shiftQ = useApi<{ shift: PosShift | null }>('/pos/shift');
  const [number, setNumber] = useState('');
  const [scan, setScan] = useState(false);
  const [sale, setSale] = useState<Invoice | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [tender, setTender] = useState<RefundTender>('cash');
  const [busy, setBusy] = useState(false);

  async function find(n = number) {
    if (!n.trim()) return;
    try {
      const inv = await api<Invoice>(`/pos/sales/find?number=${encodeURIComponent(n.trim())}`);
      setSale(inv);
      setNumber(inv.number ?? n);
      setQty({});
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const lines = sale?.lines ?? [];
  const amount = lines.reduce((s, l, i) => s + Math.round(((qty[i] ?? 0) * l.unitPrice) / 1000), 0);
  const m = (v: number) => fm(v, sale);

  async function submit() {
    const shift = shiftQ.data?.shift;
    if (!shift) return toast('Open a shift first', 'error');
    if (!sale || amount <= 0) return toast('Choose what comes back', 'error');
    setBusy(true);
    try {
      const r = await api<{ refund: number }>('/pos/returns', {
        body: {
          shiftId: shift.id,
          invoiceId: sale.id,
          reason,
          refundTender: tender,
          lines: lines.map((l, i) => ({ serviceId: l.serviceId, name: l.name, unit: l.unit, unitPrice: l.unitPrice, qty: qty[i] ?? 0 })).filter((l) => l.qty > 0),
        },
      });
      toast(r.refund ? `Return saved. Give back ${m(r.refund)}.` : 'Return saved against the udhaar.');
      router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Returns' }} />
      {!can('pos.manage') && <Txt v="sub">Returns need a manager. Ask them to approve it on this phone.</Txt>}
      <Row style={{ alignItems: 'flex-end' }}>
        <Field style={{ flex: 1 }} label="Receipt number" value={number} onChangeText={setNumber} autoCapitalize="characters" onSubmitEditing={() => find()} />
        <IconBtn icon="qr-code-outline" label="Scan receipt" onPress={() => setScan(true)} />
        <Btn small title="Find" onPress={() => find()} />
      </Row>
      {sale && (
        <>
          <Card>
            <KV k="Sale" v={sale.number ?? ''} />
            <KV k="Customer" v={sale.clientName} />
            <KV k="Total" v={m(sale.total)} />
            {(sale.credited ?? 0) > 0 && <KV k="Already returned" v={m(sale.credited ?? 0)} />}
          </Card>
          {lines.map((l, i) => (
            <Row key={i} style={{ alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '700' }}>{l.name}</Txt>
                <Txt v="small">
                  Sold {qtyToString(l.qty)} × {m(l.unitPrice)}
                </Txt>
              </View>
              <IconBtn icon="remove" label={`Less ${l.name}`} onPress={() => setQty((q) => ({ ...q, [i]: Math.max(0, (q[i] ?? 0) - 1000) }))} />
              <Txt style={{ minWidth: 30, textAlign: 'center', fontWeight: '800' }}>{qtyToString(qty[i] ?? 0)}</Txt>
              <IconBtn icon="add" label={`More ${l.name}`} onPress={() => setQty((q) => ({ ...q, [i]: Math.min(l.qty, (q[i] ?? 0) + 1000) }))} />
            </Row>
          ))}
          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Damaged, wrong size…" />
          <Txt v="label">Refund by</Txt>
          <Chips value={tender} onChange={(v) => setTender(v as RefundTender)} options={REFUND_TENDERS.map((t) => ({ value: t, label: POS_TENDER_LABELS[t] }))} />
          <KV k="Value returned" v={m(amount)} bold />
          <Btn icon="return-down-back-outline" title="Save return" onPress={submit} loading={busy} disabled={amount <= 0 || !can('pos.manage')} />
        </>
      )}
      <BarcodeScanner
        visible={scan}
        onClose={() => setScan(false)}
        title="Scan the receipt QR"
        onCode={(c) => {
          setNumber(c);
          void find(c);
        }}
      />
    </Screen>
  );
}
