import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { HttpError, readJson } from './errors.js';
import type { ProfileEnv } from './profiles.js';

// The proposals the Review page showed, so a sync that lands meanwhile is never accepted unseen (decision 15A).
const AcceptManyBody = z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) }).strict();

// New applications proposed by Gmail sync (SOW-0045). Each belongs to a profile; another profile's id is 404.
export function createApplicationProposalsRouter(deps: AppDeps): Hono<ProfileEnv> {
  const router = new Hono<ProfileEnv>();

  function requireOwned(c: Context<ProfileEnv>, id: string): string {
    const proposal = deps.applicationProposalsRepo.get(id);
    if (!proposal || proposal.profile_id !== c.get('profile').id) throw new HttpError(404, 'Application proposal not found');
    return id;
  }

  router.get('/', (c) => c.json(deps.applicationProposalsRepo.listPending(c.get('profile').id)));

  // Before the /:id routes, so "accept-all" is never read as an id.
  router.post('/accept-all', async (c) => {
    const { ids } = await readJson(c, AcceptManyBody);
    // Every id is checked before any write: one foreign id refuses the whole request.
    for (const id of ids) requireOwned(c, id);
    return c.json(deps.applicationProposalService.acceptMany(ids));
  });

  router.post('/:id/accept', (c) =>
    c.json(deps.applicationProposalService.accept(requireOwned(c, c.req.param('id')))),
  );

  router.post('/:id/reject', (c) =>
    c.json({ proposal: deps.applicationProposalService.reject(requireOwned(c, c.req.param('id'))) }),
  );

  return router;
}
