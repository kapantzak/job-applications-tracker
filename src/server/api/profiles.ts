import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { ProfileInput } from '../db/profiles-repo.js';
import {
  isValidProfileName,
  normalizeProfileName,
  PROFILE_NAME_ERROR,
} from '../domain/profile-name.js';
import type { CvFileType, Profile } from '../domain/types.js';
import { createApplicationsRouter } from './applications.js';
import { createCvAnalysisRouter } from './cv-analysis.js';
import { HttpError, readJson } from './errors.js';
import { createJobsRouter } from './jobs.js';
import { createProposalsRouter } from './proposals.js';
import { createProfileRunsRouter } from './runs.js';

// Profile-scoped routers read the profile the middleware below loaded, never the raw param.
export type ProfileEnv = { Variables: { profile: Profile } };

const profileFields = {
  name: z
    .string()
    .transform(normalizeProfileName)
    .pipe(z.string().min(1, 'Name is required').refine(isValidProfileName, PROFILE_NAME_ERROR)),
  target_roles: z.array(z.string()),
  locations: z.array(z.string()),
  remote: z.enum(['remote', 'hybrid', 'onsite', 'any']),
  seniority: z.string(),
  keywords: z.array(z.string()),
  excluded_companies: z.array(z.string()),
  notes: z.string(),
};

// Create profile may take the new-profile CV analysis it was reviewed from (SOW-0023); Save may take the
// profile's own analysis whose suggestions were applied, which also replaces its CV (SOW-0024).
const ProfileBody = z.object({ ...profileFields, cv_analysis_id: z.string().min(1).optional() }).strict();

const CV_CONTENT_TYPES: Record<CvFileType, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

// RFC 6266: an ASCII fallback plus the exact name in UTF-8.
function attachment(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  // RFC 5987 leaves ' ( ) * out of attr-char; encodeURIComponent keeps them.
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// For handlers that await before writing: the profile may have been deleted meanwhile. Call it right
// before the synchronous write so nothing can run in between.
export function requireProfileStill(deps: AppDeps, id: string): void {
  if (!deps.profilesRepo.get(id)) throw new HttpError(404, 'Profile not found');
}

export function createProfilesRouter(deps: AppDeps): Hono {
  const router = new Hono();
  const scoped = new Hono<ProfileEnv>();

  function requireFreeName(name: string, exceptId?: string): void {
    if (deps.profilesRepo.nameTaken(name, exceptId)) {
      throw new HttpError(409, `A profile named "${name}" already exists`);
    }
  }

  router.get('/', (c) => c.json(deps.profilesRepo.list()));

  router.post('/', async (c) => {
    const { cv_analysis_id: analysisId, ...input } = await readJson(c, ProfileBody);
    requireFreeName(input.name);
    const profile = analysisId
      ? deps.cvService.createProfile(input, analysisId, randomUUID())
      : deps.profilesRepo.create(input);
    return c.json(profile, 201);
  });

  // Lets the UI turn a URL slug into the profile; data routes stay keyed by id (SOW-0015). Registered
  // before the scoped routes so `by-slug` is never taken for a profile id.
  router.get('/by-slug/:slug', (c) => {
    const profile = deps.profilesRepo.getBySlug(c.req.param('slug'));
    if (!profile) throw new HttpError(404, 'Profile not found');
    return c.json(profile);
  });

  // Every route below this point belongs to one existing profile; unknown ids stop here with 404.
  // Hono's `/:pid/*` also matches `/:pid` itself.
  scoped.use('/:pid/*', async (c, next) => {
    const profile = deps.profilesRepo.get(c.req.param('pid'));
    if (!profile) throw new HttpError(404, 'Profile not found');
    c.set('profile', profile);
    await next();
  });

  scoped.get('/:pid', (c) => c.json(c.get('profile')));

  scoped.put('/:pid', async (c) => {
    const { id } = c.get('profile');
    const { cv_analysis_id: analysisId, ...input } = await readJson(c, ProfileBody);
    requireFreeName(input.name, id);
    return c.json(
      analysisId ? deps.cvService.applyToProfile(input, analysisId, id) : deps.profilesRepo.update(id, input),
    );
  });

  // Refused while a run is queued or running, so no handler writes into a deleted profile (SOW-0014).
  // The check and the delete run in the same tick, so the queue cannot start a run in between.
  scoped.delete('/:pid', async (c) => {
    const { id } = c.get('profile');
    if (deps.runsRepo.hasActiveForProfile(id)) {
      throw new HttpError(409, 'This profile has a queued or running run; cancel it first');
    }
    // Read before the rows go: the transaction below deletes the analysis row with the profile.
    const analysis = deps.cvService.current(id);
    const runIds = deps.profilesRepo.remove(id);
    try {
      deps.logStore.remove(runIds);
    } catch (err) {
      // The rows are gone; a leftover log file is harmless and Purge run logs removes it later.
      console.error(`profile ${id}: failed to remove run logs: ${err instanceof Error ? err.message : err}`);
    }
    // After the rows are gone, so nothing can start in between; a folder it cannot remove is logged and
    // swept at the next start-up.
    await deps.cvService.removeProfileFiles(id, analysis?.id ?? null);
    return c.body(null, 204);
  });

  scoped.get('/:pid/cv', (c) => {
    const found = deps.cvService.profileCvPath(c.get('profile').id);
    if (!found) throw new HttpError(404, 'This profile has no CV');
    let bytes: Buffer;
    try {
      bytes = readFileSync(found.path);
    } catch {
      throw new HttpError(404, 'The CV file is missing');
    }
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': CV_CONTENT_TYPES[found.cv.file_type],
      'Content-Disposition': attachment(found.cv.file_name),
      'X-Content-Type-Options': 'nosniff',
    });
  });

  // Remove CV (decision 21) deletes the file and its extracted text; the profile itself stays.
  scoped.delete('/:pid/cv', (c) => {
    const { id } = c.get('profile');
    if (!deps.profilesRepo.storedCv(id)) throw new HttpError(404, 'This profile has no CV');
    return c.json(deps.cvService.removeProfileCv(id));
  });

  scoped.route(
    '/:pid/cv-analysis',
    createCvAnalysisRouter(deps, (c) => c.get('profile').id),
  );
  scoped.route('/:pid/jobs', createJobsRouter(deps));
  scoped.route('/:pid/applications', createApplicationsRouter(deps));
  scoped.route('/:pid/proposals', createProposalsRouter(deps));
  scoped.route('/:pid/runs', createProfileRunsRouter(deps));

  router.route('/', scoped);
  return router;
}
