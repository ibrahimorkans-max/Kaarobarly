import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { BarcodeScanner } from '@/components/scanner';
import { Badge, Btn, Card, Chips, Empty, Field, IconBtn, KV, Loader, Notice, Row, Screen, SearchBar, Select, Sheet, Txt, dt, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { newKey } from '@/lib/invoice-draft';
import { posReceiptHtml, type Paper } from '@/lib/pdf';
import { POS_TENDERS, POS_TENDER_LABELS, computeInvoice, moneyToInput, parseMoney, qtyToString, type AppliedPromo, type BusinessProfile, type Client, type HeldBill, type Invoice, type LoyaltyAccount, type Payment, type PosLine, type PosShift, type PosTender, type Service, type TableOrder, type ZReport } from '@/lib/shared';
import { useWorkspace } from '@/lib/workspace';

interface CartLine extends PosLine {
  key: string;
  /** a line of a table order: its index there, and whether it is left for a later bill (split) */
  orderIdx?: number;
  later?: boolean;
}
interface Preview {
  lineDiscounts: number[];
  billDiscount: number;
  applied: AppliedPromo[];
  memberDiscount: number;
  member: LoyaltyAccount | null;
  pointValue: number;
  minRedeem: number;
}
interface Tender {
  key: string;
  tender: PosTender;
  amount: string;
}

/** Shop-scale labels: 2 + item code, then 5 digits of weight in grams (EAN-13, prefixes 20–29). */
function scaleLabel(code: string): { itemCode: string; grams: number } | null {
  if (!/^2\d{12}$/.test(code)) return null;
  return { itemCode: code.slice(0, 7), grams: Number(code.slice(7, 12)) };
}

/** The counter: pick or scan items, take payment in any mix, print the receipt. Works offline. */
export function PosTerminal({ orderId }: { orderId?: string } = {}) {
  const th = useTheme();
  const toast = useToast();
  const { user, can } = useAuth();
  const { width } = useWindowDimensions();
  const shiftQ = useApi<{ shift: PosShift | null; report: ZReport | null }>('/pos/shift');
  const items = useApi<Service[]>('/services?limit=100');
  const clients = useApi<Client[]>('/clients?limit=100');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const held = useApi<HeldBill[]>('/pos/held');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [discount, setDiscount] = useState('');
  const [heldId, setHeldId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'' | 'cart' | 'pay' | 'held'>('');
  const [scan, setScan] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [cashGiven, setCashGiven] = useState('');
  const [busy, setBusy] = useState('');
  const [float, setFloat] = useState('');
  const [unknown, setUnknown] = useState('');
  const [done, setDone] = useState<{ invoice: Invoice; payments: Payment[]; change: number } | null>(null);
  const requestId = useRef(`pos-${newKey()}`);
  const { on } = useWorkspace();
  const [coupon, setCoupon] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [phone, setPhone] = useState('');
  const [redeem, setRedeem] = useState('');
  const [gifts, setGifts] = useState<{ code: string; amount: number }[]>([]);
  const [giftCode, setGiftCode] = useState('');
  const [serviceBp, setServiceBp] = useState(0);
  const [tip, setTip] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [order, setOrder] = useState<TableOrder | null>(null);

  // paying a table / takeaway / online order: load its lines into the bill
  useEffect(() => {
    if (!orderId) return;
    api<TableOrder>(`/orders/${orderId}`)
      .then((o) => {
        setOrder(o);
        setCart(o.lines.map((l, i) => ({ key: newKey(), serviceId: l.serviceId, name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, discountType: 'percent', discountValue: 0, taxRateBp: l.taxRateBp, orderIdx: i })));
        if (o.kind === 'dine_in') setServiceBp((b) => b);
        setSheet('cart');
      })
      .catch((e) => toast(e.message, 'error'));
  }, [orderId, toast]);

  const shift = shiftQ.data?.shift ?? null;
  const business = businesses.data?.find((b) => b.id === shift?.businessId) ?? businesses.data?.[0];
  const precision = business?.currencyPrecision ?? 2;
  const m = (v: number) => fm(v, business);
  const active = (items.data ?? []).filter((s) => s.status === 'active');
  const cats = [...new Set(active.map((s) => s.category).filter(Boolean))].slice(0, 12);
  const needle = q.trim().toLowerCase();
  const shown = active.filter((s) => (!cat || s.category === cat) && (!needle || `${s.name} ${s.sku} ${s.barcode}`.toLowerCase().includes(needle)));
  const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;

  // totals the same way the server will: item offers, then bill discounts, service charge and tip, then tax
  const lineTotal = (l: PosLine) => Math.round((l.qty * l.unitPrice) / 1000);
  const lineDisc = (l: PosLine) => Math.min(lineTotal(l), l.discountType === 'percent' ? Math.round((lineTotal(l) * l.discountValue) / 10_000) : l.discountValue);
  const paying = cart.filter((l) => !l.later);
  const priced = paying.map((l, i) => {
    const extra = preview?.lineDiscounts[i] ?? 0;
    return extra ? { ...l, discountType: 'fixed' as const, discountValue: Math.min(lineTotal(l), lineDisc(l) + extra) } : l;
  });
  const subtotal = paying.reduce((s, l) => s + lineTotal(l), 0);
  const itemOffers = priced.reduce((s, l, i) => s + lineDisc(l) - lineDisc(paying[i]), 0);
  const afterLines = priced.reduce((s, l) => s + lineTotal(l) - lineDisc(l), 0);
  const billDiscount = Math.min(discount.trim() ? (parseMoney(discount, precision) ?? 0) : 0, afterLines);
  const promoBill = preview?.billDiscount ?? 0;
  const memberOff = preview?.memberDiscount ?? 0;
  const member = preview?.member ?? null;
  const redeemPts = Math.max(0, Math.floor(Number(redeem) || 0));
  const pointsOff = redeemPts * (preview?.pointValue ?? 0);
  const giftOff = gifts.reduce((s, g) => s + g.amount, 0);
  const serviceCharge = Math.round((Math.max(afterLines - billDiscount - promoBill - memberOff, 0) * serviceBp) / 10_000);
  const tipAmt = tip.trim() ? (parseMoney(tip, precision) ?? 0) : 0;
  const allBillOff = Math.min(billDiscount + promoBill + memberOff + pointsOff + giftOff, afterLines + serviceCharge + tipAmt);
  const extraLines: PosLine[] = [
    ...(serviceCharge ? [{ serviceId: null, name: 'Service charge', qty: 1000, unit: '', unitPrice: serviceCharge, discountType: 'fixed' as const, discountValue: 0, taxRateBp: 0 }] : []),
    ...(tipAmt ? [{ serviceId: null, name: 'Tip', qty: 1000, unit: '', unitPrice: tipAmt, discountType: 'fixed' as const, discountValue: 0, taxRateBp: 0 }] : []),
  ];
  const totals = computeInvoice({ lines: [...priced, ...extraLines], overallDiscountType: 'fixed', overallDiscountValue: allBillOff, charges: [], taxInclusive: !!business?.taxInclusive, rounding: business?.rounding ?? 'none', precision });
  const total = totals.total;

  // live promotions, member discount and points value from the server rules (works offline too)
  const previewKey = JSON.stringify([paying.map((l) => [l.serviceId, l.qty, l.unitPrice]), clientId, coupon]);
  useEffect(() => {
    if (!paying.length || !shift) return setPreview(null);
    const t = setTimeout(() => {
      api<Preview>('/pos/preview', { body: { lines: paying.map(({ key: _k, orderIdx: _o, later: _l, ...l }) => l), clientId, coupon } })
        .then(setPreview)
        .catch((e) => {
          if (coupon) {
            toast(e.message, 'error');
            setCoupon('');
          }
        });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, !!shift]);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const tendered = tenders.reduce((s, x) => s + (parseMoney(x.amount || '0', precision) ?? 0), 0);
  const remaining = total - tendered;
  const cashTender = tenders.find((x) => x.tender === 'cash');
  const cashAmount = cashTender ? (parseMoney(cashTender.amount || '0', precision) ?? 0) : 0;
  const given = cashGiven.trim() ? (parseMoney(cashGiven, precision) ?? 0) : 0;
  const change = given > cashAmount ? given - cashAmount : 0;

  const add = useCallback((s: Service, qty = 1000) => {
    if (s.onHand !== undefined && s.onHand - qty < 0) toast(`${s.name}: only ${qtyToString(Math.max(s.onHand, 0))} in stock`, 'error');
    setCart((c) => {
      const i = c.findIndex((l) => l.serviceId === s.id && l.unitPrice === s.defaultPrice);
      if (i >= 0) return c.map((l, k) => (k === i ? { ...l, qty: l.qty + qty } : l));
      return [...c, { key: newKey(), serviceId: s.id, name: s.name, qty, unit: s.unit, unitPrice: s.defaultPrice, discountType: 'percent', discountValue: s.defaultDiscountBp, taxRateBp: s.taxRateBp }];
    });
  }, [toast]);

  const onCode = (code: string) => {
    const exact = active.find((s) => s.barcode === code || s.sku === code);
    if (exact) return add(exact);
    const scale = scaleLabel(code);
    const weighed = scale && active.find((s) => s.barcode === scale.itemCode || s.sku === scale.itemCode);
    if (weighed && scale) return add(weighed, scale.grams);
    toast(`No item has barcode ${code}`, 'error');
    setUnknown(code);
  };

  const setQty = (key: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, qty } : l))));
  const reset = () => {
    setCart([]);
    setClientId(null);
    setDiscount('');
    setHeldId(null);
    setTenders([]);
    setCashGiven('');
    setCoupon('');
    setCouponInput('');
    setRedeem('');
    setGifts([]);
    setTip('');
    setServiceBp(0);
    setPreview(null);
    setOrder(null);
    requestId.current = `pos-${newKey()}`;
    if (orderId) router.setParams({ orderId: '' });
  };

  async function findMember() {
    try {
      const a = await api<LoyaltyAccount>(`/loyalty/find?phone=${encodeURIComponent(phone)}`);
      setClientId(a.clientId);
      toast(`${a.name}: ${a.points} points${a.tier ? ` · ${a.tier.name}` : ''}`);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function addGift() {
    try {
      const g = await api<{ code: string; balance: number; status: string }>(`/gift-cards/${encodeURIComponent(giftCode.trim().toUpperCase())}`);
      if (g.status !== 'active' || g.balance <= 0) return toast(`Gift card ${g.code} is ${g.status}`, 'error');
      const due = Math.max(total, 0);
      setGifts((x) => [...x.filter((y) => y.code !== g.code), { code: g.code, amount: Math.min(g.balance, due) }]);
      setGiftCode('');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function openShift() {
    if (!business) return;
    const amount = float.trim() ? parseMoney(float, precision) : 0;
    if (amount === null || amount < 0) return toast('Enter the cash in the drawer', 'error');
    setBusy('open');
    try {
      await api('/pos/shifts', { body: { businessId: business.id, openingFloat: amount } });
      setFloat('');
      shiftQ.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    if (sheet === 'pay' && tenders.length === 1 && tenders[0].tender === 'cash') setTenders([{ ...tenders[0], amount: moneyToInput(Math.max(total, 0), precision) }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  function startPay() {
    if (!paying.length) return toast('Add items first', 'error');
    setTenders([{ key: newKey(), tender: 'cash', amount: moneyToInput(total, precision) }]);
    setCashGiven('');
    setSheet('pay');
  }

  async function complete() {
    if (!shift) return;
    if (remaining !== 0) return toast(remaining > 0 ? `${m(remaining)} still to pay` : `Payments are ${m(-remaining)} more than the bill`, 'error');
    if (given && given < cashAmount) return toast('Cash given is less than the cash part', 'error');
    setBusy('pay');
    try {
      const r = await api<{ invoice: Invoice; change: number; pointsEarned?: number }>('/pos/sales', {
        body: {
          shiftId: shift.id,
          clientId,
          heldId,
          lines: paying.map(({ key: _k, orderIdx: _o, later: _l, ...l }) => l),
          billDiscountType: 'fixed',
          billDiscountValue: billDiscount,
          coupon,
          redeemPoints: redeemPts,
          giftCards: gifts,
          serviceChargeBp: serviceBp,
          tip: tipAmt,
          tableOrderId: order?.id ?? null,
          settleLines: order ? paying.map((l) => l.orderIdx).filter((x): x is number => x !== undefined) : undefined,
          tenders: tenders.map((x) => ({ tender: x.tender, amount: parseMoney(x.amount || '0', precision) ?? 0 })).filter((x) => x.amount > 0),
          cashGiven: given || undefined,
          clientRequestId: requestId.current,
        },
      });
      const detail = await api<{ payments: Payment[] }>(`/invoices/${r.invoice.id}`).catch(() => ({ payments: [] as Payment[] }));
      setDone({ invoice: r.invoice, payments: detail.payments, change: r.change });
      if (r.pointsEarned) toast(`${r.pointsEarned} loyalty points earned`);
      setSheet('');
      reset();
      shiftQ.reload();
      items.reload();
      held.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function hold() {
    if (!cart.length) return;
    try {
      await api('/pos/held', { body: { clientId, billDiscount, lines: cart.map(({ key: _k, ...l }) => l) } });
      toast('Bill parked');
      reset();
      setSheet('');
      held.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  function recall(h: HeldBill) {
    setCart(h.lines.map((l) => ({ ...l, key: newKey() })));
    setClientId(h.clientId);
    setDiscount(h.billDiscount ? moneyToInput(h.billDiscount, precision) : '');
    setHeldId(h.id);
    setSheet('cart');
  }

  const buildReceipt = useCallback((paper: Paper) => (done && business ? posReceiptHtml({ invoice: done.invoice, payments: done.payments, business, change: done.change, cashier: user?.name }, paper) : ''), [done, business, user]);
  const client = (clients.data ?? []).find((c) => c.id === clientId);

  if (!can('pos.sell'))
    return (
      <Screen>
        <Empty icon="lock-closed-outline" title="No access to the counter" hint="Ask the owner to give you the cashier permission." />
      </Screen>
    );

  if (shiftQ.loading && !shiftQ.data)
    return (
      <Screen>
        <Loader loading error="" onRetry={shiftQ.reload}>
          <View />
        </Loader>
      </Screen>
    );

  if (!shift)
    return (
      <Screen>
        <Card style={{ gap: 12, paddingVertical: 24 }}>
          <View style={{ alignItems: 'center', gap: 8 }}>
            <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: th.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="calculator" size={30} color={th.primary} />
            </View>
            <Txt v="h">Open your shift</Txt>
            <Txt v="sub" style={{ textAlign: 'center' }}>Count the cash in the drawer to start selling. At the end of the day you count it again.</Txt>
          </View>
          <Field label="Cash in the drawer now" money value={float} onChangeText={setFloat} placeholder="0" />
          <Btn icon="lock-open-outline" title="Open shift" onPress={openShift} loading={busy === 'open'} />
        </Card>
        {can('pos.manage') && <Btn kind="ghost" title="Past shifts" onPress={() => router.push('/pos/shifts')} />}
      </Screen>
    );

  return (
    <Screen
      onRefresh={() => {
        items.reload();
        shiftQ.reload();
      }}
      footer={
        <Row gap={10}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open cart" onPress={() => setSheet('cart')} style={{ flex: 1 }}>
            <Txt v="small">{cart.length ? `${cart.length} item${cart.length === 1 ? '' : 's'} · qty ${qtyToString(count)}` : 'Cart is empty'}</Txt>
            <Txt style={{ fontWeight: '800', fontSize: 22 }}>{m(total)}</Txt>
          </Pressable>
          <Btn icon="card-outline" title="Charge" onPress={startPay} disabled={!cart.length} style={{ flex: 1 }} />
        </Row>
      }>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/pos/shift')} style={{ flex: 1 }}>
          <Row gap={8}>
            <Badge status="paid" label="Shift open" />
            <Txt v="small">
              {shiftQ.data?.report?.sales ?? 0} sales · {m(shiftQ.data?.report?.salesTotal ?? 0)}
            </Txt>
          </Row>
        </Pressable>
        <Row gap={8}>
          {(held.data?.length ?? 0) > 0 && <IconBtn icon="pause-circle-outline" label={`Parked bills (${held.data!.length})`} onPress={() => setSheet('held')} />}
          <IconBtn icon="return-down-back-outline" label="Returns" onPress={() => router.push('/pos/returns')} />
        </Row>
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <SearchBar value={q} onChange={setQ} placeholder="Search name, code or barcode" />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Scan barcodes" onPress={() => setScan(true)} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: th.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="barcode-outline" size={24} color="#fff" />
        </Pressable>
      </Row>
      {!!unknown && (
        <Notice kind="warn">
          Barcode {unknown} is not in your catalogue.{' '}
          {can('invoices.create') && (
            <Txt color={th.primary} style={{ fontWeight: '800' }} onPress={() => { setUnknown(''); router.push({ pathname: '/services', params: { barcode: unknown } }); }}>
              Add it now
            </Txt>
          )}
        </Notice>
      )}
      {cats.length > 1 && <Chips value={cat} onChange={setCat} options={[{ value: '', label: 'All' }, ...cats.map((c) => ({ value: c, label: c }))]} />}
      <Loader loading={items.loading && !items.data} error={items.data ? '' : items.error} onRetry={items.reload}>
        {shown.length === 0 ? (
          <Empty icon="pricetags-outline" title={active.length ? 'Nothing matches' : 'No products yet'} hint={active.length ? undefined : 'Add products with prices (and barcodes) in your catalogue.'} action={!active.length ? <Btn small title="Open catalogue" onPress={() => router.push('/services')} /> : undefined} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {shown.map((s) => {
              const inCart = cart.filter((l) => l.serviceId === s.id).reduce((a, l) => a + l.qty, 0);
              const out = s.onHand !== undefined && s.onHand <= 0;
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${s.name}`}
                  onPress={() => add(s)}
                  style={({ pressed }) => ({ width: `${100 / cols - 2.5}%` as any, flexGrow: 1, backgroundColor: th.card, borderRadius: 18, padding: 12, gap: 6, opacity: pressed ? 0.75 : 1, borderWidth: inCart ? 2 : 0, borderColor: th.primary, boxShadow: '0 4px 14px rgba(41,52,110,0.06)' }) as any}>
                  <View style={{ height: 64, borderRadius: 14, backgroundColor: th.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt style={{ fontSize: 26, fontWeight: '800', color: th.primary }}>{s.name.slice(0, 1).toUpperCase()}</Txt>
                  </View>
                  <Txt numberOfLines={2} style={{ fontWeight: '700', minHeight: 40 }}>
                    {s.name}
                  </Txt>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt style={{ fontWeight: '800', color: th.primary }}>{m(s.defaultPrice)}</Txt>
                    {inCart > 0 ? <Badge status="unpaid" label={`×${qtyToString(inCart)}`} /> : s.onHand !== undefined ? <Txt v="small" color={out ? th.danger : undefined}>{out ? 'Out' : qtyToString(s.onHand)}</Txt> : null}
                  </Row>
                </Pressable>
              );
            })}
          </View>
        )}
      </Loader>

      <BarcodeScanner visible={scan} continuous onClose={() => setScan(false)} onCode={onCode} title="Scan items" status={cart.length ? `${cart.length} items · ${m(total)}` : 'Point at a barcode'} />

      <Sheet visible={sheet === 'cart'} title={order ? `${order.kind === 'dine_in' ? `Table ${order.table}` : order.customer || order.number} · ${order.number}` : 'Current bill'} onClose={() => setSheet('')}>
        {cart.length === 0 && <Txt v="sub">No items yet.</Txt>}
        {order && cart.length > 1 && <Txt v="small">Split the bill: tap a line's clock to leave it for a later payment.</Txt>}
        {cart.map((l) => (
          <Row key={l.key} style={{ alignItems: 'center', opacity: l.later ? 0.45 : 1 }}>
            {l.orderIdx !== undefined && <IconBtn icon={l.later ? 'time' : 'time-outline'} label={l.later ? `Pay ${l.name} now` : `Pay ${l.name} later`} onPress={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, later: !x.later } : x)))} />}
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '700' }}>{l.name}</Txt>
              <Txt v="small">
                {m(l.unitPrice)} {l.unit ? `/ ${l.unit}` : ''}
              </Txt>
            </View>
            <IconBtn icon="remove" label={`Less ${l.name}`} onPress={() => setQty(l.key, l.qty - 1000)} />
            <Txt style={{ minWidth: 34, textAlign: 'center', fontWeight: '800' }}>{qtyToString(l.qty)}</Txt>
            <IconBtn icon="add" label={`More ${l.name}`} onPress={() => setQty(l.key, l.qty + 1000)} />
            <Txt style={{ minWidth: 76, textAlign: 'right', fontWeight: '700' }}>{m(lineTotal(l))}</Txt>
          </Row>
        ))}
        <Select<Client> label="Customer (optional)" value={client?.name ?? ''} placeholder="Walk-in customer" items={(clients.data ?? []).filter((c) => c.category !== 'Walk-in')} getKey={(c) => c.id} getLabel={(c) => c.name} getSub={(c) => c.phone} onSelect={(c) => setClientId(c.id)} />
        {!!clientId && <Btn small kind="ghost" title="Back to walk-in" onPress={() => setClientId(null)} />}
        {on('loyalty') && (
          <>
            <Row style={{ alignItems: 'flex-end' }}>
              <Field style={{ flex: 1 }} label="Member phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="03xx xxxxxxx" />
              <Btn small kind="secondary" title="Find" onPress={findMember} disabled={phone.replace(/\D/g, '').length < 7} />
            </Row>
            {member && (
              <Card style={{ gap: 6, backgroundColor: th.primarySoft }}>
                <Txt style={{ fontWeight: '700' }}>
                  {member.name} · {member.points} points{member.tier ? ` · ${member.tier.name}` : ''}
                </Txt>
                {member.points >= (preview?.minRedeem ?? 0) && member.points > 0 && (
                  <Field label={`Spend points (1 point = ${m(preview?.pointValue ?? 0)})`} keyboardType="number-pad" value={redeem} onChangeText={setRedeem} placeholder="0" />
                )}
              </Card>
            )}
            <Row style={{ alignItems: 'flex-end' }}>
              <Field style={{ flex: 1 }} label="Coupon code" value={couponInput} onChangeText={setCouponInput} autoCapitalize="characters" />
              <Btn small kind="secondary" title={coupon ? 'Remove' : 'Apply'} onPress={() => (coupon ? (setCoupon(''), setCouponInput('')) : setCoupon(couponInput.trim()))} disabled={!coupon && !couponInput.trim()} />
            </Row>
          </>
        )}
        {(on('restaurant') || order) && (
          <>
            <Txt v="label">Service charge</Txt>
            <Chips value={String(serviceBp)} onChange={(v) => setServiceBp(Number(v))} options={[0, 500, 1000, 1500].map((b) => ({ value: String(b), label: b ? `${b / 100}%` : 'None' }))} />
            <Field label="Tip (optional)" money value={tip} onChangeText={setTip} placeholder="0" />
          </>
        )}
        <Field label="Bill discount (amount)" money value={discount} onChangeText={setDiscount} placeholder="0" hint={can('pos.manage') ? undefined : 'Up to 10% without a manager'} />
        <KV k="Sub total" v={m(subtotal)} />
        {(preview?.applied ?? []).map((p) => (
          <KV key={p.promotionId} k={p.name} v={`− ${m(p.amount)}`} color={th.success} />
        ))}
        {itemOffers > 0 && !(preview?.applied ?? []).length && <KV k="Offers" v={`− ${m(itemOffers)}`} />}
        {memberOff > 0 && <KV k={`${member?.tier?.name ?? 'Member'} discount`} v={`− ${m(memberOff)}`} color={th.success} />}
        {pointsOff > 0 && <KV k={`${redeemPts} points`} v={`− ${m(pointsOff)}`} />}
        {gifts.map((g) => (
          <Row key={g.code} style={{ alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <KV k={`Gift card ${g.code}`} v={`− ${m(g.amount)}`} />
            </View>
            <IconBtn icon="close" label={`Remove gift card ${g.code}`} onPress={() => setGifts((x) => x.filter((y) => y.code !== g.code))} />
          </Row>
        ))}
        {billDiscount > 0 && <KV k="Discount" v={`− ${m(billDiscount)}`} />}
        {serviceCharge > 0 && <KV k={`Service charge ${serviceBp / 100}%`} v={m(serviceCharge)} />}
        {tipAmt > 0 && <KV k="Tip" v={m(tipAmt)} />}
        {totals.taxAmount > 0 && <KV k="Tax" v={m(totals.taxAmount)} />}
        <KV k="Total" v={m(total)} bold />
        <Row gap={10}>
          <Btn style={{ flex: 1 }} kind="secondary" icon="pause-outline" title="Park" onPress={hold} disabled={!cart.length} />
          <Btn style={{ flex: 1 }} kind="ghost" title="Clear" onPress={reset} disabled={!cart.length} />
        </Row>
        <Btn icon="card-outline" title={`Charge ${m(total)}`} onPress={startPay} disabled={!cart.length} />
      </Sheet>

      <Sheet visible={sheet === 'pay'} title={`Charge ${m(total)}`} onClose={() => setSheet('')}>
        {tenders.map((x, i) => (
          <Row key={x.key} style={{ alignItems: 'flex-end' }}>
            <Field style={{ flex: 1 }} label={POS_TENDER_LABELS[x.tender]} money value={x.amount} onChangeText={(v) => setTenders((ts) => ts.map((y, k) => (k === i ? { ...y, amount: v } : y)))} />
            {tenders.length > 1 && <IconBtn icon="close" label={`Remove ${POS_TENDER_LABELS[x.tender]}`} onPress={() => setTenders((ts) => ts.filter((_, k) => k !== i))} />}
          </Row>
        ))}
        {remaining !== 0 && <Txt color={remaining > 0 ? th.warn : th.danger} style={{ fontWeight: '700' }}>{remaining > 0 ? `${m(remaining)} still to pay` : `${m(-remaining)} too much`}</Txt>}
        <Txt v="label">Add a payment</Txt>
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          {POS_TENDERS.filter((t) => !tenders.some((x) => x.tender === t) && (t !== 'credit' || !!clientId)).map((t) => (
            <Btn key={t} small kind="secondary" title={POS_TENDER_LABELS[t]} onPress={() => setTenders((ts) => [...ts, { key: newKey(), tender: t, amount: moneyToInput(Math.max(remaining, 0), precision) }])} />
          ))}
        </Row>
        {!clientId && <Txt v="small">For udhaar, choose the customer in the bill first.</Txt>}
        {on('loyalty') && (
          <Row style={{ alignItems: 'flex-end' }}>
            <Field style={{ flex: 1 }} label="Gift card code" value={giftCode} onChangeText={setGiftCode} autoCapitalize="characters" />
            <Btn small kind="secondary" title="Use" onPress={addGift} disabled={!giftCode.trim()} />
          </Row>
        )}
        {cashTender && (
          <>
            <Field label="Cash given by the customer" money value={cashGiven} onChangeText={setCashGiven} placeholder={moneyToInput(cashAmount, precision)} />
            <Row gap={6} style={{ flexWrap: 'wrap' }}>
              {[500, 1000, 5000].map((n) => n * 10 ** precision).filter((v) => v >= cashAmount).slice(0, 3).map((v) => (
                <Btn key={v} small kind="secondary" title={m(v)} onPress={() => setCashGiven(moneyToInput(v, precision))} />
              ))}
            </Row>
            {change > 0 && <KV k="Change to give" v={m(change)} bold />}
          </>
        )}
        <Btn icon="checkmark-circle-outline" title="Complete sale" onPress={complete} loading={busy === 'pay'} disabled={remaining !== 0} />
      </Sheet>

      <Sheet visible={sheet === 'held'} title="Parked bills" onClose={() => setSheet('')}>
        {(held.data ?? []).map((h) => (
          <Card key={h.id} label={`Parked ${h.name}`} onPress={() => recall(h)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Txt style={{ fontWeight: '700' }}>{h.name}</Txt>
                <Txt v="small">
                  {h.lines.length} items · {h.byName} · {dt(h.createdAt, true)}
                </Txt>
              </View>
              <IconBtn
                icon="trash-outline"
                label="Drop parked bill"
                color={th.danger}
                onPress={async () => {
                  await api(`/pos/held/${h.id}`, { method: 'DELETE' }).catch(() => {});
                  held.reload();
                }}
              />
            </Row>
          </Card>
        ))}
      </Sheet>

      {done && business && (
        <DocumentViewer visible={!!done} onClose={() => setDone(null)} title={`Sale ${done.invoice.number ?? ''}${done.change ? ` · change ${m(done.change)}` : ''}`} fileName={`receipt-${done.invoice.number ?? todayStr()}`} build={buildReceipt} template={business.invoiceTemplate} defaultPaper="thermal" note="Tap Print for the receipt printer, or share it on WhatsApp as a PDF." />
      )}
    </Screen>
  );
}

