import { Hono, type Context } from 'hono';
import type { AppDeps } from '../app.js';
import { inferSenderDomain } from '../db/applications-repo.js';
import type { ApplicationStatus, Job } from '../domain/types.js';
import { HttpError } from './errors.js';
import type { ProfileEnv } from './profiles.js';

function flag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function createJobsRouter(deps: AppDeps): Hono<ProfileEnv> {
  const router = new Hono<ProfileEnv>();

  // Another profile's job is reported as missing, so ids never cross profiles.
  function requireJob(c: Context<ProfileEnv>, id: string): Job {
    const job = deps.jobsRepo.get(id);
    if (!job || job.profile_id !== c.get('profile').id) throw new HttpError(404, 'Job not found');
    return job;
  }

  // Returns the application plus whether it was newly created, so repeated clicks stay idempotent.
  function createFromJob(c: Context<ProfileEnv>, id: string, status: ApplicationStatus) {
    const job = requireJob(c, id);
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
      profile_id: job.profile_id,
      job_id: job.id,
      company: job.company,
      role: job.title,
      url,
      status,
      sender_domains: domain ? [domain] : [],
    });
    return { app, created: true };
  }

  function respond(c: Context<ProfileEnv>, id: string, status: ApplicationStatus) {
    const { app, created } = createFromJob(c, id, status);
    return c.json(app, created ? 201 : 200);
  }

  router.get('/', (c) =>
    c.json(
      deps.jobsRepo.list(c.get('profile').id, {
        includeDead: flag(c.req.query('includeDead')),
        includeDismissed: flag(c.req.query('includeDismissed')),
      }),
    ),
  );

  router.post('/:id/dismiss', (c) => {
    deps.jobsRepo.dismiss(requireJob(c, c.req.param('id')).id);
    return c.body(null, 204);
  });

  router.post('/:id/save', (c) => respond(c, c.req.param('id'), 'saved'));

  router.post('/:id/applied', (c) => respond(c, c.req.param('id'), 'applied'));

  return router;
}
