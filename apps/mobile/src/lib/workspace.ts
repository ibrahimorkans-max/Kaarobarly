import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { engine } from './engine';
import { setPrintFields } from './pdf';
import { defaultWorkspace, type FieldEntity, type ModuleKey, type TermKey, type Workspace } from './shared';

/**
 * The business's setup (type, modules, wording, custom fields), shared by every screen.
 * Loaded once after sign-in and whenever a sync brings new data; saving updates it everywhere.
 */
let current: Workspace = defaultWorkspace();
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setWorkspace(ws: Workspace) {
  current = ws;
  setPrintFields(ws.customFields);
  loaded = true;
  emit();
}

export function loadWorkspace(): Promise<void> {
  loading ??= api<Workspace>('/workspace')
    .then(setWorkspace)
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function resetWorkspace() {
  current = defaultWorkspace();
  setPrintFields([]);
  loaded = false;
  emit();
}

engine.onData(() => void loadWorkspace());

export function useWorkspace() {
  const ws = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => current,
  );
  useEffect(() => {
    if (!loaded) void loadWorkspace();
  }, []);
  /** what this business calls something, e.g. t('clients') → "Patients" */
  const t = useCallback((k: TermKey) => ws.terms[k], [ws]);
  /** is a module switched on */
  const on = useCallback((m: ModuleKey) => ws.modules[m], [ws]);
  const fields = useCallback((e: FieldEntity) => ws.customFields.filter((f) => f.entity === e), [ws]);
  return { ws, loaded, t, on, fields, reload: loadWorkspace };
}

/** "Clients" → "clients" for use inside sentences. */
export const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
