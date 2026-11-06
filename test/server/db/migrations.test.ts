import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';

describe('migrate', () => {
  it('applies migration 1 and creates the eight tables', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toBe(1);

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
