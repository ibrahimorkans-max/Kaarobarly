import { View } from 'react-native';
import { useWorkspace } from '@/lib/workspace';
import { customValueText, type CustomValues, type FieldEntity } from '@/lib/shared';
import { Chips, DateField, Field, KV, Txt, fd, isDate } from './ui';

/** Inputs for the workspace's custom fields of one kind of record. Renders nothing when there are none. */
export function CustomFieldInputs({ entity, values, onChange, title }: { entity: FieldEntity; values: CustomValues; onChange: (v: CustomValues) => void; title?: string }) {
  const { fields } = useWorkspace();
  const list = fields(entity);
  if (!list.length) return null;
  const set = (id: string, v: string | number | boolean | undefined) => {
    const next = { ...values };
    if (v === undefined || v === '') delete next[id];
    else next[id] = v;
    onChange(next);
  };
  return (
    <View style={{ gap: 12 }}>
      {!!title && <Txt v="label">{title}</Txt>}
      {list.map((f) => {
        const label = `${f.label}${f.required ? ' *' : ''}`;
        const v = values[f.id];
        if (f.type === 'date') return <DateField key={f.id} label={label} value={typeof v === 'string' ? v : ''} onChange={(x) => set(f.id, x)} />;
        if (f.type === 'checkbox')
          return (
            <View key={f.id} style={{ gap: 5 }}>
              <Txt v="label">{label}</Txt>
              <Chips<'yes' | 'no' | ''>
                value={v === true ? 'yes' : v === false ? 'no' : ''}
                onChange={(x) => set(f.id, x === '' ? undefined : x === 'yes')}
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
              />
            </View>
          );
        if (f.type === 'select')
          return (
            <View key={f.id} style={{ gap: 5 }}>
              <Txt v="label">{label}</Txt>
              <Chips value={typeof v === 'string' ? v : ''} onChange={(x) => set(f.id, x === v ? undefined : x)} options={f.options.map((o) => ({ value: o, label: o }))} />
            </View>
          );
        if (f.type === 'number')
          return (
            <Field
              key={f.id}
              label={label}
              money
              value={v === undefined ? '' : String(v)}
              onChangeText={(x) => {
                const n = Number(x.replace(/,/g, ''));
                set(f.id, x.trim() === '' ? undefined : Number.isFinite(n) && !/[.-]$/.test(x) ? n : x);
              }}
            />
          );
        return <Field key={f.id} label={label} value={typeof v === 'string' ? v : v === undefined ? '' : String(v)} onChangeText={(x) => set(f.id, x)} />;
      })}
    </View>
  );
}

/** Label / value rows for the custom fields that have a value. */
export function CustomFieldValues({ entity, values }: { entity: FieldEntity; values: CustomValues | undefined }) {
  const { fields } = useWorkspace();
  const rows = fields(entity)
    .map((f) => {
      const v = values?.[f.id];
      const text = customValueText(f, v);
      return text ? { k: f.label, v: f.type === 'date' && isDate(text) ? fd(text) : text } : null;
    })
    .filter((x): x is { k: string; v: string } => !!x);
  if (!rows.length) return null;
  return (
    <View>
      {rows.map((r) => (
        <KV key={r.k} k={r.k} v={r.v} />
      ))}
    </View>
  );
}
