import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { PROFILE_NAME_MAX } from '../db/migrations.js';
import type { ProfileInput } from '../db/profiles-repo.js';
import type { Profile } from '../domain/types.js';
import { createApplicationsRouter } from './applications.js';
import { HttpError, readJson } from './errors.js';
import { createJobsRouter } from './jobs.js';
import { createProposalsRouter } from './proposals.js';
import { createProfileRunsRouter } from './runs.js';

// Profile-scoped routers read the profile the middleware below loaded, never the raw param.
export type ProfileEnv = { Variables: { profile: Profile } };

const ProfileBody = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(PROFILE_NAME_MAX),
    target_roles: z.array(z.string()),
    locations: z.array(z.string()),
    remote: z.enum(['remote', 'hybrid', 'onsite', 'any']),
    seniority: z.string(),
    keywords: z.array(z.string()),
    excluded_companies: z.array(z.string()),
    notes: z.string(),
  })
  .strict();

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
    const input: ProfileInput = await readJson(c, ProfileBody);
    requireFreeName(input.name);
    return c.json(deps.profilesRepo.create(input), 201);
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
    const input: ProfileInput = await readJson(c, ProfileBody);
    requireFreeName(input.name, id);
    return c.json(deps.profilesRepo.update(id, input));
  });

  // Refused while a run is queued or running, so no handler writes into a deleted profile (SOW-0014).
  // The check and the delete run in the same tick, so the queue cannot start a run in between.
  scoped.delete('/:pid', (c) => {
    const { id } = c.get('profile');
    if (deps.runsRepo.hasActiveForProfile(id)) {
      throw new HttpError(409, 'This profile has a queued or running run; cancel it first');
    }
    const runIds = deps.profilesRepo.remove(id);
    try {
      deps.logStore.remove(runIds);
    } catch (err) {
      // The rows are gone; a leftover log file is harmless and Purge run logs removes it later.
      console.error(`profile ${id}: failed to remove run logs: ${err instanceof Error ? err.message : err}`);
    }
    return c.body(null, 204);
  });

  scoped.route('/:pid/jobs', createJobsRouter(deps));
  scoped.route('/:pid/applications', createApplicationsRouter(deps));
  scoped.route('/:pid/proposals', createProposalsRouter(deps));
  scoped.route('/:pid/runs', createProfileRunsRouter(deps));

  router.route('/', scoped);
  return router;
}
