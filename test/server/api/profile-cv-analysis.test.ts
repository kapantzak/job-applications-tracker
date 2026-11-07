import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult, AgentTask, RunOptions } from '../../../src/server/agents/index.js';
import { ProfileNotFoundError } from '../../../src/server/db/profiles-repo.js';
import type { CvAnalysis, Profile, ProfileListItem } from '../../../src/server/domain/types.js';
import { CV_LINES, CV_TEXT, makeDocx, makePdf } from '../../fixtures/cv-files.js';
import { json, makeHarness, SAMPLE_PROFILE, waitFor, type Harness } from './harness.js';

// SOW-0024: Replace CV and Add CV on an existing profile.

let h: Harness;

const DRAFT_OUTPUT = {
  name: 'Ignored on an existing profile',
  target_roles: ['Platform Engineer', 'Site Reliability Engineer'],
  locations: ['Porto'],
  remote: 'hybrid',
  seniority: ['Staff'],
  keywords: ['Kubernetes', 'Go'],
  notes: 'Ignored on an existing profile.',
};

const ok = (output: unknown): AgentResult => ({
  ok: true,
  output,
  rawStdout: '',
  rawStderr: '',
  exitCode: 0,
  durationMs: 1,
});

interface AgentCall {
  task: AgentTask;
  opts: RunOptions;
  settledBeforeDelete?: boolean;
}

// Records each call and answers with `answer`, or waits for the abort signal when `answer` is 'hang'.
function fakeAgent(answer: AgentResult | 'hang'): AgentCall[] {
  const calls: AgentCall[] = [];
  h.agentRun = async (task, opts) => {
    const call: AgentCall = { task, opts };
    calls.push(call);
    if (answer !== 'hang') return answer;
    await new Promise<void>((resolve) => opts.signal?.addEventListener('abort', () => resolve(), { once: true }));
    // Its working folder must still exist when a hanging agent ends.
    call.settledBeforeDelete = existsSync(opts.cwd!);
    return { ok: false, error: 'Aborted', rawStdout: '', rawStderr: '', exitCode: null, durationMs: 1 };
  };
  return calls;
}

function upload(path: string, bytes: Uint8Array, name: string): Promise<Response> {
  return h.app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) },
    body: new Blob([new Uint8Array(bytes)]),
  });
}

const analysisOf = (profileId: string | null) => h.deps.cvService.current(profileId);
const analysisDir = (id: string) => join(h.deps.dataDir, 'cv-analyses', id);
const profileDir = (id: string) => join(h.deps.dataDir, 'profiles', id);
const fieldsOf = (p: Profile) => ({
  name: p.name,
  target_roles: p.target_roles,
  locations: p.locations,
  remote: p.remote,
  seniority: p.seniority,
  keywords: p.keywords,
  excluded_companies: p.excluded_companies,
  notes: p.notes,
});

