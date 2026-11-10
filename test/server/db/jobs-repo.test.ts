import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createJobsRepo, type NewJob } from '../../../src/server/db/jobs-repo.js';
import { insertTestProfile } from './test-profile.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  // jobs.run_id and jobs.profile_id are foreign keys.
  const pid = insertTestProfile(db);
  const now = new Date().toISOString();
  const runId = randomUUID();
  db.prepare(
    "INSERT INTO runs (id, profile_id, kind, status, started_at, created_at) VALUES (?, ?, 'discover_jobs', 'succeeded', ?, ?)",
  ).run(runId, pid, now, now);
  return { db, pid, runId, repo: createJobsRepo(db) };
}

function newJob(n: number, over: Partial<NewJob> = {}): NewJob {
  return {
    company: `Co ${n}`,
    title: `Engineer ${n}`,
    location: null,
    remote: 'remote',
    url: `https://example.com/jobs/${n}?utm=x`,
    canonical_url: `https://example.com/jobs/${n}`,
    source_site: 'example.com',
    posted_at: null,
    salary: null,
    description_excerpt: null,
    fit_checks: null,
    match_reason: null,
    verification_status: 'ok',
    verified_at: null,
    dedupe_key: `key-${n}`,
    ...over,
  };
}

describe('jobs repo', () => {
  it('inserts jobs and lists them newest first', () => {
    const { repo, runId, pid } = setup();
    const inserted = repo.insertMany(runId, [newJob(1), newJob(2)]);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ run_id: runId, dismissed_at: null });
    expect(repo.list(pid).map((j) => j.company)).toEqual(['Co 2', 'Co 1']);
  });

  it('skips existing dedupe keys across and within batches', () => {
    const { repo, runId, db, pid } = setup();
    repo.insertMany(runId, [newJob(1)]);
    expect(repo.insertMany(runId, [newJob(9, { dedupe_key: 'key-1' })])).toEqual([]);
    const dup = repo.insertMany(runId, [newJob(2), newJob(3, { dedupe_key: 'key-2' })]);
    expect(dup.map((j) => j.company)).toEqual(['Co 2']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 2 });
    expect(repo.existingDedupeKeys(pid)).toEqual(new Set(['key-1', 'key-2']));
  });

  it('hides dead and dismissed jobs unless asked', () => {
    const { repo, runId, pid } = setup();
    const [a, b] = repo.insertMany(runId, [
      newJob(1, { verification_status: 'dead' }),
      newJob(2),
    ]);
    repo.insertMany(runId, [newJob(3)]);
    repo.dismiss(b.id);
    expect(repo.list(pid).map((j) => j.company)).toEqual(['Co 3']);
    expect(repo.list(pid, { includeDead: true }).map((j) => j.id)).toContain(a.id);
    expect(repo.list(pid, { includeDismissed: true }).map((j) => j.id)).toContain(b.id);
    expect(repo.list(pid, { includeDead: true, includeDismissed: true })).toHaveLength(3);
  });

  it('gets by id, null when missing, and dismiss of unknown id is a no-op', () => {
    const { repo, runId } = setup();
    const [a] = repo.insertMany(runId, [newJob(1)]);
    expect(repo.get(a.id)).toEqual(a);
    expect(repo.get('missing')).toBeNull();
    repo.dismiss('missing');
    repo.dismiss(a.id);
    expect(repo.get(a.id)?.dismissed_at).toEqual(expect.any(String));
  });

  it('restores a dismissed job, and restore of an unknown id is a no-op', () => {
    const { repo, runId, pid } = setup();
    const [a, b] = repo.insertMany(runId, [newJob(1), newJob(2)]);
    repo.dismiss(a.id);
    repo.dismiss(b.id);
    repo.restore('missing');
    repo.restore(a.id);
    expect(repo.get(a.id)?.dismissed_at).toBeNull();
    expect(repo.get(b.id)?.dismissed_at).toEqual(expect.any(String));
    expect(repo.list(pid).map((j) => j.id)).toEqual([a.id]);
  });

  it('returns recent distinct canonical urls newest first', () => {
    const { repo, runId, pid } = setup();
    repo.insertMany(runId, [newJob(1), newJob(2), newJob(3, { canonical_url: 'https://example.com/jobs/2' })]);
    expect(repo.recentCanonicalUrls(pid, 1)).toEqual(['https://example.com/jobs/2']);
    expect(repo.recentCanonicalUrls(pid, 10)).toEqual([
      'https://example.com/jobs/2',
      'https://example.com/jobs/1',
    ]);
  });

  it('dedupes per profile: the same posting is stored once in each profile and lists stay apart', () => {
    const { db, repo, runId, pid } = setup();
    const other = insertTestProfile(db, 'Other profile');
    const otherRun = randomUUID();
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES (?, ?, 'discover_jobs', 'succeeded', 't')",
    ).run(otherRun, other);
    const [mine] = repo.insertMany(runId, [newJob(1)]);
    const [theirs] = repo.insertMany(otherRun, [newJob(1)]);
    expect(mine?.profile_id).toBe(pid);
    expect(theirs?.profile_id).toBe(other);
    expect(repo.insertMany(otherRun, [newJob(1)])).toEqual([]);
    expect(repo.list(pid).map((j) => j.id)).toEqual([mine!.id]);
    expect(repo.list(other).map((j) => j.id)).toEqual([theirs!.id]);
    repo.insertMany(otherRun, [newJob(2)]);
    expect(repo.existingDedupeKeys(pid)).toEqual(new Set(['key-1']));
    expect(repo.recentCanonicalUrls(pid, 10)).toEqual(['https://example.com/jobs/1']);
  });

  it('stores fit checks as JSON and returns them parsed from get and list', () => {
    const { repo, pid, runId } = setup();
    const checks = { location: 'pass', remote: 'fail', seniority: 'unknown' } as const;
    const [stored] = repo.insertMany(runId, [newJob(1, { fit_checks: checks })]);
    expect(stored!.fit_checks).toEqual(checks);
    expect(repo.get(stored!.id)!.fit_checks).toEqual(checks);
    expect(repo.list(pid)[0]!.fit_checks).toEqual(checks);
  });

  it('returns null fit checks for older rows and for text that does not parse', () => {
    const { db, repo, pid, runId } = setup();
    const [a, b] = repo.insertMany(runId, [newJob(1), newJob(2)]);
    expect(a!.fit_checks).toBeNull();
    db.prepare("UPDATE jobs SET fit_checks = 'not json' WHERE id = ?").run(b!.id);
    expect(repo.get(b!.id)!.fit_checks).toBeNull();
    expect(repo.list(pid).map((j) => j.fit_checks)).toEqual([null, null]);
  });

  it('insertMany throws for an unknown run', () => {
    const { repo } = setup();
    expect(() => repo.insertMany('no-such-run', [newJob(1)])).toThrow('Run not found: no-such-run');
  });

  it('lists each job with the start time and mode of the search that first found it', () => {
    const { repo, runId, db, pid } = setup();
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, started_at, effort_mode, created_at) VALUES ('run-max', ?, 'discover_jobs', 'succeeded', '2026-11-09T08:00:00.000Z', 'max', 't')",
    ).run(pid);
    repo.insertMany(runId, [newJob(1)]);
    repo.insertMany('run-max', [newJob(2)]);
    const started = (db.prepare('SELECT started_at FROM runs WHERE id = ?').get(runId) as { started_at: string })
      .started_at;

    expect(repo.list(pid).map((j) => [j.company, j.run_started_at, j.run_effort_mode])).toEqual([
      ['Co 2', '2026-11-09T08:00:00.000Z', 'max'],
      ['Co 1', started, 'default'],
    ]);
  });

  it('tells which jobs were first found by a search with custom instructions', () => {
    const { repo, runId, db, pid } = setup();
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, custom_prompt, created_at) VALUES ('run-custom', ?, 'discover_jobs', 'succeeded', 'Only fintech companies', 't')",
    ).run(pid);
    repo.insertMany(runId, [newJob(1)]);
    repo.insertMany('run-custom', [newJob(2)]);

    expect(repo.list(pid).map((j) => [j.company, j.run_has_custom_prompt])).toEqual([
      ['Co 2', true],
      ['Co 1', false],
    ]);
  });

  it('tells which jobs came from an import', () => {
    const { repo, runId, db, pid } = setup();
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES ('run-import', ?, 'import_jobs', 'succeeded', 't')",
    ).run(pid);
    repo.insertMany(runId, [newJob(1)]);
    repo.insertMany('run-import', [newJob(2)]);

    expect(repo.list(pid).map((j) => [j.company, j.run_kind])).toEqual([
      ['Co 2', 'import_jobs'],
      ['Co 1', 'discover_jobs'],
    ]);
  });

  it('records a sighting on the matching job of the run profile only, in the same call as new jobs', () => {
    const { repo, runId, db, pid } = setup();
    const other = insertTestProfile(db, 'Other roles');
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES ('run-other', ?, 'discover_jobs', 'succeeded', 't')",
    ).run(other);
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES ('run-2', ?, 'discover_jobs', 'succeeded', 't')",
    ).run(pid);
    const [mine] = repo.insertMany(runId, [newJob(1), newJob(2, { verified_at: 'old' })]);
    const [theirs] = repo.insertMany('run-other', [newJob(1)]);

    const inserted = repo.insertMany('run-2', [newJob(3)], [
      { dedupe_key: 'key-1', verification: { status: 'dead', verified_at: 'new' } },
      { dedupe_key: 'key-2', verification: null },
    ]);

    expect(inserted.map((j) => j.company)).toEqual(['Co 3']);
    expect(repo.get(mine!.id)).toMatchObject({
      run_id: runId,
      last_seen_run_id: 'run-2',
      verification_status: 'dead',
      verified_at: 'new',
    });
    expect(repo.list(pid, { includeDead: true }).find((j) => j.company === 'Co 2')).toMatchObject({
      last_seen_run_id: 'run-2',
      verification_status: 'ok',
      verified_at: 'old',
    });
    expect(repo.get(theirs!.id)).toMatchObject({ last_seen_run_id: 'run-other', verification_status: 'ok' });
  });
});
