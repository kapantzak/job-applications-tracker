import { z } from 'zod';
import type { UpdateStatus } from './domain/types.js';

// Update check (SOW-0053): the only request the app makes on its own behalf. It sends no user data.
export const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/job-applications-tracker/latest';

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 5_000;

const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export type { UpdateStatus };

// Only plain x.y.z versions take part: prereleases are never offered and never compared (decision 6A).
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = PLAIN_VERSION.exec(candidate);
  const b = PLAIN_VERSION.exec(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(a[i]) - Number(b[i]);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

const LatestManifest = z.object({ version: z.string().regex(PLAIN_VERSION) });

// Resolves to null on any failure: an update check must never surface an error.
export async function fetchLatestVersion(
  opts: { url?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(opts.url ?? REGISTRY_LATEST_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = LatestManifest.safeParse(await res.json());
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
}

export function formatUpdateNotice(current: string, latest: string): string {
  return (
    `Job Applications Tracker ${latest} is available (you have ${current}). ` +
    'Update with "npm i -g job-applications-tracker@latest" or run "npx job-applications-tracker@latest", ' +
    'then restart the app.\n'
  );
}

export interface UpdateCheckerDeps {
  currentVersion: string;
  // The `update_check` setting, re-read on every decision.
  enabled: () => boolean;
  env: NodeJS.ProcessEnv;
  fetchLatest?: () => Promise<string | null>;
  onUpdateAvailable?: (current: string, latest: string) => void;
  firstDelayMs?: number;
  intervalMs?: number;
}

export interface UpdateChecker {
  start(): void;
  stop(): void;
  // Called after a settings change: starts or stops checking to match `update_check`.
  refresh(): void;
  status(): UpdateStatus;
}

export function createUpdateChecker(deps: UpdateCheckerDeps): UpdateChecker {
  const fetchLatest = deps.fetchLatest ?? (() => fetchLatestVersion());
  const firstDelayMs = deps.firstDelayMs ?? FIRST_CHECK_DELAY_MS;
  const intervalMs = deps.intervalMs ?? CHECK_INTERVAL_MS;
  // Same convention as the update-notifier package: any value turns the check off.
  const envOff = deps.env.NO_UPDATE_NOTIFIER !== undefined;

  let started = false;
  let firstTimer: NodeJS.Timeout | null = null;
  let intervalTimer: NodeJS.Timeout | null = null;
  let latest: string | null = null;
  let announced: string | null = null;
  // Bumped whenever checking stops, so a request still in flight cannot write a stale result.
  let generation = 0;
  // The generation of the request in flight, if any; one from before a stop never blocks a new check.
  let inFlight: number | null = null;

  const active = (): boolean => started && !envOff && deps.enabled();

  async function check(): Promise<void> {
    const gen = generation;
    if (inFlight === gen) return;
    inFlight = gen;
    try {
      const found = await fetchLatest();
      if (gen !== generation || !active() || found === null) return;
      latest = found;
      if (isNewerVersion(found, deps.currentVersion) && found !== announced) {
        announced = found;
        deps.onUpdateAvailable?.(deps.currentVersion, found);
      }
    } catch {
      // Called without await from timers: a throwing setting read or notice must not end the process.
    } finally {
      if (inFlight === gen) inFlight = null;
    }
  }

  function schedule(): void {
    if (firstTimer || intervalTimer) return;
    firstTimer = setTimeout(() => {
      firstTimer = null;
      void check();
      intervalTimer = setInterval(() => void check(), intervalMs);
      intervalTimer.unref();
    }, firstDelayMs);
    // Never keep the process alive just for the update check.
    firstTimer.unref();
  }

  function halt(): void {
    if (firstTimer) clearTimeout(firstTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    firstTimer = null;
    intervalTimer = null;
    generation++;
    latest = null;
  }

  return {
    start() {
      if (started) return;
      started = true;
      if (active()) schedule();
    },
    stop() {
      started = false;
      halt();
    },
    refresh() {
      if (!started) return;
      if (active()) schedule();
      else halt();
    },
    status() {
      const known = active() ? latest : null;
      return {
        current: deps.currentVersion,
        latest: known,
        available: known !== null && isNewerVersion(known, deps.currentVersion),
      };
    },
  };
}
