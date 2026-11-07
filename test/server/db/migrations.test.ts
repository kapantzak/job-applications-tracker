import { describe, expect, it } from 'vitest';
import type { Db } from '../../../src/server/db/connection.js';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { migrations } from '../../../src/server/db/migrations.js';

// A database as SOW-0013 left it: migrations 1 and 2 applied, nothing else.
function versionTwo(): Db {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const id of [1, 2]) {
    db.exec(migrations.find((m) => m.id === id)!.sql!);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, 't')").run(id);
  }
  return db;
}

// Two runs, three jobs, two applications, a proposal and a history row, all invented.
function populate(db: Db): void {
  db.exec(`
INSERT INTO runs (id, kind, status, adapter_id, created_at, agent_model) VALUES
  ('run-1', 'discover_jobs', 'succeeded', 'claude', '2026-11-01T00:00:00.000Z', 'sonnet'),
  ('run-2', 'sync_mail', 'succeeded', 'claude', '2026-11-02T00:00:00.000Z', NULL);
INSERT INTO jobs (id, run_id, company, title, url, canonical_url, dedupe_key, verification_status, created_at) VALUES
  ('job-b', 'run-1', 'Globex', 'SRE', 'https://globex.example/1', 'https://globex.example/1', 'k1', 'ok', 't'),
  ('job-a', 'run-1', 'Initech', 'SRE', 'https://initech.example/2', 'https://initech.example/2', 'k2', 'ok', 't'),
  ('job-c', 'run-1', 'Acme', 'SRE', 'https://acme.example/3', 'https://acme.example/3', 'k3', 'dead', 't');
INSERT INTO applications (id, job_id, company, role, status, status_changed_at, sender_domains, created_at) VALUES
  ('app-1', 'job-b', 'Globex', 'SRE', 'interview', 't', '["globex.example"]', 't'),
  ('app-2', NULL, 'Hooli', 'SRE', 'applied', 't', '[]', 't');
INSERT INTO proposals (id, run_id, application_id, proposed_status, confidence, reason, evidence, state, created_at) VALUES
  ('prop-1', 'run-2', 'app-1', 'interview', 0.9, 'invented', '{"message_id":"msg-001"}', 'accepted', 't');
INSERT INTO status_history (id, application_id, from_status, to_status, changed_at, source, proposal_id, created_at) VALUES
  ('hist-1', 'app-1', 'applied', 'interview', 't', 'proposal', 'prop-1', 't');
`);
}

function ownerIds(db: Db, table: string): string[] {
  return (db.prepare(`SELECT DISTINCT profile_id AS id FROM ${table}`).all() as { id: string }[]).map((r) => r.id);
}

