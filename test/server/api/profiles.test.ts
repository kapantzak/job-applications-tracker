import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Application, Profile, ProfileListItem } from '../../../src/server/domain/types.js';
import { insertJob, json, makeHarness, SAMPLE_PROFILE, type Harness } from './harness.js';

let h: Harness;

const OTHER = { ...SAMPLE_PROFILE, name: 'Data roles', target_roles: ['Data Engineer'] };

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

describe('profiles: list and create', () => {
  it('GET lists profiles by name with what each one holds', async () => {
    const other = h.deps.profilesRepo.create(OTHER);
    insertJob(h);
    h.deps.applicationsRepo.create({ profile_id: h.profile.id, company: 'Acme', role: 'SRE' });
    const res = await h.app.request('/api/profiles');
    expect(res.status).toBe(200);
    const list = (await res.json()) as ProfileListItem[];
    expect(list.map((p) => [p.name, p.counts])).toEqual([
      ['Data roles', { jobs: 0, applications: 0, runs: 0 }],
      ['Platform roles', { jobs: 1, applications: 1, runs: 1 }],
    ]);
    expect(list[0]).toMatchObject({ ...OTHER, id: other.id });
  });

  it('POST creates a profile with a trimmed name and returns 201', async () => {
    const res = await h.app.request('/api/profiles', json('POST', { ...OTHER, name: '  Data roles  ' }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Profile;
    expect(created).toMatchObject({ ...OTHER, name: 'Data roles' });
    expect(h.deps.profilesRepo.get(created.id)).toEqual(created);
  });

  it('POST with a name another profile uses, ignoring case, is 409 and writes nothing', async () => {
    const res = await h.app.request('/api/profiles', json('POST', { ...OTHER, name: 'PLATFORM roles' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'A profile named "PLATFORM roles" already exists' });
    expect(h.deps.profilesRepo.list()).toHaveLength(1);
  });

  it('POST without a name, with unknown keys, or with a bad body is 400 and writes nothing', async () => {
    const blank = await h.app.request('/api/profiles', json('POST', { ...OTHER, name: '   ' }));
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: 'name: Name is required' });
    const remote = await h.app.request('/api/profiles', json('POST', { ...OTHER, remote: 'moon' }));
    expect(((await remote.json()) as { error: string }).error).toMatch(/^remote: /);
    const extra = await h.app.request('/api/profiles', json('POST', { ...OTHER, created_at: 'x' }));
    expect(extra.status).toBe(400);
    const broken = await h.app.request('/api/profiles', json('POST', '{not json'));
    expect(await broken.json()).toEqual({ error: 'Invalid JSON body' });
    expect(h.deps.profilesRepo.list()).toHaveLength(1);
  });
});

describe('profiles: one profile', () => {
  it('GET returns the profile and 404 for an unknown id', async () => {
    expect(await (await h.app.request(h.base)).json()).toEqual(h.profile);
    const missing = await h.app.request('/api/profiles/no-such-profile');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Profile not found' });
  });

  it.each(['jobs', 'applications', 'proposals', 'runs'])(
    'GET %s under an unknown profile is 404',
    async (collection) => {
      const res = await h.app.request(`/api/profiles/no-such-profile/${collection}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Profile not found' });
    },
  );

  it('PUT updates the profile and keeps its id and created_at', async () => {
    const res = await h.app.request(h.base, json('PUT', OTHER));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...OTHER, id: h.profile.id, created_at: h.profile.created_at });
  });

  it('PUT may keep its own name in another case but not take another profile name', async () => {
    h.deps.profilesRepo.create(OTHER);
    const own = await h.app.request(h.base, json('PUT', { ...SAMPLE_PROFILE, name: 'PLATFORM ROLES' }));
    expect(own.status).toBe(200);
    const taken = await h.app.request(h.base, json('PUT', { ...SAMPLE_PROFILE, name: 'data roles' }));
    expect(taken.status).toBe(409);
    expect(h.deps.profilesRepo.get(h.profile.id)?.name).toBe('PLATFORM ROLES');
  });

  it('PUT on an unknown profile is 404', async () => {
    const res = await h.app.request('/api/profiles/no-such-profile', json('PUT', OTHER));
    expect(res.status).toBe(404);
  });
});

describe('profiles: delete', () => {
  // A finished discovery and sync with a job, an application, an accepted proposal and history.
  function populate(profileId: string): { runIds: string[]; app: Application } {
    const job = insertJob(h, {}, profileId);
    const app = h.deps.applicationsRepo.create({ profile_id: profileId, job_id: job.id, company: 'Acme', role: 'SRE' });
    const sync = h.deps.runsRepo.create('sync_mail', profileId, { adapter_id: '', prompt_version: null });
    const [proposal] = h.deps.proposalsRepo.createMany(sync.id, [
      {
        application_id: app.id,
        proposed_status: 'interview',
        confidence: 0.9,
        reason: 'invented',
        evidence: { message_id: 'msg-001', date: '2026-11-01', from: 'hr@acme.example', subject: 's', snippet: 'x' },
      },
    ]);
    h.deps.proposalService.accept(proposal!.id);
    for (const run of h.deps.runsRepo.list(profileId)) h.deps.runsRepo.update(run.id, { status: 'succeeded' });
    return { runIds: h.deps.runsRepo.list(profileId).map((r) => r.id), app };
  }

  it('removes the profile, every row it owns and its run logs, and leaves other profiles alone', async () => {
    const other = h.deps.profilesRepo.create(OTHER);
    const mine = populate(h.profile.id);
    const theirs = populate(other.id);
    for (const id of [...mine.runIds, ...theirs.runIds]) {
      h.deps.logStore.append(id, 'line');
      mkdirSync(join(h.deps.runsDir, id));
      writeFileSync(join(h.deps.runsDir, id, 'prompt.md'), 'x');
    }

    const res = await h.app.request(h.base, { method: 'DELETE' });
    expect(res.status).toBe(204);

    expect(h.deps.profilesRepo.list().map((p) => p.id)).toEqual([other.id]);
    const count = (sql: string) => (h.deps.db.prepare(sql).get() as { n: number }).n;
    expect(count('SELECT COUNT(*) AS n FROM runs')).toBe(theirs.runIds.length);
    expect(count('SELECT COUNT(*) AS n FROM jobs')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM applications')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM proposals')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM status_history')).toBe(1);
    expect(h.deps.applicationsRepo.history(theirs.app.id)).toHaveLength(1);
    for (const id of mine.runIds) {
      expect(existsSync(join(h.deps.runsDir, `${id}.log`))).toBe(false);
      expect(existsSync(join(h.deps.runsDir, id))).toBe(false);
    }
    for (const id of theirs.runIds) {
      expect(existsSync(join(h.deps.runsDir, `${id}.log`))).toBe(true);
      expect(existsSync(join(h.deps.runsDir, id))).toBe(true);
    }
  });

  it.each(['queued', 'running'] as const)('is 409 and deletes nothing while a run is %s', async (status) => {
    const run = h.deps.runsRepo.create('discover_jobs', h.profile.id, { adapter_id: '', prompt_version: null });
    h.deps.runsRepo.update(run.id, { status });
    const res = await h.app.request(h.base, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This profile has a queued or running run; cancel it first' });
    expect(h.deps.profilesRepo.get(h.profile.id)).not.toBeNull();
    expect(h.deps.runsRepo.get(run.id)).not.toBeNull();
  });

  it("is not blocked by another profile's active run", async () => {
    const other = h.deps.profilesRepo.create(OTHER);
    h.deps.runsRepo.create('discover_jobs', other.id, { adapter_id: '', prompt_version: null });
    expect((await h.app.request(h.base, { method: 'DELETE' })).status).toBe(204);
  });

  it('is 404 for an unknown profile', async () => {
    const res = await h.app.request('/api/profiles/no-such-profile', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('maps a profile that vanished during the request to 404 instead of 500', async () => {
    const original = h.deps.profilesRepo.update;
    h.deps.profilesRepo.update = (id, input) => {
      h.deps.profilesRepo.remove(id);
      return original(id, input);
    };
    const res = await h.app.request(h.base, json('PUT', OTHER));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Profile not found' });
  });
});
