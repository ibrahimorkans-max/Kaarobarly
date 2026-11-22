import { useEffect, useState } from 'react';
import { Btn, Card, Chips, Empty, Field, KV, Loader, Notice, Screen, Txt, fd } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { PLANS, PLAN_IDS } from '@/lib/shared';

type Provider = 'anthropic' | 'openai' | 'openrouter';
interface Config {
  provider: Provider;
  model: string;
  hasKey: boolean;
  keyHint: string;
  serverKey: boolean;
  ready: boolean;
  updatedBy: string;
  updatedAt: string;
}
const NAMES: Record<Provider, string> = { anthropic: 'Claude (Anthropic)', openai: 'OpenAI', openrouter: 'OpenRouter' };
const KEY_HINT: Record<Provider, string> = {
  anthropic: 'From console.anthropic.com › API keys (starts with sk-ant-)',
  openai: 'From platform.openai.com › API keys',
  openrouter: 'From openrouter.ai › Keys (one key, many models)',
};
const MODEL_HINT: Record<Provider, string> = {
  anthropic: 'Leave empty for claude-opus-5-5',
  openai: 'The model name from your OpenAI account',
  openrouter: 'A model id from openrouter.ai/models, e.g. provider/model-name',
};

/** SaaS owner only: the one AI service every account uses, within its plan's monthly allowance. */
export default function AdminAi() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload, setData } = useApi<Config>(user?.isPlatformAdmin ? '/platform/ai' : null);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!data) return;
    setProvider(data.provider);
    setModel(data.provider === 'anthropic' && data.model === 'claude-opus-5-5' ? '' : data.model);
  }, [data]);

  if (!user?.isPlatformAdmin)
    return (
      <Screen>
        <Empty icon="lock-closed-outline" title="Not available" />
      </Screen>
    );

  async function save() {
    setBusy('save');
    try {
      setData(await api<Config>('/platform/ai', { method: 'PUT', body: { provider, apiKey: apiKey.trim(), model: model.trim() } }));
      setApiKey('');
      toast('AI service saved for every account');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function test() {
    setBusy('test');
    try {
      const r = await api<{ reply: string }>('/platform/ai/test', { method: 'POST', body: {} });
      toast(`Connected · the AI replied “${r.reply.slice(0, 40)}”`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <Screen>
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && (
          <>
            <Card>
              <KV k="Status" v={data.ready ? 'Ready for all accounts' : 'Not set up'} bold />
              <KV k="Service" v={NAMES[data.provider]} />
              {data.ready && <KV k="Model" v={data.model} />}
              {data.hasKey && <KV k="Key" v={data.keyHint} />}
              {!!data.updatedBy && <KV k="Last changed" v={`${data.updatedBy} · ${fd(data.updatedAt.slice(0, 10))}`} />}
              {data.serverKey && <Txt v="small">Using the key from the server's .env until you save one here.</Txt>}
            </Card>
            <Notice>Customers never see this screen or the key. They get AI (questions, bill scanning, quick entry) only when it is set up here and their plan includes it. Every use is billed to this key's account.</Notice>
            <Card>
              <Txt v="label">AI requests per month by plan</Txt>
              {PLAN_IDS.map((p) => (
                <KV key={p} k={PLANS[p].name} v={PLANS[p].limits.aiPerMonth ? String(PLANS[p].limits.aiPerMonth) : 'No AI'} />
              ))}
            </Card>
            <Txt v="label">AI service</Txt>
            <Chips value={provider} onChange={setProvider} options={(Object.keys(NAMES) as Provider[]).map((p) => ({ value: p, label: NAMES[p] }))} />
            <Field label={data.hasKey && data.provider === provider ? `API key (saved ${data.keyHint}; leave empty to keep)` : 'API key'} value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} hint={KEY_HINT[provider]} />
            <Field label="Model" value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} placeholder={provider === 'anthropic' ? 'claude-opus-5-5' : ''} hint={MODEL_HINT[provider]} />
            <Btn title="Save" onPress={save} loading={busy === 'save'} />
            <Btn kind="secondary" title="Test connection" onPress={test} loading={busy === 'test'} disabled={!data.ready} />
          </>
        )}
      </Loader>
    </Screen>
  );
}
