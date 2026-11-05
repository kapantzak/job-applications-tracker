import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createJobsRepo, type NewJob } from '../../../src/server/db/jobs-repo.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  // jobs.run_id is a foreign key; there is no runs repo yet.
  const now = new Date().toISOString();
  const runId = randomUUID();
  db.prepare(
    "INSERT INTO runs (id, kind, status, started_at, created_at) VALUES (?, 'discover_jobs', 'succeeded', ?, ?)",
  ).run(runId, now, now);
  return { db, runId, repo: createJobsRepo(db) };
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
    match_reason: null,
    verification_status: 'ok',
    verified_at: null,
    dedupe_key: `key-${n}`,
    ...over,
  };
}

describe('jobs repo', () => {
  it('inserts jobs and lists them newest first', () => {
    const { repo, runId } = setup();
    const inserted = repo.insertMany(runId, [newJob(1), newJob(2)]);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ run_id: runId, dismissed_at: null });
    expect(repo.list().map((j) => j.company)).toEqual(['Co 2', 'Co 1']);
  });

  it('skips existing dedupe keys across and within batches', () => {
    const { repo, runId, db } = setup();
    repo.insertMany(runId, [newJob(1)]);
    expect(repo.insertMany(runId, [newJob(9, { dedupe_key: 'key-1' })])).toEqual([]);
    const dup = repo.insertMany(runId, [newJob(2), newJob(3, { dedupe_key: 'key-2' })]);
    expect(dup.map((j) => j.company)).toEqual(['Co 2']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 2 });
    expect(repo.existingDedupeKeys()).toEqual(new Set(['key-1', 'key-2']));
  });

  it('hides dead and dismissed jobs unless asked', () => {
    const { repo, runId } = setup();
    const [a, b] = repo.insertMany(runId, [
      newJob(1, { verification_status: 'dead' }),
      newJob(2),
    ]);
    repo.insertMany(runId, [newJob(3)]);
    repo.dismiss(b.id);
    expect(repo.list().map((j) => j.company)).toEqual(['Co 3']);
    expect(repo.list({ includeDead: true }).map((j) => j.id)).toContain(a.id);
    expect(repo.list({ includeDismissed: true }).map((j) => j.id)).toContain(b.id);
    expect(repo.list({ includeDead: true, includeDismissed: true })).toHaveLength(3);
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

  it('returns recent distinct canonical urls newest first', () => {
    const { repo, runId } = setup();
    repo.insertMany(runId, [newJob(1), newJob(2), newJob(3, { canonical_url: 'https://example.com/jobs/2' })]);
    expect(repo.recentCanonicalUrls(1)).toEqual(['https://example.com/jobs/2']);
    expect(repo.recentCanonicalUrls(10)).toEqual([
      'https://example.com/jobs/2',
      'https://example.com/jobs/1',
    ]);
  });
});
