import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { migrations } from '../../../src/server/db/migrations.js';

describe('migrate', () => {
  it('applies every migration and creates the eight tables', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toBe(2);

    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of [
      'schema_migrations',
      'profile',
      'settings',
      'runs',
      'jobs',
      'applications',
      'status_history',
      'proposals',
    ]) {
      expect(names).toContain(t);
    }
    db.close();
  });

  it('migration 2 adds nullable agent model and effort columns to runs', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const cols = (db.prepare('PRAGMA table_info(runs)').all() as { name: string; notnull: number }[]).filter((c) =>
      ['agent_model', 'agent_effort', 'agent_model_reported'].includes(c.name),
    );
    expect(cols.map((c) => [c.name, c.notnull])).toEqual([
      ['agent_model', 0],
      ['agent_effort', 0],
      ['agent_model_reported', 0],
    ]);
    db.close();
  });

  it('migration 2 upgrades a version 1 database and leaves existing runs unrecorded', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.exec(migrations.find((m) => m.id === 1)!.sql);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (1, 't')").run();
    db.prepare(
      "INSERT INTO runs (id, kind, status, adapter_id, created_at) VALUES ('run-1', 'sync_mail', 'succeeded', 'claude', 't')",
    ).run();
    expect(migrate(db)).toBe(1);
    expect(
      db.prepare('SELECT adapter_id, agent_model, agent_effort, agent_model_reported FROM runs').get(),
    ).toEqual({ adapter_id: 'claude', agent_model: null, agent_effort: null, agent_model_reported: null });
    db.close();
  });

  it('is idempotent: a second call applies nothing', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(migrate(db)).toBe(0);
    db.close();
  });

  it('enforces enum CHECK constraints and foreign keys', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO runs (kind, status, started_at, created_at) VALUES ('discover_jobs','bogus','t','t')",
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO jobs (run_id, company, title, url, canonical_url, dedupe_key, verification_status, created_at) VALUES (999,'c','t','u','u','k','ok','t')",
        )
        .run(),
    ).toThrow();
    db.close();
  });
});
