import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult, AgentTask, RunOptions } from '../../../src/server/agents/index.js';
import { createCvService, CV_ANALYSIS_TIMEOUT_MS } from '../../../src/server/cv/service.js';
import { createCvAnalysesRepo } from '../../../src/server/db/cv-analyses-repo.js';
import type { CvAnalysis, Profile } from '../../../src/server/domain/types.js';
import { CV_TEXT, makePdf, makePng } from '../../fixtures/cv-files.js';
import { json, makeHarness, waitFor, type Harness } from './harness.js';

let h: Harness;

const DRAFT_OUTPUT = {
  name: 'Senior Backend Engineer',
  target_roles: ['Backend Engineer', 'Platform Engineer'],
  locations: ['Lisbon'],
  remote: 'remote',
  seniority: ['Staff', 'senior'],
  keywords: ['TypeScript', 'PostgreSQL'],
  notes: 'Eight years of backend work at Acme and Globex.',
};

const PROFILE_FIELDS = {
  name: 'Backend roles',
  target_roles: ['Backend Engineer'],
  locations: ['Lisbon'],
  remote: 'remote',
  seniority: 'Senior, Staff',
  keywords: ['TypeScript'],
  excluded_companies: [],
  notes: 'Eight years of backend work.',
};

const ok = (output: unknown): AgentResult => ({ ok: true, output, rawStdout: '', rawStderr: '', exitCode: 0, durationMs: 1 });

interface AgentCall {
  task: AgentTask;
  opts: RunOptions;
}

// Records each call and answers with `answer`, or waits for the abort signal when `answer` is 'hang'.
function fakeAgent(answer: AgentResult | 'hang'): AgentCall[] {
  const calls: AgentCall[] = [];
  h.agentRun = async (task, opts) => {
    calls.push({ task, opts });
    if (answer !== 'hang') return answer;
    await new Promise<void>((resolve) => opts.signal?.addEventListener('abort', () => resolve(), { once: true }));
    return { ok: false, error: 'Aborted', rawStdout: '', rawStderr: '', exitCode: null, durationMs: 1 };
  };
  return calls;
}

function upload(bytes: Uint8Array, name = 'Alex CV.pdf', headers: Record<string, string> = {}): Promise<Response> {
  return h.app.request('/api/cv-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), ...headers },
    body: new Blob([new Uint8Array(bytes)]),
  });
}

const current = () => h.deps.cvService.current();
const analysisDir = (id: string) => join(h.deps.dataDir, 'cv-analyses', id);
const profileDir = (id: string) => join(h.deps.dataDir, 'profiles', id);

async function readyAnalysis(): Promise<CvAnalysis> {
  fakeAgent(ok(DRAFT_OUTPUT));
  const res = await upload(makePdf());
  expect(res.status).toBe(202);
  await waitFor(() => current()?.status === 'succeeded');
  return current()!;
}

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

