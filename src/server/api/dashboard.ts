import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { summarizeDashboard, type DashboardResponse } from '../domain/dashboard.js';
import type { ProfileEnv } from './profiles.js';

export function createDashboardRouter(deps: AppDeps): Hono<ProfileEnv> {
  const router = new Hono<ProfileEnv>();

  // All applications (open or closed): the charts count every status.
  router.get('/', (c) => {
    const profileId = c.get('profile').id;
    const body: DashboardResponse = {
      ...summarizeDashboard(
        deps.applicationsRepo.list(profileId),
        deps.applicationsRepo.historyForProfile(profileId),
        deps.proposalsRepo.listPending(profileId).length,
        new Date(),
      ),
      pending_new_applications: deps.applicationProposalsRepo.listPending(profileId).length,
    };
    return c.json(body);
  });

  return router;
}
