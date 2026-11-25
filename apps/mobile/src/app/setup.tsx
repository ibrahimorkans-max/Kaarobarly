import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Btn, Card, Row, Screen, Section, Txt, type IconName } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { setWorkspace, useWorkspace } from '@/lib/workspace';
import { BUSINESS_TYPES, MODULES, MODULE_INFO, PRESETS, TERM_PAIRS, workspaceFromPreset, type BusinessType, type Workspace } from '@/lib/shared';

/** First-run wizard (and "change business type"): pick a type, review modules, save. */
export default function Setup() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { ws: current } = useWorkspace();
  const [step, setStep] = useState<1 | 2>(1);
  const [draft, setDraft] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);

  if (!can('businesses.manage'))
    return (
      <Screen>
        <Txt v="title">Business setup</Txt>
        <Txt v="sub">Only the account owner can choose the business type and modules.</Txt>
      </Screen>
    );

  const pick = (type: BusinessType) => {
    const preset = workspaceFromPreset(type);
    // changing type later keeps fields and item types already in use, adding the preset's new ones
    if (current.configured) {
      const ids = new Set(current.customFields.map((f) => `${f.entity}:${f.label.toLowerCase()}`));
      preset.customFields = [...current.customFields, ...preset.customFields.filter((f) => !ids.has(`${f.entity}:${f.label.toLowerCase()}`))];
      preset.itemTypes = [...new Set([...current.itemTypes, ...preset.itemTypes])];
    }
    setDraft(preset);
    setStep(2);
  };

  async function save(ws: Workspace) {
    setBusy(true);
    try {
      const saved = await api<Workspace>('/workspace', { method: 'PUT', body: { businessType: ws.businessType, modules: ws.modules, terms: ws.terms, customFields: ws.customFields, itemTypes: ws.itemTypes } });
      setWorkspace(saved);
      toast('Tijar is set up for your business');
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (step === 1 || !draft)
    return (
      <Screen>
        <View style={{ gap: 4 }}>
          <Txt v="title">What kind of business is this?</Txt>
          <Txt v="sub">Tijar switches on the right modules, uses your words and adds useful fields. You can change all of it later.</Txt>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {BUSINESS_TYPES.map((type) => {
            const p = PRESETS[type];
            const selected = current.configured && current.businessType === type;
            return (
              <Pressable
                key={type}
                accessibilityRole="button"
                accessibilityLabel={`${p.name}: ${p.hint}`}
                onPress={() => pick(type)}
                style={({ pressed }) => ({
                  flexGrow: 1,
                  flexBasis: 150,
                  padding: 14,
                  gap: 6,
                  borderRadius: 16,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? t.primary : t.border,
                  backgroundColor: t.card,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Ionicons name={p.icon as IconName} size={26} color={t.primary} />
                <Txt style={{ fontWeight: '700' }}>{p.name}</Txt>
                <Txt v="small">{p.hint}</Txt>
              </Pressable>
            );
          })}
        </View>
        {!current.configured && <Btn kind="ghost" title="Skip for now (everything switched on)" onPress={() => save({ ...current, businessType: 'other' })} loading={busy} />}
      </Screen>
    );

  const p = PRESETS[draft.businessType];
  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Txt v="title">{p.name}</Txt>
        <Txt v="sub">Check the modules you need. Invoices and payments are always on.</Txt>
      </View>
      <Section title="Modules">
        <Card>
          {MODULES.map((m) => {
            const info = MODULE_INFO[m];
            return (
              <Row key={m} style={{ paddingVertical: 8, justifyContent: 'space-between' }}>
                <Ionicons name={info.icon as IconName} size={20} color={t.sub} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Txt style={{ fontWeight: '600' }}>{info.name}</Txt>
                  <Txt v="small">{info.hint}</Txt>
                </View>
                <Switch
                  accessibilityLabel={info.name}
                  value={draft.modules[m]}
                  disabled={!!info.core}
                  onValueChange={(v) => setDraft({ ...draft, modules: { ...draft.modules, [m]: v } })}
                />
              </Row>
            );
          })}
        </Card>
      </Section>
      <Section title="Your words">
        <Card>
          {TERM_PAIRS.map((pair) => (
            <Row key={pair.one} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Txt v="sub">{pair.label}</Txt>
              <Txt style={{ fontWeight: '600' }}>{draft.terms[pair.many]}</Txt>
            </Row>
          ))}
          <Txt v="small" style={{ marginTop: 6 }}>
            Change these any time in More › Business setup.
          </Txt>
        </Card>
      </Section>
      {draft.customFields.length > 0 && (
        <Section title="Extra fields added">
          <Card>
            <Txt v="sub">{draft.customFields.map((f) => f.label).join(' · ')}</Txt>
          </Card>
        </Section>
      )}
      <Row gap={10}>
        <Btn style={{ flex: 1 }} kind="secondary" title="Back" onPress={() => setStep(1)} />
        <Btn style={{ flex: 2 }} icon="checkmark" title="Finish setup" onPress={() => save(draft)} loading={busy} />
      </Row>
    </Screen>
  );
}
