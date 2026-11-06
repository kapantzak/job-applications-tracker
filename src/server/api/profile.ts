import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { ProfileInput } from '../db/profile-repo.js';
import { readJson } from './errors.js';

const ProfileBody = z
  .object({
    target_roles: z.array(z.string()),
    locations: z.array(z.string()),
    remote: z.enum(['remote', 'hybrid', 'onsite', 'any']),
    seniority: z.string(),
    keywords: z.array(z.string()),
    excluded_companies: z.array(z.string()),
    notes: z.string(),
  })
  .strict();

export function createProfileRouter(deps: AppDeps): Hono {
  const router = new Hono();

  // null (not 404) so the UI can tell "no profile yet" from a broken request.
  router.get('/', (c) => c.json(deps.profileRepo.get()));

  router.put('/', async (c) => {
    const input: ProfileInput = await readJson(c, ProfileBody);
    return c.json(deps.profileRepo.save(input));
  });

  return router;
}