describe('CV analysis: start', () => {
  it('has no analysis to begin with', async () => {
    const res = await h.app.request('/api/cv-analysis');
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('starts from a PDF, sends its text to the agent and saves a reviewed-ready draft', async () => {
    const calls = fakeAgent(ok(DRAFT_OUTPUT));
    const res = await upload(makePdf(), 'Alex CV.pdf');
    expect(res.status).toBe(202);
    const started = (await res.json()) as CvAnalysis;
    expect(started).toMatchObject({ status: 'running', file_name: 'Alex CV.pdf', file_type: 'pdf', draft: null });

    await waitFor(() => current()?.status === 'succeeded');
    expect(current()).toMatchObject({
      id: started.id,
      error: null,
      draft: {
        name: 'Senior Backend Engineer',
        target_roles: ['Backend Engineer', 'Platform Engineer'],
        locations: ['Lisbon'],
        remote: 'remote',
        seniority: 'Senior, Staff',
        keywords: ['TypeScript', 'PostgreSQL'],
        notes: 'Eight years of backend work at Acme and Globex.',
      },
    });
    expect(current()!.finished_at).not.toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.task.kind).toBe('analyse_cv');
    expect(calls[0]!.task.prompt).toContain(CV_TEXT);
    expect(calls[0]!.opts.timeoutMs).toBe(CV_ANALYSIS_TIMEOUT_MS);
    expect(calls[0]!.opts.cwd).toBe(join(analysisDir(started.id), 'work'));
    expect(h.factoryCalls.map((f) => f.kind)).toContain('analyse_cv');

    // The upload and its text stay until Create profile or Discard; the agent's files do not.
    expect(readdirSync(analysisDir(started.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(readFileSync(join(analysisDir(started.id), 'cv-text.txt'), 'utf8')).toBe(CV_TEXT);
    expect((await (await h.app.request('/api/cv-analysis')).json()) as CvAnalysis).toEqual(current());
  });

  it('starts at once while a discovery run of a profile is running', async () => {
    const run = h.deps.runsRepo.create('discover_jobs', h.profile.id, { adapter_id: 'claude', prompt_version: null });
    h.deps.runsRepo.update(run.id, { status: 'running' });
    fakeAgent(ok(DRAFT_OUTPUT));
    expect((await upload(makePdf())).status).toBe(202);
    await waitFor(() => current()?.status === 'succeeded');
    expect(h.deps.runsRepo.get(run.id)!.status).toBe('running');
  });

  it('refuses a second CV while one analysis exists, whatever its state', async () => {
    await readyAnalysis();
    const res = await upload(makePdf());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'A CV analysis already exists. Discard it before uploading another CV.' });
    expect(readdirSync(join(h.deps.dataDir, 'cv-analyses'))).toHaveLength(1);
  });

  it('refuses a body that is not application/octet-stream, so form posts cannot start one', async () => {
    for (const type of ['application/json', 'multipart/form-data; boundary=x', 'text/plain']) {
      const res = await upload(makePdf(), 'cv.pdf', { 'Content-Type': type });
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: 'Content-Type must be application/octet-stream' });
    }
    expect(current()).toBeNull();
  });

  it('refuses a cross-site upload', async () => {
    const res = await upload(makePdf(), 'cv.pdf', { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(current()).toBeNull();
  });

  it('needs a file name and a non-empty body', async () => {
    const noName = await h.app.request('/api/cv-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Blob([new Uint8Array(makePdf())]),
    });
    expect(noName.status).toBe(400);
    expect(await noName.json()).toEqual({ error: 'X-File-Name header is required' });
    const empty = await upload(new Uint8Array(0));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'The file is empty' });
  });

  it('keeps only the last part of the file name, without control characters', async () => {
    fakeAgent(ok(DRAFT_OUTPUT));
    await upload(makePdf(), '../../etc/Alex\u0007 CV.pdf');
    expect(current()!.file_name).toBe('Alex CV.pdf');
  });

  it('refuses a file larger than 10 MB', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'The file is larger than 10 MB' });
    expect(current()).toBeNull();
  });

  it('refuses an unsupported file type and a scanned PDF before any agent starts', async () => {
    const calls = fakeAgent(ok(DRAFT_OUTPUT));
    const png = await upload(makePng(), 'cv.pdf');
    expect(png.status).toBe(415);
    expect(await png.json()).toEqual({
      error: 'This file type is not supported. Use a PDF, a Word (.docx), a .txt or a .md file.',
    });
    const scanned = await upload(makePdf([]));
    expect(scanned.status).toBe(422);
    expect(calls).toHaveLength(0);
    expect(current()).toBeNull();
    expect(existsSync(join(h.deps.dataDir, 'cv-analyses'))).toBe(false);
  });

  it('is 422 when the agent is not installed', async () => {
    h.healthFor.claude = { id: 'claude', installed: false, message: 'Not found on PATH' };
    const res = await upload(makePdf());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'Agent "claude" is not installed: Not found on PATH' });
    expect(current()).toBeNull();
  });
});

