import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Whether this account can use AI right now (the service is set up by the SaaS owner and the
 * plan includes AI). AI buttons are hidden when it cannot; offline counts as not available.
 */
export interface AiStatus {
  available: boolean;
  allowance: number;
  used: number;
}
let cached: { at: number; value: AiStatus } | null = null;

export function useAiStatus(): AiStatus | null {
  const [s, setS] = useState<AiStatus | null>(cached?.value ?? null);
  useEffect(() => {
    if (cached && Date.now() - cached.at < 60_000) return;
    let alive = true;
    api<AiStatus>('/ai/status')
      .then((v) => {
        cached = { at: Date.now(), value: v };
        if (alive) setS(v);
      })
      .catch(() => alive && setS({ available: false, allowance: 0, used: 0 }));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}
