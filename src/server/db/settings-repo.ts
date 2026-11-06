import type { Settings } from '../domain/types.js';
import type { Db } from './connection.js';

export const DEFAULT_SETTINGS: Settings = {
  adapter_id: 'claude',
  custom_command: '',
  permission_mode_discover: 'default',
  permission_mode_sync: 'default',
  allowed_tools_discover: 'WebSearch,WebFetch',
  allowed_tools_sync:
    'mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Gmail__get_message',
  sandbox_discover: 'read-only',
  sandbox_sync: 'read-only',
  run_timeout_ms: 600000,
  sync_interval: 'off',
  port: 4173,
};

export function createSettingsRepo(db: Db) {
  const selectAll = db.prepare('SELECT key, value FROM settings');
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );

  function getAll(): Settings {
    const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of selectAll.all() as { key: string; value: string }[]) {
      // Unknown keys in the table are ignored.
      if (Object.hasOwn(DEFAULT_SETTINGS, row.key)) result[row.key] = JSON.parse(row.value);
    }
    return result as unknown as Settings;
  }

  function set(patch: Partial<Settings>): Settings {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    // Validate all keys first so a bad patch writes nothing.
    for (const [key] of entries) {
      if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new Error(`Unknown setting: ${key}`);
    }
    db.transaction(() => {
      for (const [key, value] of entries) upsert.run(key, JSON.stringify(value));
    })();
    return getAll();
  }

  return { getAll, set };
}
