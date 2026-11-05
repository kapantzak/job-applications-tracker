import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { ApplicationPatch, NewApplication } from '../db/applications-repo.js';
import { APPLICATION_STATUSES, type Application } from '../domain/types.js';
import { HttpError, readJson } from './errors.js';

const NewApplicationBody = z
  .object({
    company: z.string().min(1),
    role: z.string().min(1),
    url: z.string().nullable().optional(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    applied_at: z.string().nullable().optional(),
    notes: z.string().optional(),
  })
  .strict();

// Allow-list: status changes go through /status so they always leave a history row.
const ApplicationPatchBody = z
  .object({
    company: z.string().min(1),
    role: z.string().min(1),
    url: z.string().nullable(),
    notes: z.string().nullable(),
    sender_domains: z.array(z.string()),
    applied_at: z.string().nullable(),
  })
  .partial()
  .strict();

const StatusBody = z.object({ status: z.enum(APPLICATION_STATUSES) }).strict();

export function createApplicationsRouter(deps: AppDeps): Hono {
  const router = new Hono();

  function requireApplication(id: string): Application {
    const app = deps.applicationsRepo.get(id);
    if (!app) throw new HttpError(404, 'Application not found');
    return app;
  }

  router.get('/', (c) => c.json(deps.applicationsRepo.list({ open: c.req.query('open') === '1' })));

  router.post('/', async (c) => {
    const input: NewApplication = await readJson(c, NewApplicationBody);
    return c.json(deps.applicationsRepo.create(input), 201);
  });

  router.get('/:id', (c) => {
    const app = requireApplication(c.req.param('id'));
    return c.json({ ...app, history: deps.applicationsRepo.history(app.id) });
  });

  router.patch('/:id', async (c) => {
    const app = requireApplication(c.req.param('id'));
    const patch: ApplicationPatch = await readJson(c, ApplicationPatchBody);
    return c.json(deps.applicationsRepo.update(app.id, patch));
  });

  router.post('/:id/status', async (c) => {
    const app = requireApplication(c.req.param('id'));
    const { status } = await readJson(c, StatusBody);
    return c.json(deps.applicationsRepo.setStatus(app.id, status, 'user'));
  });

  return router;
}