// A profile created from a PDF CV through the SOW-0023 flow.
async function profileWithPdf(): Promise<Profile> {
  fakeAgent(ok(DRAFT_OUTPUT));
  expect((await upload('/api/cv-analysis', makePdf(), 'Old CV.pdf')).status).toBe(202);
  await waitFor(() => analysisOf(null)?.status === 'succeeded');
  const res = await h.app.request(
    '/api/profiles',
    json('POST', { ...SAMPLE_PROFILE, name: 'Backend roles', cv_analysis_id: analysisOf(null)!.id }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Profile;
}

// A ready analysis for `profile`, from a Word file.
async function readyReplacement(profile: Profile): Promise<CvAnalysis> {
  fakeAgent(ok(DRAFT_OUTPUT));
  const res = await upload(`/api/profiles/${profile.id}/cv-analysis`, makeDocx(), 'New CV.docx');
  expect(res.status).toBe(202);
  await waitFor(() => analysisOf(profile.id)?.status === 'succeeded');
  return analysisOf(profile.id)!;
}

const UPDATED_FIELDS = {
  ...SAMPLE_PROFILE,
  name: 'Backend roles',
  target_roles: ['Platform Engineer'],
  locations: ['Porto'],
};

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

describe("a profile's CV analysis", () => {
  it('runs for a profile beside the new-profile analysis, each with its own agent', async () => {
    const calls = fakeAgent('hang');
    const forNew = (await (await upload('/api/cv-analysis', makePdf(), 'a.pdf')).json()) as CvAnalysis;
    const res = await upload(`${h.base}/cv-analysis`, makePdf(), 'b.pdf');
    expect(res.status).toBe(202);
    const forProfile = (await res.json()) as CvAnalysis;
    await waitFor(() => calls.length === 2);

    expect(forNew.profile_id).toBeNull();
    expect(forProfile).toMatchObject({ profile_id: h.profile.id, status: 'running', file_name: 'b.pdf' });
    expect(await (await h.app.request('/api/cv-analysis')).json()).toMatchObject({ id: forNew.id });
    expect(await (await h.app.request(`${h.base}/cv-analysis`)).json()).toMatchObject({ id: forProfile.id });
    expect(calls[0]!.opts.cwd).not.toBe(calls[1]!.opts.cwd);
  });

  it('refuses a second CV for the same profile, but not for another one', async () => {
    fakeAgent('hang');
    expect((await upload(`${h.base}/cv-analysis`, makePdf(), 'a.pdf')).status).toBe(202);
    const again = await upload(`${h.base}/cv-analysis`, makePdf(), 'b.pdf');
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: 'This profile already has a CV analysis. Discard it before uploading another CV.',
    });
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Data roles' });
    expect((await upload(`/api/profiles/${other.id}/cv-analysis`, makePdf(), 'c.pdf')).status).toBe(202);
  });

  it('is 404 for an unknown profile on every route', async () => {
    const base = '/api/profiles/nope/cv-analysis';
    expect((await h.app.request(base)).status).toBe(404);
    expect((await upload(base, makePdf(), 'a.pdf')).status).toBe(404);
    expect((await h.app.request(`${base}/retry`, { method: 'POST' })).status).toBe(404);
    expect((await h.app.request(base, { method: 'DELETE' })).status).toBe(404);
  });

  it('runs again and discards only its own analysis', async () => {
    fakeAgent({ ok: false, error: 'Exited with code 1', rawStdout: '', rawStderr: '', exitCode: 1, durationMs: 1 });
    await upload('/api/cv-analysis', makePdf(), 'a.pdf');
    await upload(`${h.base}/cv-analysis`, makePdf(), 'b.pdf');
    await waitFor(() => analysisOf(h.profile.id)?.status === 'failed' && analysisOf(null)?.status === 'failed');

    fakeAgent(ok(DRAFT_OUTPUT));
    expect((await h.app.request(`${h.base}/cv-analysis/retry`, { method: 'POST' })).status).toBe(202);
    await waitFor(() => analysisOf(h.profile.id)?.status === 'succeeded');
    expect(analysisOf(null)!.status).toBe('failed');

    const forProfile = analysisOf(h.profile.id)!;
    expect((await h.app.request(`${h.base}/cv-analysis`, { method: 'DELETE' })).status).toBe(204);
    expect(analysisOf(h.profile.id)).toBeNull();
    expect(existsSync(analysisDir(forProfile.id))).toBe(false);
    expect(analysisOf(null)).not.toBeNull();
  });

  it('refuses to create an analysis for a profile deleted while its CV was being read', async () => {
    fakeAgent(ok(DRAFT_OUTPUT));
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Data roles' });
    const pending = h.deps.cvService.start(makePdf(), 'a.pdf', other.id);
    h.deps.profilesRepo.remove(other.id);
    await expect(pending).rejects.toBeInstanceOf(ProfileNotFoundError);
    expect(analysisOf(other.id)).toBeNull();
  });

  it('shows on the Profiles list as a status on its profile', async () => {
    fakeAgent('hang');
    await upload(`${h.base}/cv-analysis`, makePdf(), 'a.pdf');
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Data roles' });
    const list = (await (await h.app.request('/api/profiles')).json()) as ProfileListItem[];
    expect(list.map((p) => [p.id, p.cv_analysis_status])).toEqual([
      [other.id, null],
      [h.profile.id, 'running'],
    ]);
  });

  it('Create profile refuses an analysis that belongs to a profile', async () => {
    fakeAgent(ok(DRAFT_OUTPUT));
    await upload(`${h.base}/cv-analysis`, makePdf(), 'a.pdf');
    await waitFor(() => analysisOf(h.profile.id)?.status === 'succeeded');
    const res = await h.app.request(
      '/api/profiles',
      json('POST', { ...SAMPLE_PROFILE, name: 'Data roles', cv_analysis_id: analysisOf(h.profile.id)!.id }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This CV analysis suggests changes to an existing profile.' });
    expect(h.deps.profilesRepo.list()).toHaveLength(1);
  });

  it('shutdown stops every running agent', async () => {
    const calls = fakeAgent('hang');
    await upload('/api/cv-analysis', makePdf(), 'a.pdf');
    await upload(`${h.base}/cv-analysis`, makePdf(), 'b.pdf');
    await waitFor(() => calls.length === 2);
    await h.deps.cvService.stop();
    expect(calls.map((c) => c.opts.signal!.aborted)).toEqual([true, true]);
  });
});

describe('Save with an applied CV analysis', () => {
  it('replaces the CV, also of another type, writes the fields and ends the analysis', async () => {
    const profile = await profileWithPdf();
    const analysis = await readyReplacement(profile);

    const res = await h.app.request(
      `/api/profiles/${profile.id}`,
      json('PUT', { ...UPDATED_FIELDS, cv_analysis_id: analysis.id }),
    );
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Profile;
    expect(fieldsOf(saved)).toEqual(UPDATED_FIELDS);
    expect(saved.cv).toMatchObject({ file_name: 'New CV.docx' });
    expect(h.deps.profilesRepo.storedCv(profile.id)).toMatchObject({ file_name: 'New CV.docx', file_type: 'docx' });
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.docx']);
    expect(readFileSync(join(profileDir(profile.id), 'cv-text.txt'), 'utf8')).toBe(CV_LINES.join('\n\n'));
    expect(analysisOf(profile.id)).toBeNull();
    expect(existsSync(analysisDir(analysis.id))).toBe(false);

    const download = await h.app.request(`/api/profiles/${profile.id}/cv`);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(makeDocx());
  });

  it('adds a first CV to a profile that had none', async () => {
    const analysis = await readyReplacement(h.profile);
    const res = await h.app.request(h.base, json('PUT', { ...SAMPLE_PROFILE, cv_analysis_id: analysis.id }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Profile).cv).toMatchObject({ file_name: 'New CV.docx' });
    expect(readdirSync(profileDir(h.profile.id)).sort()).toEqual(['cv-text.txt', 'cv.docx']);
  });

  it('a plain Save keeps the old CV and the analysis', async () => {
    const profile = await profileWithPdf();
    const analysis = await readyReplacement(profile);
    const res = await h.app.request(`/api/profiles/${profile.id}`, json('PUT', UPDATED_FIELDS));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Profile).cv).toMatchObject({ file_name: 'Old CV.pdf' });
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(analysisOf(profile.id)!.id).toBe(analysis.id);
  });

  it('refuses an analysis that is still running or belongs to another profile, and changes nothing', async () => {
    const profile = await profileWithPdf();
    fakeAgent('hang');
    await upload(`/api/profiles/${profile.id}/cv-analysis`, makeDocx(), 'New CV.docx');
    const running = await h.app.request(
      `/api/profiles/${profile.id}`,
      json('PUT', { ...UPDATED_FIELDS, cv_analysis_id: analysisOf(profile.id)!.id }),
    );
    expect(running.status).toBe(409);
    expect(await running.json()).toEqual({ error: 'This CV analysis has not finished.' });

    const foreign = await h.app.request(
      h.base,
      json('PUT', { ...SAMPLE_PROFILE, cv_analysis_id: analysisOf(profile.id)!.id }),
    );
    expect(foreign.status).toBe(409);
    expect(await foreign.json()).toEqual({ error: 'This CV analysis no longer exists.' });
    expect(fieldsOf(h.deps.profilesRepo.get(profile.id)!)).toEqual({ ...SAMPLE_PROFILE, name: 'Backend roles' });
    expect(h.deps.profilesRepo.get(h.profile.id)!.cv).toBeNull();
  });

  it('keeps the old CV, the old fields and the new files when the database write fails', async () => {
    const profile = await profileWithPdf();
    const analysis = await readyReplacement(profile);
    const original = h.deps.profilesRepo.setCv;
    h.deps.profilesRepo.setCv = () => {
      throw new Error('disk full');
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await h.app.request(
      `/api/profiles/${profile.id}`,
      json('PUT', { ...UPDATED_FIELDS, cv_analysis_id: analysis.id }),
    );
    h.deps.profilesRepo.setCv = original;
    logged.mockRestore();

    expect(res.status).toBe(500);
    // The field update ran in the same transaction and was rolled back.
    expect(fieldsOf(h.deps.profilesRepo.get(profile.id)!)).toEqual({ ...SAMPLE_PROFILE, name: 'Backend roles' });
    expect(h.deps.profilesRepo.storedCv(profile.id)).toMatchObject({ file_name: 'Old CV.pdf', file_type: 'pdf' });
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(readFileSync(join(profileDir(profile.id), 'cv-text.txt'), 'utf8')).toBe(CV_TEXT);
    expect(readdirSync(analysisDir(analysis.id)).sort()).toEqual(['cv-text.txt', 'cv.docx']);
    expect(analysisOf(profile.id)!.id).toBe(analysis.id);
  });

  it('first puts in place a CV an earlier Save could not rename, so it is never lost', async () => {
    const profile = await profileWithPdf();
    const dir = profileDir(profile.id);
    // An earlier Save committed a Word CV but its renames failed.
    h.deps.profilesRepo.setCv(profile.id, { file_name: 'Middle CV.docx', file_type: 'docx', added_at: 't' });
    writeFileSync(join(dir, 'cv.docx.new'), makeDocx());
    writeFileSync(join(dir, 'cv-text.txt.new'), 'middle text');
    fakeAgent(ok(DRAFT_OUTPUT));
    await upload(`/api/profiles/${profile.id}/cv-analysis`, makePdf(), 'Newest CV.pdf');
    await waitFor(() => analysisOf(profile.id)?.status === 'succeeded');

    const res = await h.app.request(
      `/api/profiles/${profile.id}`,
      json('PUT', { ...UPDATED_FIELDS, cv_analysis_id: analysisOf(profile.id)!.id }),
    );
    expect(res.status).toBe(200);
    expect(readdirSync(dir).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(readFileSync(join(dir, 'cv-text.txt'), 'utf8')).toBe(CV_TEXT);
  });

  it('refuses to Save over a CV that still cannot be put in place, and keeps the analysis', async () => {
    const profile = await profileWithPdf();
    const dir = profileDir(profile.id);
    h.deps.profilesRepo.setCv(profile.id, { file_name: 'Middle CV.docx', file_type: 'docx', added_at: 't' });
    writeFileSync(join(dir, 'cv.docx.new'), makeDocx());
    // A folder in the way makes the rename fail.
    mkdirSync(join(dir, 'cv.docx', 'blocker'), { recursive: true });
    const analysis = await readyReplacement(profile);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await h.app.request(
      `/api/profiles/${profile.id}`,
      json('PUT', { ...UPDATED_FIELDS, cv_analysis_id: analysis.id }),
    );
    logged.mockRestore();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "The profile's current CV could not be put in place. Restart the app and try again.",
    });
    expect(existsSync(join(dir, 'cv.docx.new'))).toBe(true);
    expect(readdirSync(analysisDir(analysis.id)).sort()).toEqual(['cv-text.txt', 'cv.docx']);
  });

  it('drops the staged files when they cannot go back to the analysis, so they are never taken for a saved CV', async () => {
    const profile = await profileWithPdf();
    const analysis = await readyReplacement(profile);
    const original = h.deps.profilesRepo.setCv;
    h.deps.profilesRepo.setCv = () => {
      // The analysis folder disappears, so moving the files back fails too.
      rmSync(analysisDir(analysis.id), { recursive: true, force: true });
      throw new Error('disk full');
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await h.app.request(
      `/api/profiles/${profile.id}`,
      json('PUT', { ...UPDATED_FIELDS, cv_analysis_id: analysis.id }),
    );
    h.deps.profilesRepo.setCv = original;
    logged.mockRestore();
    expect(res.status).toBe(500);
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(readFileSync(join(profileDir(profile.id), 'cv-text.txt'), 'utf8')).toBe(CV_TEXT);
  });

  it('keeps everything when the name is taken', async () => {
    const profile = await profileWithPdf();
    const analysis = await readyReplacement(profile);
    const res = await h.app.request(
      `/api/profiles/${profile.id}`,
      json('PUT', { ...UPDATED_FIELDS, name: h.profile.name, cv_analysis_id: analysis.id }),
    );
    expect(res.status).toBe(409);
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(readdirSync(analysisDir(analysis.id)).sort()).toEqual(['cv-text.txt', 'cv.docx']);
  });
});

describe('deleting a profile with a CV analysis', () => {
  it('stops its agent and deletes its analysis, leaving the new-profile analysis alone', async () => {
    const calls = fakeAgent('hang');
    await upload('/api/cv-analysis', makePdf(), 'a.pdf');
    const res = await upload(`${h.base}/cv-analysis`, makePdf(), 'b.pdf');
    const forProfile = (await res.json()) as CvAnalysis;
    await waitFor(() => calls.length === 2);

    expect((await h.app.request(h.base, { method: 'DELETE' })).status).toBe(204);
    expect(calls[1]!.opts.signal!.aborted).toBe(true);
    expect(calls[0]!.opts.signal!.aborted).toBe(false);
    expect(h.deps.db.prepare('SELECT id FROM cv_analyses WHERE id = ?').get(forProfile.id)).toBeUndefined();
    // The agent had ended before the folders were deleted (Windows cannot delete a working folder).
    expect(calls[1]!.settledBeforeDelete).toBe(true);
    expect(existsSync(analysisDir(forProfile.id))).toBe(false);
    expect(analysisOf(null)!.status).toBe('running');
  });
});

describe('start-up after a crash during Save', () => {
  it('returns new files that were never committed to their analysis', async () => {
    const profile = await profileWithPdf();
    const analysis = await readyReplacement(profile);
    // The crash came after the files moved and before the database write.
    for (const name of ['cv.docx', 'cv-text.txt']) {
      renameSync(join(analysisDir(analysis.id), name), join(profileDir(profile.id), `${name}.new`));
    }
    h.deps.cvService.startup();
    expect(readdirSync(analysisDir(analysis.id)).sort()).toEqual(['cv-text.txt', 'cv.docx']);
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
    expect(readFileSync(join(profileDir(profile.id), 'cv-text.txt'), 'utf8')).toBe(CV_TEXT);
  });

  it('finishes a swap the database already committed', async () => {
    const profile = await profileWithPdf();
    const dir = profileDir(profile.id);
    // The crash came after the commit and before the rename.
    h.deps.profilesRepo.setCv(profile.id, { file_name: 'New CV.docx', file_type: 'docx', added_at: 't' });
    writeFileSync(join(dir, 'cv.docx.new'), makeDocx());
    writeFileSync(join(dir, 'cv-text.txt.new'), 'new text');
    h.deps.cvService.startup();
    expect(readdirSync(dir).sort()).toEqual(['cv-text.txt', 'cv.docx']);
    expect(readFileSync(join(dir, 'cv-text.txt'), 'utf8')).toBe('new text');
  });

  it('returns a half-staged CV, where only the first file had moved', async () => {
    const profile = await profileWithPdf();
    const analysis = await readyReplacement(profile);
    renameSync(join(analysisDir(analysis.id), 'cv.docx'), join(profileDir(profile.id), 'cv.docx.new'));
    h.deps.cvService.startup();
    expect(readdirSync(analysisDir(analysis.id)).sort()).toEqual(['cv-text.txt', 'cv.docx']);
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
  });

  it('deletes an old CV of another type left by a crash right after the renames', async () => {
    const profile = await profileWithPdf();
    h.deps.profilesRepo.setCv(profile.id, { file_name: 'New CV.docx', file_type: 'docx', added_at: 't' });
    writeFileSync(join(profileDir(profile.id), 'cv.docx'), makeDocx());
    h.deps.cvService.startup();
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.docx']);
  });

  it('drops a staged file of another type that does not belong to the stored CV', async () => {
    const profile = await profileWithPdf();
    writeFileSync(join(profileDir(profile.id), 'cv.docx.new'), makeDocx());
    h.deps.cvService.startup();
    expect(readdirSync(profileDir(profile.id)).sort()).toEqual(['cv-text.txt', 'cv.pdf']);
  });

  it('drops new files of a profile whose analysis is gone and that has no CV', async () => {
    mkdirSync(profileDir(h.profile.id), { recursive: true });
    writeFileSync(join(profileDir(h.profile.id), 'cv.pdf.new'), 'x');
    h.deps.cvService.startup();
    expect(existsSync(profileDir(h.profile.id))).toBe(false);
  });
});
