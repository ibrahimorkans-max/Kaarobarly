import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable } from 'react-native';
import { DocPreview } from '@/components/doc-viewer';
import { Btn, Card, Chips, Field, Row, Screen, Section, Select, Txt, confirm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { SAMPLE_LABEL_ITEM, labelPaper, labelsHtml } from '@/lib/labels';
import { BUILT_IN_LABELS, LABEL_QR_LABELS, LABEL_SHOW_LABELS, LABEL_SIZES, LABEL_SIZE_KEYS, type BusinessProfile, type LabelDesign, type LabelQrContent, type LabelShow, type LabelSize, type LabelTemplate, type Service } from '@/lib/shared';

/** Build a label template: size, what it shows, barcode or QR, with a live preview. */
export default function LabelDesignerScreen() {
  const params = useLocalSearchParams<{ id?: string; from?: string }>();
  const th = useTheme();
  const toast = useToast();
  const saved = useApi<LabelTemplate[]>('/labels/templates');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const items = useApi<Service[]>('/services?limit=100');
  const business = businesses.data?.[0];
  const [name, setName] = useState('');
  const [d, setD] = useState<LabelDesign | null>(null);
  const [busy, setBusy] = useState(false);

  // start from the saved template, or a copy of the one we came from
  useEffect(() => {
    if (d) return;
    const all = [...(saved.data ?? []), ...BUILT_IN_LABELS];
    if (params.id && !saved.data) return;
    const src = all.find((t) => t.id === (params.id ?? params.from)) ?? BUILT_IN_LABELS[1];
    const { id: _i, name: n, builtIn: _b, updatedAt: _u, ...design } = src;
    setD(design);
    setName(params.id ? n : `${n} (my copy)`);
  }, [saved.data, params.id, params.from, d]);

  // preview with a real item that has a price and code when there is one
  const sample = useMemo(() => (items.data ?? []).find((s) => s.status === 'active' && s.barcode && s.defaultPrice) ?? SAMPLE_LABEL_ITEM, [items.data]);
  const html = useMemo(() => (d && business ? labelsHtml(d, [{ item: sample, copies: 'sheet' in LABEL_SIZES[d.size] ? 12 : 1 }], business) : ''), [d, business, sample]);

  if (!d) return <Screen>{null}</Screen>;
  const upd = (p: Partial<LabelDesign>) => setD({ ...d, ...p });
  const toggle = (k: keyof LabelShow) => upd({ show: { ...d.show, [k]: !d.show[k] } });

  async function save() {
    if (!name.trim()) return toast('Name the design', 'error');
    setBusy(true);
    try {
      const body = { ...d, name: name.trim() };
      const t = params.id ? await api<LabelTemplate>(`/labels/templates/${params.id}`, { method: 'PUT', body }) : await api<LabelTemplate>('/labels/templates', { body });
      toast('Label design saved');
      router.replace({ pathname: '/labels', params: { template: t.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!params.id || !(await confirm('Delete this design?', 'Labels already printed are not affected.', 'Delete'))) return;
    await api(`/labels/templates/${params.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
    router.back();
  }

  return (
    <Screen footer={<Btn icon="save-outline" title="Save design" onPress={save} loading={busy} />}>
      <Stack.Screen options={{ title: params.id ? 'Edit label' : 'New label' }} />
      <Card style={{ backgroundColor: th.input, alignItems: 'center', paddingVertical: 18 }}>
        {!!html && (
          <Card style={{ width: '100%', maxWidth: 'sheet' in LABEL_SIZES[d.size] ? 420 : Math.min(360, LABEL_SIZES[d.size].w * 5), padding: 0, overflow: 'hidden' }}>
            <DocPreview html={html} paper={labelPaper(d)} />
          </Card>
        )}
        <Txt v="small" style={{ marginTop: 8 }}>
          Preview with {sample === SAMPLE_LABEL_ITEM ? 'a sample item' : sample.name}
        </Txt>
      </Card>
      <Field label="Design name" value={name} onChangeText={setName} />
      <Select<{ key: LabelSize; label: string }>
        label="Label size"
        placeholder="Choose a size"
        value={LABEL_SIZES[d.size].label}
        items={LABEL_SIZE_KEYS.map((k) => ({ key: k, label: LABEL_SIZES[k].label }))}
        getKey={(x) => x.key}
        getLabel={(x) => x.label}
        onSelect={(x) => upd({ size: x.key })}
      />
      <Section title="Code">
        <Chips value={d.code} onChange={(v) => upd({ code: v })} options={[{ value: 'barcode', label: 'Barcode' }, { value: 'qr', label: 'QR code' }, { value: 'none', label: 'None' }]} />
        {d.code === 'qr' && <Chips<LabelQrContent> value={d.qrContent} onChange={(v) => upd({ qrContent: v })} options={(Object.keys(LABEL_QR_LABELS) as LabelQrContent[]).map((k) => ({ value: k, label: LABEL_QR_LABELS[k] }))} />}
        <Txt v="small">{d.code === 'barcode' ? 'Prints the item barcode (EAN-13), or its SKU as Code 128 when it has no barcode.' : d.code === 'qr' ? 'Any phone camera can read it; the Tijar scanner adds the item to a bill.' : 'Text only.'}</Txt>
      </Section>
      <Section title="What the label shows">
        <Card style={{ gap: 2, paddingVertical: 6 }}>
          {(Object.keys(LABEL_SHOW_LABELS) as (keyof LabelShow)[]).map((k) => (
            <Pressable key={k} accessibilityRole="checkbox" accessibilityState={{ checked: d.show[k] }} onPress={() => toggle(k)} style={{ paddingVertical: 9 }}>
              <Row>
                <Ionicons name={d.show[k] ? 'checkbox' : 'square-outline'} size={22} color={d.show[k] ? th.primary : th.sub} />
                <Txt style={{ flex: 1 }}>{LABEL_SHOW_LABELS[k]}</Txt>
              </Row>
            </Pressable>
          ))}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: d.border }} onPress={() => upd({ border: !d.border })} style={{ paddingVertical: 9 }}>
            <Row>
              <Ionicons name={d.border ? 'checkbox' : 'square-outline'} size={22} color={d.border ? th.primary : th.sub} />
              <Txt style={{ flex: 1 }}>Border around the label</Txt>
            </Row>
          </Pressable>
        </Card>
        <Txt v="label">Price size</Txt>
        <Chips value={d.priceSize} onChange={(v) => upd({ priceSize: v })} options={[{ value: 'S', label: 'Small' }, { value: 'M', label: 'Medium' }, { value: 'L', label: 'Large' }]} />
        <Field label="Extra line (optional)" value={d.extra} onChangeText={(v) => upd({ extra: v })} placeholder="e.g. Made in Pakistan" maxLength={80} />
        <Txt v="small">Urdu names and MRP are set on each item in the catalogue.</Txt>
      </Section>
      {!!params.id && <Btn kind="ghost" title="Delete design" onPress={remove} />}
    </Screen>
  );
}
