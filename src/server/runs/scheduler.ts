import type { createSettingsRepo } from '../db/settings-repo.js';
import type { RunQueue } from './queue.js';

type SettingsRepo = ReturnType<typeof createSettingsRepo>;

export interface SyncSchedulerDeps {
  settingsRepo: Pick<SettingsRepo, 'getAll'>;
  queue: Pick<RunQueue, 'enqueue'>;
  // Profiles worth syncing on each tick: those with open applications (SOW-0014).
  syncProfileIds: () => string[];
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

export function createSyncScheduler({ settingsRepo, queue, syncProfileIds }: SyncSchedulerDeps): SyncScheduler {
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
      let ids: string[];
      try {
        ids = syncProfileIds();
      } catch (err) {
        console.error(`sync scheduler: could not list profiles: ${err instanceof Error ? err.message : err}`);
        return;
      }
      for (const id of ids) {
        try {
          queue.enqueue('sync_mail', id);
        } catch {
          // The queue logs its own failures; one profile must not block the others.
        }
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
