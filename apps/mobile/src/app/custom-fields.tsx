import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Badge, Btn, Card, Chips, Empty, Field, Row, Screen, Section, Sheet, Txt, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { setWorkspace, useWorkspace } from '@/lib/workspace';
import { FIELD_ENTITIES, FIELD_TYPES, FIELD_TYPE_LABELS, fieldIdFor, type CustomField, type FieldEntity, type FieldType, type Workspace } from '@/lib/shared';

interface Form {
  id?: string;
  entity: FieldEntity;
  label: string;
  type: FieldType;
  options: string;
  required: boolean;
  showOnPdf: boolean;
}

export default function CustomFields() {
  const toast = useToast();
  const { can } = useAuth();
  const { ws, t } = useWorkspace();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('businesses.manage');
  const entityName: Record<FieldEntity, string> = { client: t('client'), item: t('item'), invoice: `${t('invoice')} / ${t('quotation')}`, supplier: t('supplier'), purchase: t('purchase') };
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  async function store(fields: CustomField[]) {
    setBusy(true);
    try {
      const saved = await api<Workspace>('/workspace', { method: 'PUT', body: { businessType: ws.businessType, modules: ws.modules, terms: ws.terms, itemTypes: ws.itemTypes, customFields: fields } });
      setWorkspace(saved);
      return true;
    } catch (e: any) {
      toast(e.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    const label = form.label.trim();
    if (!label) return toast('Give the field a name', 'error');
    const options = form.options.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (form.type === 'select' && !options.length) return toast('Add the choices, separated by commas', 'error');
    const others = ws.customFields.filter((f) => !(f.entity === form.entity && f.id === form.id));
    const field: CustomField = {
      id: form.id ?? fieldIdFor(label, ws.customFields.filter((f) => f.entity === form.entity).map((f) => f.id)),
      entity: form.entity,
      label,
      type: form.type,
      options: form.type === 'select' ? options : [],
      required: form.required,
      showOnPdf: form.showOnPdf,
    };
    // keep the field's position when editing
    const idx = ws.customFields.findIndex((f) => f.entity === form.entity && f.id === form.id);
    const next = idx >= 0 ? ws.customFields.map((f, i) => (i === idx ? field : f)) : [...others, field];
    if (await store(next)) {
      toast(form.id ? 'Field updated' : 'Field added');
      setForm(null);
    }
  }

  async function remove(f: CustomField) {
    if (!(await confirm('Remove field?', `"${f.label}" will no longer show. Values already saved stay on old records until they are edited.`, 'Remove'))) return;
    if (await store(ws.customFields.filter((x) => !(x.entity === f.entity && x.id === f.id)))) {
      toast('Field removed');
      setForm(null);
    }
  }

  return (
    <Screen>
      <Txt v="sub">Add your own fields to records, e.g. MR number for patients, vehicle no. on bills, or batch on products.</Txt>
      {FIELD_ENTITIES.map((e) => {
        const list = ws.customFields.filter((f) => f.entity === e);
        return (
          <Section key={e} title={entityName[e]} action={canEdit ? <Btn small kind="ghost" icon="add" title="Add" onPress={() => setForm({ entity: e, label: '', type: 'text', options: '', required: false, showOnPdf: e === 'invoice' })} /> : undefined}>
            {list.length === 0 ? (
              <Txt v="small">No extra fields.</Txt>
            ) : (
              list.map((f) => (
                <Card
                  key={f.id}
                  label={`Field ${f.label}`}
                  onPress={canEdit ? () => setForm({ id: f.id, entity: f.entity, label: f.label, type: f.type, options: f.options.join(', '), required: f.required, showOnPdf: f.showOnPdf }) : undefined}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }}>{f.label}</Txt>
                      <Txt v="small">{[FIELD_TYPE_LABELS[f.type], f.type === 'select' ? f.options.join(' / ') : ''].filter(Boolean).join(': ')}</Txt>
                    </View>
                    <Row gap={6}>
                      {f.required && <Badge status="draft" label="Required" />}
                      {f.showOnPdf && <Badge status="paid" label="Printed" />}
                    </Row>
                  </Row>
                </Card>
              ))
            )}
          </Section>
        );
      })}
      {ws.customFields.length === 0 && <Empty icon="list-outline" title="No custom fields yet" hint="Tap Add next to any record type above." />}

      <Sheet visible={!!form} title={form?.id ? 'Edit field' : `New ${form ? entityName[form.entity].toLowerCase() : ''} field`} onClose={() => setForm(null)}>
        <Field label="Field name" value={form?.label ?? ''} onChangeText={(v) => set({ label: v })} placeholder="e.g. Vehicle no." />
        <Txt v="label">Type</Txt>
        <Chips value={form?.type ?? 'text'} onChange={(v) => set({ type: v })} options={FIELD_TYPES.map((x) => ({ value: x, label: FIELD_TYPE_LABELS[x] }))} />
        {form?.type === 'select' && <Field label="Choices" value={form.options} onChangeText={(v) => set({ options: v })} placeholder="Dine-in, Takeaway, Delivery" hint="Separate choices with commas" />}
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt>Required</Txt>
          <Switch accessibilityLabel="Required" value={!!form?.required} onValueChange={(v) => set({ required: v })} />
        </Row>
        {form?.entity === 'invoice' && <Txt v="small">Required {t('invoice').toLowerCase()} fields are checked when it is finalized; drafts can leave them empty.</Txt>}
        {(form?.entity === 'invoice' || form?.entity === 'client') && (
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt>Print on {t('invoices').toLowerCase()}</Txt>
            <Switch accessibilityLabel="Print on invoices" value={!!form?.showOnPdf} onValueChange={(v) => set({ showOnPdf: v })} />
          </Row>
        )}
        <Btn title="Save" onPress={save} loading={busy} />
        {!!form?.id && <Btn kind="danger" title="Remove field" onPress={() => remove(ws.customFields.find((f) => f.entity === form.entity && f.id === form.id)!)} />}
      </Sheet>
    </Screen>
  );
}
