import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { DEFAULT_SETTINGS, createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import type { Settings } from '../../../src/server/domain/types.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  return { db, repo: createSettingsRepo(db) };
}

describe('settings repo', () => {
  it('returns defaults on an empty database', () => {
    const { repo } = setup();
    expect(repo.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it('has the documented defaults', () => {
    expect(DEFAULT_SETTINGS.port).toBe(4173);
    expect(DEFAULT_SETTINGS.run_timeout_ms).toBe(1200000);
    expect(DEFAULT_SETTINGS.allowed_tools_discover).toBe('WebSearch,WebFetch');
  });

  it('persists a patch and leaves other defaults', () => {
    const { repo } = setup();
    const result = repo.set({ port: 5000 });
    expect(result).toEqual({ ...DEFAULT_SETTINGS, port: 5000 });
    expect(repo.getAll()).toEqual({ ...DEFAULT_SETTINGS, port: 5000 });
  });

  it('stores values JSON-encoded', () => {
    const { db, repo } = setup();
    repo.set({ port: 5000, adapter_id: 'codex' });
    const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
    expect(rows).toEqual([
      { key: 'adapter_id', value: '"codex"' },
      { key: 'port', value: '5000' },
    ]);
  });

  it('throws on an unknown key and writes nothing', () => {
    const { db, repo } = setup();
    expect(() => repo.set({ port: 1, bogus: 1 } as Partial<Settings>)).toThrow(
      'Unknown setting: bogus',
    );
    expect((db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number }).n).toBe(0);
  });

  it('ignores unknown keys found in the table', () => {
    const { db, repo } = setup();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('legacy', '"x"');
    expect(repo.getAll()).toEqual(DEFAULT_SETTINGS);
  });
});
