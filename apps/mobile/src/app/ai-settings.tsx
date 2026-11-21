import { useEffect, useState } from 'react';
import { Btn, Card, Chips, Field, KV, Loader, Notice, Screen, Txt } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';

type Provider = 'anthropic' | 'openai' | 'openrouter';
interface Config {
  provider: Provider;
  model: string;
  hasKey: boolean;
  keyHint: string;
  serverKey: boolean;
  ready: boolean;
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

/** Which AI service Kaarobarly uses, with the business's own key. Owner only; needs a connection. */
export default function AiSettings() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, setData } = useApi<Config>('/ai/config');
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!data) return;
    setProvider(data.provider);
    setModel(data.provider === 'anthropic' && data.model === 'claude-opus-5-5' ? '' : data.model);
  }, [data]);

  async function save() {
    setBusy('save');
    try {
      setData(await api<Config>('/ai/config', { method: 'PUT', body: { provider, apiKey: apiKey.trim(), model: model.trim() } }));
      setApiKey('');
      toast('AI settings saved');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function test() {
    setBusy('test');
    try {
      const r = await api<{ reply: string }>('/ai/test', { method: 'POST', body: {} });
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
              <KV k="Status" v={data.ready ? 'Ready' : 'Not set up'} bold />
              <KV k="Service" v={NAMES[data.provider]} />
              {data.ready && <KV k="Model" v={data.model} />}
              {data.hasKey && <KV k="Key" v={data.keyHint} />}
              {data.serverKey && <Txt v="small">Using the key set on the server. Add your own to use your account and limits.</Txt>}
            </Card>
            <Notice>The AI reads photos you scan and a summary of your figures when you ask a question. Keys stay on the server; phones never receive them. Each use is billed by the AI service to the key's account.</Notice>
            {can('businesses.manage') ? (
              <>
                <Txt v="label">AI service</Txt>
                <Chips value={provider} onChange={setProvider} options={(Object.keys(NAMES) as Provider[]).map((p) => ({ value: p, label: NAMES[p] }))} />
                <Field label={data.hasKey && data.provider === provider ? `API key (saved ${data.keyHint}; leave empty to keep)` : 'API key'} value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} hint={KEY_HINT[provider]} />
                <Field label="Model" value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} placeholder={provider === 'anthropic' ? 'claude-opus-5-5' : ''} hint={MODEL_HINT[provider]} />
                <Btn title="Save" onPress={save} loading={busy === 'save'} />
                <Btn kind="secondary" title="Test connection" onPress={test} loading={busy === 'test'} disabled={!data.ready} />
              </>
            ) : (
              <Txt v="sub">Only the owner can change AI settings.</Txt>
            )}
          </>
        )}
      </Loader>
    </Screen>
  );
}
