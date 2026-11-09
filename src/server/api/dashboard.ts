import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { summarizeDashboard } from '../domain/dashboard.js';
import type { ProfileEnv } from './profiles.js';

export function createDashboardRouter(deps: AppDeps): Hono<ProfileEnv> {
  const router = new Hono<ProfileEnv>();

  // All applications (open or closed): the charts count every status.
  router.get('/', (c) => {
    const profileId = c.get('profile').id;
    return c.json(
      summarizeDashboard(
        deps.applicationsRepo.list(profileId),
        deps.applicationsRepo.historyForProfile(profileId),
        deps.proposalsRepo.listPending(profileId).length,
        new Date(),
      ),
    );
  });

  return router;
}
