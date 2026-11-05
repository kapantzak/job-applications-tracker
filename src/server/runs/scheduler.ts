import type { createSettingsRepo } from '../db/settings-repo.js';
import type { RunQueue } from './queue.js';

type SettingsRepo = ReturnType<typeof createSettingsRepo>;

export interface SyncSchedulerDeps {
  settingsRepo: Pick<SettingsRepo, 'getAll'>;
  queue: Pick<RunQueue, 'enqueue'>;
}

export interface SyncScheduler {
  start(): void;
  stop(): void;
  refresh(): void;
}

const INTERVAL_MS: Record<string, number> = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
};

export function createSyncScheduler({ settingsRepo, queue }: SyncSchedulerDeps): SyncScheduler {
  let timer: NodeJS.Timeout | null = null;
  let started = false;

  function clear(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function apply(): void {
    clear();
    const ms = INTERVAL_MS[settingsRepo.getAll().sync_interval];
    if (!ms) return;
    timer = setInterval(() => {
      try {
        queue.enqueue('sync_mail');
      } catch {
        // The queue logs its own failures; keep the interval alive.
      }
    }, ms);
    // Never keep the process alive just for the scheduler.
    timer.unref();
  }

  return {
    start() {
      if (started) return;
      started = true;
      apply();
    },
    stop() {
      started = false;
      clear();
    },
    refresh() {
      if (started) apply();
    },
  };
}
