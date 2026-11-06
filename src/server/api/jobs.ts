import { Hono, type Context } from 'hono';
import type { AppDeps } from '../app.js';
import { inferSenderDomain } from '../db/applications-repo.js';
import type { ApplicationStatus, Job } from '../domain/types.js';
import { HttpError } from './errors.js';

function flag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function createJobsRouter(deps: AppDeps): Hono {
  const router = new Hono();

  function requireJob(id: string): Job {
    const job = deps.jobsRepo.get(id);
    if (!job) throw new HttpError(404, 'Job not found');
    return job;
  }

  // Returns the application plus whether it was newly created, so repeated clicks stay idempotent.
  function createFromJob(id: string, status: ApplicationStatus) {
    const job = requireJob(id);
    const existing = deps.applicationsRepo.findByJobId(job.id);
    if (existing) {
      if (status === 'applied' && existing.status === 'saved') {
        // One transaction so a crash cannot leave an applied row without applied_at.
        const advanced = deps.db.transaction(() => {
          deps.applicationsRepo.setStatus(existing.id, 'applied', 'user');
          return deps.applicationsRepo.update(existing.id, { applied_at: new Date().toISOString() });
        })();
        return { app: advanced, created: false };
      }
      return { app: existing, created: false };
    }
    const url = job.canonical_url ?? job.url;
    const domain = inferSenderDomain(url);
    const app = deps.applicationsRepo.create({
      job_id: job.id,
      company: job.company,
      role: job.title,
      url,
      status,
      sender_domains: domain ? [domain] : [],
    });
    return { app, created: true };
  }

  function respond(c: Context, id: string, status: ApplicationStatus) {
    const { app, created } = createFromJob(id, status);
    return c.json(app, created ? 201 : 200);
  }

  router.get('/', (c) =>
    c.json(
      deps.jobsRepo.list({
        includeDead: flag(c.req.query('includeDead')),
        includeDismissed: flag(c.req.query('includeDismissed')),
      }),
    ),
  );

  router.post('/:id/dismiss', (c) => {
    deps.jobsRepo.dismiss(requireJob(c.req.param('id')).id);
    return c.body(null, 204);
  });

  router.post('/:id/save', (c) => respond(c, c.req.param('id'), 'saved'));

  router.post('/:id/applied', (c) => respond(c, c.req.param('id'), 'applied'));

  return router;
}
