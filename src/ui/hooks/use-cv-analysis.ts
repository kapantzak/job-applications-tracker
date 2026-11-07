import { useCallback, useEffect, useRef, useState } from 'react';
import type { CvAnalysis } from '../../server/domain/types.js';
import { getCvAnalysis } from '../api/client.js';

export const CV_POLL_MS = 1000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The one CV analysis (SOW-0023), re-read every second while the agent runs. The analysis lives on the
// server, so leaving the page loses nothing (A3).
export function useCvAnalysis() {
  const [state, setState] = useState<{ analysis: CvAnalysis | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Bumped by every local change, so a poll that was already in flight cannot bring back an older state
  // (for example a running analysis the user has just cancelled).
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const asked = generation.current;
    try {
      const analysis = await getCvAnalysis();
      if (!mounted.current || asked !== generation.current) return;
      setState({ analysis });
      setError(null);
    } catch (e) {
      if (mounted.current && asked === generation.current) setError(message(e));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const running = state?.analysis?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), CV_POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const set = useCallback((analysis: CvAnalysis | null) => {
    generation.current++;
    setState({ analysis });
  }, []);

  return { loaded: state !== null, analysis: state?.analysis ?? null, error, refresh, set };
}
