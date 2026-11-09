import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedMockData } from '../../../scripts/sandbox-mock/seed.js';
import { createApplicationsRepo } from '../../../src/server/db/applications-repo.js';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createProfilesRepo } from '../../../src/server/db/profiles-repo.js';
import { createProposalsRepo } from '../../../src/server/db/proposals-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import {
  APPLICATION_STATUSES,
  hasFailedWorkers,
  VERIFICATION_STATUSES,
} from '../../../src/server/domain/types.js';

const NOW = new Date('2026-11-08T12:00:00.000Z');
const COMMAND = '"/usr/bin/node" "/repo/scripts/sandbox-mock/mock-agent.mjs" {prompt_file}';

describe('seedMockData', () => {
  let db: Db;
  let dataDir: string;

  beforeEach(() => {
    // The repositories read the real clock (the 30-day offer window), so it is frozen at the seed time.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    db = openDatabase(':memory:');
    migrate(db);
    dataDir = mkdtempSync(join(tmpdir(), 'jobtrack-seed-'));
    seedMockData(db, { dataDir, now: NOW, mockAgentCommand: COMMAND });
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const profileByName = (name: string) => {
    const profile = createProfilesRepo(db).list().find((p) => p.name === name);
    if (!profile) throw new Error(`missing profile ${name}`);
    return profile;
  };

  it('leaves no broken foreign key references', () => {
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('creates a rich, a sparse and an empty profile', () => {
    const list = createProfilesRepo(db).list();
    expect(list.map((p) => p.name)).toEqual(['Data Analyst Roles', 'Empty Search', 'Frontend Platform']);
    const empty = list.find((p) => p.name === 'Empty Search')!;
    expect(empty.counts).toEqual({ jobs: 0, applications: 0, runs: 0 });
    const sparse = list.find((p) => p.name === 'Data Analyst Roles')!;
    expect(sparse.counts.jobs).toBeGreaterThan(0);
    expect(sparse.cv).toBeNull();
  });

  it('keeps a CV file with the rich profile', () => {
    const rich = profileByName('Frontend Platform');
    expect(rich.cv?.file_name).toBe('frontend-cv.md');
    const dir = join(dataDir, 'profiles', rich.id);
    expect(readFileSync(join(dir, 'cv.md'), 'utf8')).toContain('Frontend Engineer');
    expect(readFileSync(join(dir, 'cv-text.txt'), 'utf8')).toBe(readFileSync(join(dir, 'cv.md'), 'utf8'));
  });

  it('covers every application status with backdated history on the rich profile', () => {
    const rich = profileByName('Frontend Platform');
    const apps = createApplicationsRepo(db);
    const list = apps.list(rich.id);
    expect(new Set(list.map((a) => a.status))).toEqual(new Set(APPLICATION_STATUSES));
    for (const app of list) {
      expect(app.status_changed_at < NOW.toISOString()).toBe(true);
      if (app.status !== 'saved') expect(app.applied_at).not.toBeNull();
    }
    const interview = list.find((a) => a.status === 'interview')!;
    expect(apps.history(interview.id).map((h) => h.to_status)).toEqual(['screening', 'interview']);
    // Offer stays open only for 30 days after it was set.
    expect(apps.list(rich.id, { open: true }).some((a) => a.status === 'offer')).toBe(true);
  });

  it('covers every verification status, fit verdict and a dismissed job', () => {
    const rich = profileByName('Frontend Platform');
    const jobs = createJobsRepo(db).list(rich.id, { includeDead: true, includeDismissed: true });
    expect(new Set(jobs.map((j) => j.verification_status))).toEqual(new Set(VERIFICATION_STATUSES));
    const verdicts = new Set(jobs.flatMap((j) => (j.fit_checks ? Object.values(j.fit_checks) : [])));
    expect(verdicts).toEqual(new Set(['pass', 'fail', 'unknown']));
    expect(jobs.some((j) => j.dismissed_at !== null)).toBe(true);
    expect(jobs.some((j) => j.fit_checks === null)).toBe(true);
    expect(jobs.some((j) => j.application_status !== null)).toBe(true);
  });

  it('has pending, accepted and rejected proposals', () => {
    const rich = profileByName('Frontend Platform');
    expect(createProposalsRepo(db).listPending(rich.id)).toHaveLength(3);
    const states = db.prepare('SELECT state, COUNT(*) AS n FROM proposals GROUP BY state').all();
    expect(states).toEqual(
      expect.arrayContaining([
        { state: 'accepted', n: 1 },
        { state: 'rejected', n: 1 },
      ]),
    );
    const accepted = db.prepare("SELECT id FROM proposals WHERE state = 'accepted'").get() as { id: string };
    const history = db.prepare('SELECT source FROM status_history WHERE proposal_id = ?').all(accepted.id);
    expect(history).toEqual([{ source: 'proposal' }]);
    // Proposals are saved at the end of their run, as the app does.
    const early = db
      .prepare('SELECT p.id FROM proposals p JOIN runs r ON r.id = p.run_id WHERE p.created_at < r.finished_at')
      .all();
    expect(early).toEqual([]);
  });

  it('logs one result per surviving worker of the Max run', () => {
    const max = db.prepare("SELECT id FROM runs WHERE effort_mode = 'max'").get() as { id: string };
    const lines = readFileSync(join(dataDir, 'runs', `${max.id}.log`), 'utf8').split('\n');
    const results = lines.filter((l) => /^\[worker \d\] \{"type":"result"/.test(l)).map((l) => l.slice(1, 9));
    expect(results).toEqual(['worker 1', 'worker 2', 'worker 3', 'worker 5']);
    expect(lines.some((l) => l.startsWith('{"type":"result"'))).toBe(false);
  });

  it('only leaves finished runs, each with a log file', () => {
    const runs = db.prepare('SELECT * FROM runs').all() as { id: string; status: string; summary: string | null }[];
    expect(new Set(runs.map((r) => r.status))).toEqual(new Set(['succeeded', 'failed', 'aborted']));
    expect(runs.some((r) => hasFailedWorkers(r.summary))).toBe(true);
    for (const run of runs) expect(existsSync(join(dataDir, 'runs', `${run.id}.log`))).toBe(true);
  });

  it('points the agent at the mock command and keeps scheduled sync off', () => {
    const settings = createSettingsRepo(db).getAll();
    expect(settings.adapter_id).toBe('custom');
    expect(settings.custom_command).toBe(COMMAND);
    expect(settings.sync_interval).toBe('off');
  });
});
