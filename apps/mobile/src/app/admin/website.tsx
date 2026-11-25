import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, Switch, View } from 'react-native';
import { Btn, Card, Chips, Field, Loader, Notice, Row, Screen, Txt } from '@/components/ui';
import { API_URL, api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { PLANS, PLAN_IDS } from '@/lib/shared';

type Item = Record<string, string>;
interface Site {
  seo: { title: string; description: string };
  announcement: { show: boolean; text: string; href: string };
  hero: { eyebrow: string; title: string; highlight: string; subtitle: string; primary: { label: string; href: string }; secondary: { label: string; href: string } };
  stats: Item[];
  features: Item[];
  businessTypes: Item[];
  steps: Item[];
  pricing: { title: string; subtitle: string; note: string; highlight: string };
  testimonials: Item[];
  faq: Item[];
  download: { title: string; subtitle: string; android: string; windows: string; web: string };
  contact: { title: string; subtitle: string; email: string; phone: string; whatsapp: string; address: string };
  social: Record<string, string>;
  sections: Record<string, boolean>;
}

const SECTIONS: [string, string][] = [
  ['stats', 'Numbers strip'],
  ['features', 'Features'],
  ['showcase', '3D phone: how it works'],
  ['businessTypes', 'Business types ring'],
  ['steps', 'Three steps'],
  ['pricing', 'Pricing'],
  ['testimonials', 'Testimonials'],
  ['faq', 'Questions'],
  ['download', 'Download'],
  ['contact', 'Contact form'],
];

/** A card that opens and closes, so the long editor stays easy to scan. */
function Part({ title, icon, open, onToggle, children }: { title: string; icon: React.ComponentProps<typeof Ionicons>['name']; open: boolean; onToggle: () => void; children: ReactNode }) {
  const th = useTheme();
  return (
    <Card style={{ gap: open ? 12 : 0 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: th.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={19} color={th.primary} />
        </View>
        <Txt style={{ flex: 1, fontWeight: '800', fontSize: 16 }}>{title}</Txt>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={th.sub} />
      </Pressable>
      {open && children}
    </Card>
  );
}

/** Edit a list of small records: add, remove and move up. */
function ListEditor({ items, onChange, fields, blank, max, iconChoices }: { items: Item[]; onChange: (v: Item[]) => void; fields: { key: string; label: string; multiline?: boolean; placeholder?: string }[]; blank: Item; max: number; iconChoices?: string[] }) {
  const th = useTheme();
  const set = (i: number, k: string, v: string) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  return (
    <View style={{ gap: 12 }}>
      {items.map((it, i) => (
        <View key={i} style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: th.border }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="small" style={{ fontWeight: '800' }}>#{i + 1}</Txt>
            <Row gap={4}>
              {i > 0 && <Btn small kind="ghost" icon="arrow-up" title="Up" onPress={() => onChange(items.map((x, j) => (j === i - 1 ? items[i] : j === i ? items[i - 1] : x)))} />}
              <Btn small kind="ghost" icon="trash-outline" title="Remove" onPress={() => onChange(items.filter((_, j) => j !== i))} />
            </Row>
          </Row>
          {iconChoices && <Chips options={iconChoices.map((c) => ({ value: c, label: c }))} value={it.icon ?? iconChoices[0]} onChange={(v) => set(i, 'icon', v)} />}
          {fields.map((f) => (
            <Field key={f.key} label={f.label} value={it[f.key] ?? ''} onChangeText={(v) => set(i, f.key, v)} multiline={f.multiline} placeholder={f.placeholder} />
          ))}
        </View>
      ))}
      {items.length < max && <Btn small kind="secondary" icon="add" title="Add" onPress={() => onChange([...items, { ...blank }])} />}
    </View>
  );
}

/** SaaS owner: every word, link and section of the public website. */
export default function WebsiteEditor() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<{ content: Site; icons: string[]; leads: number }>(user?.isPlatformAdmin ? '/platform/site' : null);
  const [s, setS] = useState<Site | null>(null);
  const [open, setOpen] = useState('hero');
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.content) {
      setS(data.content);
      setDirty(false);
    }
  }, [data]);

  if (!user?.isPlatformAdmin) return <Screen>{null}</Screen>;
  const edit = (fn: (c: Site) => Site) => {
    setS((c) => (c ? fn(c) : c));
    setDirty(true);
  };
  const part = (key: keyof Site) => <K extends string>(k: K, v: unknown) => edit((c) => ({ ...c, [key]: { ...(c[key] as object), [k]: v } }));
  const toggle = (k: string) => setOpen(open === k ? '' : k);

  async function save() {
    if (!s) return;
    setBusy('save');
    try {
      const saved = await api<Site>('/platform/site', { method: 'PUT', body: s });
      setS(saved);
      setDirty(false);
      toast('Website saved and live');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function reset() {
    setBusy('reset');
    try {
      setS(await api<Site>('/platform/site/reset', { body: {} }));
      setDirty(false);
      toast('Back to the starting text');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const seo = part('seo'), ann = part('announcement'), hero = part('hero'), pricing = part('pricing'), dl = part('download'), contact = part('contact'), social = part('social'), sections = part('sections');

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Website' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {s && (
          <>
            <Row gap={10}>
              <Btn style={{ flex: 1 }} icon="open-outline" kind="secondary" title="Open website" onPress={() => Linking.openURL(`${API_URL}/`)} />
              <Btn style={{ flex: 1 }} icon="mail-unread-outline" kind="secondary" title={`Leads${data?.leads ? ` (${data.leads} new)` : ''}`} onPress={() => router.push('/admin/leads')} />
            </Row>
            {dirty && <Notice kind="warn">You have changes that are not on the website yet. Tap Save.</Notice>}

            <Part title="Page title (Google and sharing)" icon="search-outline" open={open === 'seo'} onToggle={() => toggle('seo')}>
              <Field label="Title" value={s.seo.title} onChangeText={(v) => seo('title', v)} />
              <Field label="Description" value={s.seo.description} onChangeText={(v) => seo('description', v)} multiline />
            </Part>

            <Part title="Announcement bar" icon="megaphone-outline" open={open === 'ann'} onToggle={() => toggle('ann')}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt>Show the bar at the top</Txt>
                <Switch accessibilityLabel="Show announcement" value={s.announcement.show} onValueChange={(v) => ann('show', v)} />
              </Row>
              <Field label="Text" value={s.announcement.text} onChangeText={(v) => ann('text', v)} placeholder="New: …" />
              <Field label="Link" value={s.announcement.href} onChangeText={(v) => ann('href', v)} autoCapitalize="none" placeholder="#pricing or https://…" />
            </Part>

            <Part title="Top of the page" icon="sparkles-outline" open={open === 'hero'} onToggle={() => toggle('hero')}>
              <Field label="Small label" value={s.hero.eyebrow} onChangeText={(v) => hero('eyebrow', v)} placeholder="Business app for Pakistan" />
              <Field label="Headline" value={s.hero.title} onChangeText={(v) => hero('title', v)} placeholder="Every business move," />
              <Field label="Headline, glowing part" value={s.hero.highlight} onChangeText={(v) => hero('highlight', v)} placeholder="made smarter." />
              <Field label="Sentence under it" value={s.hero.subtitle} onChangeText={(v) => hero('subtitle', v)} multiline />
              <Row gap={10} style={{ alignItems: 'flex-start' }}>
                <Field style={{ flex: 1 }} label="Main button" value={s.hero.primary.label} onChangeText={(v) => hero('primary', { ...s.hero.primary, label: v })} />
                <Field style={{ flex: 1.3 }} label="Its link" value={s.hero.primary.href} onChangeText={(v) => hero('primary', { ...s.hero.primary, href: v })} autoCapitalize="none" placeholder="#download" />
              </Row>
              <Row gap={10} style={{ alignItems: 'flex-start' }}>
                <Field style={{ flex: 1 }} label="Second button" value={s.hero.secondary.label} onChangeText={(v) => hero('secondary', { ...s.hero.secondary, label: v })} />
                <Field style={{ flex: 1.3 }} label="Its link" value={s.hero.secondary.href} onChangeText={(v) => hero('secondary', { ...s.hero.secondary, href: v })} autoCapitalize="none" placeholder="#features" />
              </Row>
            </Part>

            <Part title="Sections on the page" icon="layers-outline" open={open === 'sections'} onToggle={() => toggle('sections')}>
              {SECTIONS.map(([k, label]) => (
                <Row key={k} style={{ justifyContent: 'space-between' }}>
                  <Txt style={{ flex: 1 }}>{label}</Txt>
                  <Switch accessibilityLabel={label} value={s.sections[k] !== false} onValueChange={(v) => sections(k, v)} />
                </Row>
              ))}
            </Part>

            <Part title="Numbers" icon="stats-chart-outline" open={open === 'stats'} onToggle={() => toggle('stats')}>
              <ListEditor items={s.stats} onChange={(v) => edit((c) => ({ ...c, stats: v }))} max={6} blank={{ value: '', label: '' }} fields={[{ key: 'value', label: 'Number', placeholder: '10,000+' }, { key: 'label', label: 'What it counts', placeholder: 'Invoices every day' }]} />
            </Part>

            <Part title="Features" icon="grid-outline" open={open === 'features'} onToggle={() => toggle('features')}>
              <ListEditor items={s.features} onChange={(v) => edit((c) => ({ ...c, features: v }))} max={12} blank={{ icon: 'bolt', title: '', text: '' }} iconChoices={data?.icons} fields={[{ key: 'title', label: 'Title' }, { key: 'text', label: 'Text', multiline: true }]} />
            </Part>

            <Part title="Business types" icon="storefront-outline" open={open === 'types'} onToggle={() => toggle('types')}>
              <ListEditor items={s.businessTypes} onChange={(v) => edit((c) => ({ ...c, businessTypes: v }))} max={12} blank={{ name: '', text: '' }} fields={[{ key: 'name', label: 'Name' }, { key: 'text', label: 'Examples' }]} />
            </Part>

            <Part title="Three steps" icon="footsteps-outline" open={open === 'steps'} onToggle={() => toggle('steps')}>
              <ListEditor items={s.steps} onChange={(v) => edit((c) => ({ ...c, steps: v }))} max={5} blank={{ title: '', text: '' }} fields={[{ key: 'title', label: 'Title' }, { key: 'text', label: 'Text', multiline: true }]} />
            </Part>

            <Part title="Pricing" icon="pricetags-outline" open={open === 'pricing'} onToggle={() => toggle('pricing')}>
              <Txt v="small">Plan names and prices come from the plans themselves. Here you set the words around them.</Txt>
              <Field label="Heading" value={s.pricing.title} onChangeText={(v) => pricing('title', v)} />
              <Field label="Under the heading" value={s.pricing.subtitle} onChangeText={(v) => pricing('subtitle', v)} />
              <Field label="Small print" value={s.pricing.note} onChangeText={(v) => pricing('note', v)} />
              <Txt v="label">Most popular plan</Txt>
              <Chips options={PLAN_IDS.map((p) => ({ value: p, label: PLANS[p].name }))} value={s.pricing.highlight as (typeof PLAN_IDS)[number]} onChange={(v) => pricing('highlight', v)} />
            </Part>

            <Part title="Testimonials" icon="chatbox-ellipses-outline" open={open === 'love'} onToggle={() => toggle('love')}>
              <ListEditor items={s.testimonials} onChange={(v) => edit((c) => ({ ...c, testimonials: v }))} max={12} blank={{ name: '', role: '', quote: '' }} fields={[{ key: 'name', label: 'Name' }, { key: 'role', label: 'Business and city' }, { key: 'quote', label: 'What they said', multiline: true }]} />
            </Part>

            <Part title="Questions" icon="help-circle-outline" open={open === 'faq'} onToggle={() => toggle('faq')}>
              <ListEditor items={s.faq} onChange={(v) => edit((c) => ({ ...c, faq: v }))} max={20} blank={{ q: '', a: '' }} fields={[{ key: 'q', label: 'Question' }, { key: 'a', label: 'Answer', multiline: true }]} />
            </Part>

            <Part title="Download links" icon="download-outline" open={open === 'download'} onToggle={() => toggle('download')}>
              <Field label="Heading" value={s.download.title} onChangeText={(v) => dl('title', v)} />
              <Field label="Under the heading" value={s.download.subtitle} onChangeText={(v) => dl('subtitle', v)} />
              <Field label="Android app link" value={s.download.android} onChangeText={(v) => dl('android', v)} autoCapitalize="none" placeholder="https://play.google.com/… or /downloads/tijar.apk" />
              <Field label="Windows app link" value={s.download.windows} onChangeText={(v) => dl('windows', v)} autoCapitalize="none" placeholder="https://…/Tijar-Setup.exe" />
              <Field label="Web app link" value={s.download.web} onChangeText={(v) => dl('web', v)} autoCapitalize="none" placeholder="https://app.example.com" />
              <Txt v="small">Empty links are hidden; with none, the button asks visitors to request access.</Txt>
            </Part>

            <Part title="Contact details" icon="call-outline" open={open === 'contact'} onToggle={() => toggle('contact')}>
              <Field label="Heading" value={s.contact.title} onChangeText={(v) => contact('title', v)} />
              <Field label="Under the heading" value={s.contact.subtitle} onChangeText={(v) => contact('subtitle', v)} multiline />
              <Field label="Email (new leads are emailed here too)" value={s.contact.email} onChangeText={(v) => contact('email', v)} keyboardType="email-address" autoCapitalize="none" placeholder="hello@example.com" />
              <Field label="Phone" value={s.contact.phone} onChangeText={(v) => contact('phone', v)} keyboardType="phone-pad" placeholder="0300 1234567" />
              <Field label="WhatsApp" value={s.contact.whatsapp} onChangeText={(v) => contact('whatsapp', v)} keyboardType="phone-pad" placeholder="0300 1234567" />
              <Field label="Address" value={s.contact.address} onChangeText={(v) => contact('address', v)} multiline />
            </Part>

            <Part title="Social links" icon="share-social-outline" open={open === 'social'} onToggle={() => toggle('social')}>
              {(['facebook', 'instagram', 'linkedin', 'youtube', 'x', 'tiktok'] as const).map((k) => (
                <Field key={k} label={k === 'x' ? 'X (Twitter)' : k[0].toUpperCase() + k.slice(1)} value={s.social[k] ?? ''} onChangeText={(v) => social(k, v)} autoCapitalize="none" placeholder={`https://${k === 'x' ? 'x' : k}.com/…`} />
              ))}
            </Part>

            <Btn icon="cloud-upload-outline" title="Save and publish" loading={busy === 'save'} onPress={save} />
            <Btn kind="ghost" title="Reset to the starting text" loading={busy === 'reset'} onPress={reset} />
          </>
        )}
      </Loader>
    </Screen>
  );
}