describe('CV analysis: failure, retry, discard, restart', () => {
  it('records an agent failure and runs again from the kept text', async () => {
    fakeAgent({ ok: false, error: 'Timed out after 300000 ms', rawStdout: '', rawStderr: '', exitCode: null, durationMs: 1 });
    await upload(makePdf());
    await waitFor(() => current()?.status === 'failed');
    expect(current()!.error).toBe('The agent could not analyse the CV: Timed out after 300000 ms');

    const calls = fakeAgent(ok(DRAFT_OUTPUT));
    const res = await h.app.request('/api/cv-analysis/retry', { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: 'running', error: null, finished_at: null });
    await waitFor(() => current()?.status === 'succeeded');
    expect(calls[0]!.task.prompt).toContain(CV_TEXT);
  });

  it('fails an answer that does not have the expected shape', async () => {
    fakeAgent(ok({ target_roles: 'not a list' }));
    await upload(makePdf());
    await waitFor(() => current()?.status === 'failed');
    expect(current()!.error).toBe("The agent's answer did not have the expected shape.");
  });

  it('runs again only a failed or interrupted analysis', async () => {
    const none = await h.app.request('/api/cv-analysis/retry', { method: 'POST' });
    expect(none.status).toBe(409);
    await readyAnalysis();
    const ready = await h.app.request('/api/cv-analysis/retry', { method: 'POST' });
    expect(ready.status).toBe(409);
    expect(await ready.json()).toEqual({ error: 'Only a failed or interrupted CV analysis can be run again.' });
  });

  it('Cancel stops the running agent and deletes the analysis and its files', async () => {
    const calls = fakeAgent('hang');
    const { id } = (await (await upload(makePdf())).json()) as CvAnalysis;
    await waitFor(() => calls.length === 1);
    const res = await h.app.request('/api/cv-analysis', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(calls[0]!.opts.signal!.aborted).toBe(true);
    expect(current()).toBeNull();
    expect(existsSync(analysisDir(id))).toBe(false);
    expect((await h.app.request('/api/cv-analysis', { method: 'DELETE' })).status).toBe(404);
  });

  it('Discard deletes a ready analysis and its files', async () => {
    const { id } = await readyAnalysis();
    expect((await h.app.request('/api/cv-analysis', { method: 'DELETE' })).status).toBe(204);
    expect(current()).toBeNull();
    expect(existsSync(analysisDir(id))).toBe(false);
  });

  it('after a restart, shows a running analysis as interrupted and never restarts it', async () => {
    const calls = fakeAgent('hang');
    const { id } = (await (await upload(makePdf())).json()) as CvAnalysis;
    await waitFor(() => calls.length === 1);
    // Shutdown kills the agent and leaves the row as it was.
    await h.deps.cvService.stop();
    expect(calls[0]!.opts.signal!.aborted).toBe(true);
    expect(current()!.status).toBe('running');

    // A new process: a fresh service over the same database and data directory.
    const restarted = createCvService({
      db: h.deps.db,
      dataDir: h.deps.dataDir,
      cvAnalysesRepo: createCvAnalysesRepo(h.deps.db),
      profilesRepo: h.deps.profilesRepo,
      settingsRepo: h.deps.settingsRepo,
      adapterFactory: h.deps.adapterFactory,
    });
    restarted.startup();
    expect(restarted.current()).toMatchObject({ id, status: 'interrupted', error: 'The app stopped while the CV was being analysed' });
    expect(calls).toHaveLength(1);
    expect(readdirSync(analysisDir(id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);

    fakeAgent(ok(DRAFT_OUTPUT));
    restarted.retry();
    await waitFor(() => restarted.current()?.status === 'succeeded');
    await restarted.stop();
  });

  it('refuses to start an agent once shutdown has begun, even for an upload still being read', async () => {
    const calls = fakeAgent(ok(DRAFT_OUTPUT));
    const pending = upload(makePdf());
    await h.deps.cvService.stop();
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'The app is shutting down.' });
    expect(calls).toHaveLength(0);
    expect(current()).toBeNull();
  });

  it('at start-up, deletes CV folders that have no row', async () => {
    const { id } = await readyAnalysis();
    for (const dir of [analysisDir('orphan-1'), profileDir('orphan-2'), profileDir(h.profile.id)]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'cv.pdf'), 'x');
    }
    h.deps.cvService.startup();
    expect(readdirSync(join(h.deps.dataDir, 'cv-analyses'))).toEqual([id]);
    // The harness profile has no CV, so its folder is a leftover too.
    expect(readdirSync(join(h.deps.dataDir, 'profiles'))).toEqual([]);
  });
});