describe('migrate', () => {
  it('applies every migration and creates the eight tables', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toBe(4);

    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of [
      'schema_migrations',
      'profiles',
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

  it('migrations 2 to 4 upgrade a version 1 database and leave existing runs unrecorded', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.exec(migrations.find((m) => m.id === 1)!.sql!);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (1, 't')").run();
    db.prepare(
      "INSERT INTO runs (id, kind, status, adapter_id, created_at) VALUES ('run-1', 'sync_mail', 'succeeded', 'claude', 't')",
    ).run();
    expect(migrate(db)).toBe(3);
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
    expect(() =>
      db
        .prepare("INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES ('r', 'no-such-profile', 'sync_mail', 'queued', 't')")
        .run(),
    ).toThrow('FOREIGN KEY constraint failed');
    expect(() =>
      db.prepare("INSERT INTO runs (id, kind, status, created_at) VALUES ('r', 'sync_mail', 'queued', 't')").run(),
    ).toThrow('NOT NULL constraint failed: runs.profile_id');
    db.close();
  });

  it('migration 3 turns the single profile into the first profile and gives it every existing row', () => {
    const db = versionTwo();
    db.prepare(
      `INSERT INTO profile (id, target_roles, locations, remote, seniority, keywords, excluded_companies, notes, created_at)
       VALUES (1, '["  Site Reliability Engineer "]', '["Lisbon"]', 'remote', 'senior', '["go"]', '["Initech"]', 'n', '2026-10-01T00:00:00.000Z')`,
    ).run();
    populate(db);

    expect(migrate(db)).toBe(2);

    const profiles = db.prepare('SELECT * FROM profiles').all() as Record<string, unknown>[];
    expect(profiles).toHaveLength(1);
    const profile = profiles[0]!;
    expect(profile).toMatchObject({
      name: 'Site Reliability Engineer',
      target_roles: '["  Site Reliability Engineer "]',
      locations: '["Lisbon"]',
      remote: 'remote',
      seniority: 'senior',
      keywords: '["go"]',
      excluded_companies: '["Initech"]',
      notes: 'n',
      created_at: '2026-10-01T00:00:00.000Z',
    });
    for (const table of ['runs', 'jobs', 'applications']) expect(ownerIds(db, table), table).toEqual([profile.id]);
    expect(db.prepare('SELECT id FROM jobs ORDER BY rowid').all()).toEqual([{ id: 'job-b' }, { id: 'job-a' }, { id: 'job-c' }]);
    expect(db.prepare("SELECT agent_model FROM runs WHERE id = 'run-1'").get()).toEqual({ agent_model: 'sonnet' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM proposals').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM status_history').get()).toEqual({ n: 1 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(tables).not.toContain('profile');
    expect(tables.filter((t) => t.endsWith('_new'))).toEqual([]);
    db.close();
  });

  it('migration 3 recreates the indexes, with dedupe unique per profile', () => {
    const db = versionTwo();
    migrate(db);
    const indexes = db
      .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name")
      .all();
    expect(indexes).toEqual([
      { name: 'idx_applications_job_id', tbl_name: 'applications' },
      { name: 'idx_applications_profile_id', tbl_name: 'applications' },
      { name: 'idx_applications_status', tbl_name: 'applications' },
      { name: 'idx_jobs_profile_dedupe_key', tbl_name: 'jobs' },
      { name: 'idx_jobs_run_id', tbl_name: 'jobs' },
      { name: 'idx_profiles_name', tbl_name: 'profiles' },
      { name: 'idx_profiles_slug', tbl_name: 'profiles' },
      { name: 'idx_proposals_application_id', tbl_name: 'proposals' },
      { name: 'idx_proposals_state', tbl_name: 'proposals' },
      { name: 'idx_runs_profile_id', tbl_name: 'runs' },
      { name: 'idx_runs_status', tbl_name: 'runs' },
      { name: 'idx_status_history_application_id', tbl_name: 'status_history' },
    ]);
    db.close();
  });

  it('migration 3 gives data without a profile to a profile named Default', () => {
    const db = versionTwo();
    populate(db);
    migrate(db);
    const profiles = db.prepare('SELECT id, name, target_roles FROM profiles').all() as { id: string }[];
    expect(profiles).toEqual([{ id: expect.any(String), name: 'Default', target_roles: '[]' }]);
    for (const table of ['runs', 'jobs', 'applications']) expect(ownerIds(db, table), table).toEqual([profiles[0]!.id]);
    db.close();
  });

  it('migration 3 names a profile without target roles Default', () => {
    const db = versionTwo();
    db.prepare("INSERT INTO profile (id, created_at) VALUES (1, 't')").run();
    migrate(db);
    expect(db.prepare('SELECT name FROM profiles').all()).toEqual([{ name: 'Default' }]);
    db.close();
  });

  it('migration 3 creates no profile on an empty database', () => {
    const db = versionTwo();
    migrate(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM profiles').get()).toEqual({ n: 0 });
    db.close();
  });

  it('migration 3 rolls back and restores foreign keys when it would leave broken references', () => {
    const db = versionTwo();
    populate(db);
    // A dangling reference that only the integrity check catches.
    db.pragma('foreign_keys = OFF');
    db.prepare(
      "INSERT INTO jobs (id, run_id, company, title, url, canonical_url, dedupe_key, verification_status, created_at) VALUES ('job-x', 'no-such-run', 'c', 't', 'u', 'u', 'kx', 'ok', 't')",
    ).run();
    db.pragma('foreign_keys = ON');

    expect(() => migrate(db)).toThrow('Migration 3 left 1 broken foreign key references');
    expect(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(tables).toContain('profile');
    expect(tables).not.toContain('profiles');
    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 4 });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('migration 4 keeps valid names, cleans and numbers invalid ones, and gives every profile a unique slug', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const m of migrations.filter((x) => x.id <= 3)) {
      if (m.sql) db.exec(m.sql);
      if (m.up) {
        db.pragma('foreign_keys = OFF');
        m.up(db);
        db.pragma('foreign_keys = ON');
      }
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, 't')").run(m.id);
    }
    const add = db.prepare("INSERT INTO profiles (id, name, created_at) VALUES (?, ?, 't')");
    // rowid order decides who keeps a clean name or slug.
    add.run('p1', 'SRE / Platform');
    add.run('p2', 'SRE Platform');
    add.run('p3', '!!!');
    add.run('p4', 'Café');
    add.run('p5', 'Cafe');
    add.run('p6', 'New');

    expect(migrate(db)).toBe(1);

    expect(db.prepare('SELECT id, name, slug FROM profiles ORDER BY rowid').all()).toEqual([
      { id: 'p1', name: 'SRE Platform 2', slug: 'sre-platform-2' },
      { id: 'p2', name: 'SRE Platform', slug: 'sre-platform' },
      { id: 'p3', name: 'Profile', slug: 'profile' },
      { id: 'p4', name: 'Café', slug: 'cafe' },
      { id: 'p5', name: 'Cafe', slug: 'cafe-2' },
      { id: 'p6', name: 'New', slug: 'new-2' },
    ]);
    expect(() => db.prepare("UPDATE profiles SET slug = 'cafe' WHERE id = 'p5'").run()).toThrow(/UNIQUE/);
    db.close();
  });
});
