import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { MenuRow } from '@/components/rows';
import { Btn, Card, Field, IconBtn, Row, Screen, Section, Txt, type IconName } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { setWorkspace, useWorkspace } from '@/lib/workspace';
import { DEFAULT_TERMS, MODULES, MODULE_INFO, PRESETS, TERM_PAIRS, type Workspace } from '@/lib/shared';

/** Business setup: modules, wording and item types. */
export default function WorkspaceScreen() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { ws, loaded } = useWorkspace();
  const [draft, setDraft] = useState<Workspace>(ws);
  const [newType, setNewType] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = can('businesses.manage');
  useEffect(() => setDraft(ws), [ws]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(ws);

  async function save() {
    setBusy(true);
    try {
      const saved = await api<Workspace>('/workspace', { method: 'PUT', body: { businessType: draft.businessType, modules: draft.modules, terms: draft.terms, customFields: draft.customFields, itemTypes: draft.itemTypes } });
      setWorkspace(saved);
      toast('Business setup saved');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const addType = () => {
    const v = newType.trim();
    if (!v) return;
    if (draft.itemTypes.some((x) => x.toLowerCase() === v.toLowerCase())) return toast('That type is already in the list', 'error');
    setDraft({ ...draft, itemTypes: [...draft.itemTypes, v] });
    setNewType('');
  };

  return (
    <Screen>
      <Card onPress={canEdit ? () => router.push('/setup') : undefined} label="Change business type">
        <Row>
          <Ionicons name={PRESETS[ws.businessType].icon as IconName} size={28} color={t.primary} />
          <View style={{ flex: 1 }}>
            <Txt v="small">Business type</Txt>
            <Txt style={{ fontWeight: '700', fontSize: 17 }}>{loaded && ws.configured ? PRESETS[ws.businessType].name : 'Not chosen yet'}</Txt>
          </View>
          {canEdit && <Txt color={t.primary}>Change</Txt>}
        </Row>
      </Card>

      <MenuRow icon="list-outline" title="Custom fields" sub={`${ws.customFields.length} extra field${ws.customFields.length === 1 ? '' : 's'} on your records`} onPress={() => router.push('/custom-fields')} />

      <Section title="Modules">
        <Card>
          {MODULES.map((m) => {
            const info = MODULE_INFO[m];
            return (
              <Row key={m} style={{ paddingVertical: 8 }}>
                <Ionicons name={info.icon as IconName} size={20} color={t.sub} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Txt style={{ fontWeight: '600' }}>{info.name}</Txt>
                  <Txt v="small">{info.hint}</Txt>
                </View>
                <Switch accessibilityLabel={info.name} value={draft.modules[m]} disabled={!canEdit || !!info.core} onValueChange={(v) => setDraft({ ...draft, modules: { ...draft.modules, [m]: v } })} />
              </Row>
            );
          })}
          <Txt v="small">Switching a module off only hides it. Nothing is deleted.</Txt>
        </Card>
      </Section>

      <Section title="Your words">
        <Card style={{ gap: 14 }}>
          {TERM_PAIRS.map((pair) => (
            <View key={pair.one} style={{ gap: 6 }}>
              <Txt v="label">{pair.label}</Txt>
              <Row gap={10} style={{ alignItems: 'flex-start' }}>
                <Field
                  style={{ flex: 1 }}
                  label="One"
                  value={draft.terms[pair.one]}
                  editable={canEdit}
                  placeholder={DEFAULT_TERMS[pair.one]}
                  onChangeText={(v) => setDraft({ ...draft, terms: { ...draft.terms, [pair.one]: v } })}
                />
                <Field
                  style={{ flex: 1 }}
                  label="Many"
                  value={draft.terms[pair.many]}
                  editable={canEdit}
                  placeholder={DEFAULT_TERMS[pair.many]}
                  onChangeText={(v) => setDraft({ ...draft, terms: { ...draft.terms, [pair.many]: v } })}
                />
              </Row>
              <Txt v="small">e.g. {pair.examples}</Txt>
            </View>
          ))}
        </Card>
      </Section>

      <Section title={`Kinds of ${draft.terms.items.toLowerCase()}`}>
        <Card style={{ gap: 8 }}>
          {draft.itemTypes.map((it) => (
            <Row key={it} style={{ justifyContent: 'space-between' }}>
              <Txt>{it}</Txt>
              {canEdit && draft.itemTypes.length > 1 && <IconBtn icon="close" label={`Remove ${it}`} onPress={() => setDraft({ ...draft, itemTypes: draft.itemTypes.filter((x) => x !== it) })} />}
            </Row>
          ))}
          {canEdit && (
            <Row style={{ alignItems: 'flex-end' }}>
              <Field style={{ flex: 1 }} label="Add a kind" placeholder="e.g. Raw material" value={newType} onChangeText={setNewType} onSubmitEditing={addType} />
              <Btn small title="Add" onPress={addType} />
            </Row>
          )}
        </Card>
      </Section>

      {canEdit && <Btn icon="checkmark" title="Save" onPress={save} loading={busy} disabled={!dirty} />}
    </Screen>
  );
}