describe('profiles with a CV', () => {
  async function createFromCv(): Promise<Profile> {
    const analysis = await readyAnalysis();
    const res = await h.app.request('/api/profiles', json('POST', { ...PROFILE_FIELDS, cv_analysis_id: analysis.id }));
    expect(res.status).toBe(201);
    return (await res.json()) as Profile;
  }

  it('Create profile keeps the CV with the new profile and ends the analysis', async () => {
    const analysis = await readyAnalysis();
    const res = await h.app.request('/api/profiles', json('POST', { ...PROFILE_FIELDS, cv_analysis_id: analysis.id }));
    expect(res.status).toBe(201);
    const profile = (await res.json()) as Profile;
    expect(profile).toMatchObject({ ...PROFILE_FIELDS, cv: { file_name: 'Alex CV.pdf' } });
    expect(h.deps.profilesRepo.get(profile.id)!.cv).toEqual(profile.cv);
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(readFileSync(join(profileDir(profile.id), 'cv-text.txt'), 'utf8')).toBe(CV_TEXT);
    expect(current()).toBeNull();
    expect(existsSync(analysisDir(analysis.id))).toBe(false);
  });

  it('refuses an analysis that is not ready, and creates no profile', async () => {
    fakeAgent('hang');
    const { id } = (await (await upload(makePdf())).json()) as CvAnalysis;
    const res = await h.app.request('/api/profiles', json('POST', { ...PROFILE_FIELDS, cv_analysis_id: id }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This CV analysis has not finished.' });
    const missing = await h.app.request('/api/profiles', json('POST', { ...PROFILE_FIELDS, cv_analysis_id: 'nope' }));
    expect(missing.status).toBe(409);
    expect(h.deps.profilesRepo.list()).toHaveLength(1);
  });

  it('keeps the analysis and its files when the name is taken', async () => {
    const analysis = await readyAnalysis();
    const res = await h.app.request(
      '/api/profiles',
      json('POST', { ...PROFILE_FIELDS, name: h.profile.name, cv_analysis_id: analysis.id }),
    );
    expect(res.status).toBe(409);
    expect(current()!.id).toBe(analysis.id);
    expect(readdirSync(analysisDir(analysis.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
  });

  it('moves the files back when the profile row cannot be written', async () => {
    const analysis = await readyAnalysis();
    const original = h.deps.profilesRepo.create;
    h.deps.profilesRepo.create = () => {
      throw new Error('disk full');
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await h.app.request('/api/profiles', json('POST', { ...PROFILE_FIELDS, cv_analysis_id: analysis.id }));
    h.deps.profilesRepo.create = original;
    expect(res.status).toBe(500);
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
    logged.mockRestore();
    expect(current()!.id).toBe(analysis.id);
    expect(readdirSync(analysisDir(analysis.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(existsSync(join(h.deps.dataDir, 'profiles')) && readdirSync(join(h.deps.dataDir, 'profiles'))).toEqual([]);
  });

  it('refuses an analysis whose files are missing and moves nothing', async () => {
    const analysis = await readyAnalysis();
    rmSync(join(analysisDir(analysis.id), 'cv-text.txt'));
    const res = await h.app.request('/api/profiles', json('POST', { ...PROFILE_FIELDS, cv_analysis_id: analysis.id }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'The CV of this analysis is missing. Discard it and upload the CV again.' });
    expect(readdirSync(analysisDir(analysis.id))).toEqual(['cv.pdf']);
    expect(h.deps.profilesRepo.list()).toHaveLength(1);
  });

  it('downloads the CV under its original name', async () => {
    const profile = await createFromCv();
    const res = await h.app.request(`/api/profiles/${profile.id}/cv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Alex CV.pdf"; filename*=UTF-8''Alex%20CV.pdf`,
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(makePdf());
  });

  it('is 404 for a profile without a CV', async () => {
    expect((await h.app.request(`${h.base}/cv`)).status).toBe(404);
    expect((await h.app.request(`${h.base}/cv`, { method: 'DELETE' })).status).toBe(404);
  });

  it('Remove CV deletes the file and its text and keeps the profile', async () => {
    const profile = await createFromCv();
    const res = await h.app.request(`/api/profiles/${profile.id}/cv`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: profile.id, cv: null });
    expect(h.deps.profilesRepo.get(profile.id)!.cv).toBeNull();
    expect(existsSync(profileDir(profile.id))).toBe(false);
  });

  it('deleting the profile deletes its CV', async () => {
    const profile = await createFromCv();
    expect((await h.app.request(`/api/profiles/${profile.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(existsSync(profileDir(profile.id))).toBe(false);
  });

  it('PUT never takes a CV analysis', async () => {
    const analysis = await readyAnalysis();
    const res = await h.app.request(h.base, json('PUT', { ...PROFILE_FIELDS, cv_analysis_id: analysis.id }));
    expect(res.status).toBe(400);
    expect(current()!.id).toBe(analysis.id);
  });
});
