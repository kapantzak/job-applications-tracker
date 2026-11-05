import { Hono } from 'hono';
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

  function createFromJob(id: string, status: ApplicationStatus) {
    const job = requireJob(id);
    const url = job.canonical_url ?? job.url;
    const domain = inferSenderDomain(url);
    return deps.applicationsRepo.create({
      job_id: job.id,
      company: job.company,
      role: job.title,
      url,
      status,
      sender_domains: domain ? [domain] : [],
    });
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

  router.post('/:id/save', (c) => c.json(createFromJob(c.req.param('id'), 'saved'), 201));

  router.post('/:id/applied', (c) => c.json(createFromJob(c.req.param('id'), 'applied'), 201));

  return router;
}
