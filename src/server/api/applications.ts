import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { inferSenderDomain, type ApplicationPatch, type NewApplication } from '../db/applications-repo.js';
import { APPLICATION_STATUSES, type Application } from '../domain/types.js';
import { HttpError, readJson } from './errors.js';
import { requireProfileStill, type ProfileEnv } from './profiles.js';

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// The UI renders url as a link, so javascript: and similar schemes must never be stored.
const HttpUrl = z.string().refine(isHttpUrl, 'Must be an http(s) URL');

const NewApplicationBody = z
  .object({
    company: z.string().min(1),
    role: z.string().min(1),
    url: HttpUrl.nullable().optional(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    applied_at: z.string().nullable().optional(),
    notes: z.string().optional(),
    sender_domains: z.array(z.string().min(1)).max(20).optional(),
  })
  .strict();

// Allow-list: status changes go through /status so they always leave a history row.
const ApplicationPatchBody = z
  .object({
    company: z.string().min(1),
    role: z.string().min(1),
    url: HttpUrl.nullable(),
    notes: z.string().nullable(),
    sender_domains: z.array(z.string()),
    applied_at: z.string().nullable(),
  })
  .partial()
  .strict();

const StatusBody = z.object({ status: z.enum(APPLICATION_STATUSES) }).strict();

export function createApplicationsRouter(deps: AppDeps): Hono<ProfileEnv> {
  const router = new Hono<ProfileEnv>();

  // Another profile's application is reported as missing, so ids never cross profiles.
  function requireApplication(c: Context<ProfileEnv>, id: string): Application {
    const app = deps.applicationsRepo.get(id);
    if (!app || app.profile_id !== c.get('profile').id) throw new HttpError(404, 'Application not found');
    return app;
  }

  router.get('/', (c) =>
    c.json(deps.applicationsRepo.list(c.get('profile').id, { open: c.req.query('open') === '1' })),
  );

  router.post('/', async (c) => {
    const body = await readJson(c, NewApplicationBody);
    requireProfileStill(deps, c.get('profile').id);
    const input: NewApplication = { ...body, profile_id: c.get('profile').id };
    if (input.sender_domains === undefined) {
      const domain = input.url ? inferSenderDomain(input.url) : null;
      input.sender_domains = domain ? [domain] : [];
    }
    return c.json(deps.applicationsRepo.create(input), 201);
  });

  router.get('/:id', (c) => {
    const app = requireApplication(c, c.req.param('id'));
    return c.json({ ...app, history: deps.applicationsRepo.history(app.id) });
  });

  router.patch('/:id', async (c) => {
    const app = requireApplication(c, c.req.param('id'));
    const patch: ApplicationPatch = await readJson(c, ApplicationPatchBody);
    return c.json(deps.applicationsRepo.update(app.id, patch));
  });

  router.post('/:id/status', async (c) => {
    const app = requireApplication(c, c.req.param('id'));
    const { status } = await readJson(c, StatusBody);
    return c.json(deps.applicationsRepo.setStatus(app.id, status, 'user'));
  });

  return router;
}
