import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { Btn, Card, Chips, Empty, Field, IconBtn, Loader, Notice, Row, Screen, SearchBar, Section, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { labelCode, labelPaper, labelsHtml, type LabelJob } from '@/lib/labels';
import { labelsTspl, labelsZpl } from '@/lib/escpos';
import { getPrinters, sendBytes, type PrinterSettings } from '@/lib/printer';
import { BUILT_IN_LABELS, LABEL_SIZES, type BusinessProfile, type GoodsReceipt, type LabelTemplate, type Purchase, type Service } from '@/lib/shared';

type Source = 'items' | 'pending' | 'bill';

/** Print product and shelf labels for chosen items, items whose price changed, or a bill's received goods. */
export default function LabelsScreen() {
  const params = useLocalSearchParams<{ ids?: string; purchaseId?: string; receiptId?: string; template?: string }>();
  const th = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const items = useApi<Service[]>('/services?limit=100');
  const saved = useApi<LabelTemplate[]>('/labels/templates');
  const pending = useApi<string[]>('/labels/pending');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const business = businesses.data?.[0];
  const templates = useMemo(() => [...(saved.data ?? []), ...BUILT_IN_LABELS], [saved.data]);
  const [templateId, setTemplateId] = useState(params.template ?? 'builtin-product');
  const design = templates.find((t) => t.id === templateId) ?? BUILT_IN_LABELS[1];
  const [source, setSource] = useState<Source>(params.purchaseId || params.receiptId ? 'bill' : 'items');
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [billName, setBillName] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [skip, setSkip] = useState('');
  const [view, setView] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printers, setPrinters] = useState<PrinterSettings>({});
  useEffect(() => {
    void getPrinters().then(setPrinters);
  }, []);
  async function btLabels() {
    const p = printers.label;
    if (!p || !business) return;
    setBusy(true);
    try {
      await sendBytes(p.address, (p.language === 'zpl' ? labelsZpl : labelsTspl)(design, jobs, business));
      toast(`${total} label${total === 1 ? '' : 's'} sent to ${p.name}`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // a bill or receipt: one label per unit received (rounded up for loose goods)
  useEffect(() => {
    const path = params.purchaseId ? `/purchases/${params.purchaseId}` : params.receiptId ? `/goods-receipts/${params.receiptId}` : null;
    if (!path) return;
    api<Purchase | GoodsReceipt>(path)
      .then((doc) => {
        const next: Record<string, number> = {};
        for (const l of doc.lines as any[]) {
          const id = l.itemId ?? l.serviceId;
          if (id) next[id] = (next[id] ?? 0) + Math.max(1, Math.ceil(l.qty / 1000));
        }
        setCopies(next);
        setBillName(doc.number);
      })
      .catch((e) => toast(e.message, 'error'));
  }, [params.purchaseId, params.receiptId, toast]);
  useEffect(() => {
    if (params.ids) setCopies(Object.fromEntries(params.ids.split(',').map((id) => [id, 1])));
  }, [params.ids]);

  function pick(s: Source) {
    setSource(s);
    if (s === 'pending') setCopies(Object.fromEntries((pending.data ?? []).map((id) => [id, 1])));
    if (s === 'items' && source !== 'items') setCopies({});
  }

  const active = (items.data ?? []).filter((s) => s.status === 'active');
  const byId = new Map(active.map((s) => [s.id, s]));
  const cats = [...new Set(active.map((s) => s.category).filter(Boolean))];
  const needle = q.trim().toLowerCase();
  const chosen = Object.entries(copies).filter(([id, n]) => n > 0 && byId.has(id));
  const list =
    source === 'items'
      ? active.filter((s) => (!cat || s.category === cat) && (!needle || `${s.name} ${s.sku} ${s.barcode}`.toLowerCase().includes(needle)))
      : chosen.map(([id]) => byId.get(id)!);
  const total = chosen.reduce((s, [, n]) => s + n, 0);
  const noCode = chosen.filter(([id]) => !labelCode(byId.get(id)!)).map(([id]) => id);
  const jobs: LabelJob[] = chosen.map(([id, n]) => ({ item: byId.get(id)!, copies: n }));
  const size = LABEL_SIZES[design.size];
  const sheet = 'sheet' in size;
  const skipN = Math.max(0, Math.floor(Number(skip) || 0));
  const build = useCallback(() => (business ? labelsHtml(design, jobs, business, skipN) : ''), [business, design, jobs, skipN]);

  const set = (id: string, n: number) => setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(n, 500)) }));

  async function fillCodes() {
    setBusy(true);
    try {
      const r = await api<{ filled: number }>('/services/auto-codes', { body: { ids: noCode } });
      toast(r.filled === 1 ? '1 item now has a barcode' : `${r.filled} items now have a barcode`);
      items.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function donePending() {
    const ids = chosen.map(([id]) => id).filter((id) => pending.data?.includes(id));
    if (!ids.length) return;
    await api('/labels/printed', { body: { ids } }).catch(() => {});
    toast('Cleared from the price-change list');
    pending.reload();
    setCopies({});
  }

  return (
    <Screen
      onRefresh={() => {
        items.reload();
        pending.reload();
        saved.reload();
      }}
      footer={
        <Row gap={10}>
          <View style={{ flex: 1 }}>
            <Txt v="small">{chosen.length ? `${chosen.length} item${chosen.length === 1 ? '' : 's'}` : 'Choose items'}</Txt>
            <Txt style={{ fontWeight: '800', fontSize: 18 }}>
              {total} label{total === 1 ? '' : 's'}
            </Txt>
          </View>
          {printers.label ? (
            <>
              <Btn style={{ flex: 1 }} kind="secondary" icon="eye-outline" title="Preview" onPress={() => setView(true)} disabled={!total || !business} />
              <Btn style={{ flex: 1.2 }} icon="bluetooth-outline" title="Print" onPress={btLabels} loading={busy} disabled={!total || !business} />
            </>
          ) : (
            <Btn style={{ flex: 1.4 }} icon="print-outline" title="Preview & print" onPress={() => setView(true)} disabled={!total || !business} />
          )}
        </Row>
      }>
      <Stack.Screen options={{ title: 'Print labels' }} />
      <Section title="Label design" action={<Btn small kind="ghost" icon="add" title="New" onPress={() => router.push({ pathname: '/labels/designer', params: { from: templateId } })} />}>
        <Chips value={templateId} onChange={setTemplateId} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '700' }}>{design.name}</Txt>
              <Txt v="small">
                {size.label} · {design.code === 'barcode' ? 'Barcode' : design.code === 'qr' ? 'QR code' : 'No code'}
              </Txt>
            </View>
            {can('invoices.create') && <Btn small kind="secondary" icon="color-wand-outline" title={design.builtIn ? 'Copy & edit' : 'Edit'} onPress={() => router.push({ pathname: '/labels/designer', params: design.builtIn ? { from: design.id } : { id: design.id } })} />}
          </Row>
        </Card>
        {sheet && <Field label="Skip used stickers at the start of the sheet" value={skip} onChangeText={setSkip} keyboardType="number-pad" placeholder="0" hint="For a part-used sheet: how many positions are already gone." />}
      </Section>

      <Chips
        value={source}
        onChange={pick}
        options={[
          { value: 'items', label: 'Choose items' },
          { value: 'pending', label: `Price changed (${pending.data?.length ?? 0})` },
          ...(params.purchaseId || params.receiptId ? [{ value: 'bill' as Source, label: `Bill ${billName}` }] : []),
        ]}
      />
      {source === 'items' && (
        <>
          <SearchBar value={q} onChange={setQ} placeholder="Search name, SKU or barcode" />
          {cats.length > 1 && <Chips value={cat} onChange={setCat} options={[{ value: '', label: 'All' }, ...cats.map((c) => ({ value: c, label: c }))]} />}
          {list.length > 0 && (
            <Row>
              <Btn small kind="secondary" title={`Select ${cat ? `all in ${cat}` : 'all shown'}`} onPress={() => setCopies((c) => ({ ...c, ...Object.fromEntries(list.map((s) => [s.id, Math.max(c[s.id] ?? 0, 1)])) }))} />
              {chosen.length > 0 && <Btn small kind="ghost" title="Clear" onPress={() => setCopies({})} />}
            </Row>
          )}
        </>
      )}
      {source === 'pending' && (pending.data?.length ?? 0) > 0 && <Btn small kind="secondary" icon="checkmark-done-outline" title="Printed: clear these from the list" onPress={donePending} />}
      {noCode.length > 0 && (
        <Notice kind="warn">
          {noCode.length} chosen item{noCode.length === 1 ? ' has' : 's have'} no barcode or SKU, so the label will have no code.{' '}
          <Txt color={th.primary} style={{ fontWeight: '800' }} onPress={busy ? undefined : fillCodes}>
            Give them a barcode
          </Txt>
        </Notice>
      )}

      <Loader loading={items.loading && !items.data} error={items.data ? '' : items.error} onRetry={items.reload}>
        {list.length === 0 && <Empty icon="pricetag-outline" title={source === 'pending' ? 'No price changes to print' : 'No items'} hint={source === 'pending' ? 'When you change a price, the item shows here until you print its new label.' : undefined} />}
        {list.map((s) => {
          const n = copies[s.id] ?? 0;
          return (
            <Pressable key={s.id} accessibilityRole="checkbox" accessibilityState={{ checked: n > 0 }} accessibilityLabel={s.name} onPress={() => set(s.id, n > 0 ? 0 : 1)}>
              <Card style={{ paddingVertical: 10 }}>
                <Row style={{ alignItems: 'center' }}>
                  <Ionicons name={n > 0 ? 'checkbox' : 'square-outline'} size={22} color={n > 0 ? th.primary : th.sub} />
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                      {s.name}
                    </Txt>
                    <Txt v="small" numberOfLines={1}>
                      {fm(s.defaultPrice, business)} · {labelCode(s) || 'no code'}
                    </Txt>
                  </View>
                  {n > 0 && (
                    <>
                      <IconBtn icon="remove" label={`Fewer labels for ${s.name}`} onPress={() => set(s.id, n - 1)} />
                      <Txt style={{ minWidth: 28, textAlign: 'center', fontWeight: '800' }}>{n}</Txt>
                      <IconBtn icon="add" label={`More labels for ${s.name}`} onPress={() => set(s.id, n + 1)} />
                    </>
                  )}
                </Row>
              </Card>
            </Pressable>
          );
        })}
      </Loader>

      {view && business && (
        <DocumentViewer
          key={design.id + design.size}
          visible={view}
          onClose={() => setView(false)}
          title={`${total} labels · ${design.name}`}
          fileName={`labels-${design.size}`}
          build={build}
          defaultPaper={labelPaper(design)}
          papers={[{ value: labelPaper(design), label: size.label }]}
          note={sheet ? 'Print at 100% (actual size), with no margins, on the matching sticker sheet.' : 'Choose your label printer and the matching label size when printing.'}
        />
      )}
    </Screen>
  );
}
