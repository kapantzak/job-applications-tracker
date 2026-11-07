import { Hono, type Context } from 'hono';
import type { AppDeps } from '../app.js';
import { HttpError } from './errors.js';
import type { ProfileEnv } from './profiles.js';

export function createProposalsRouter(deps: AppDeps): Hono<ProfileEnv> {
  const router = new Hono<ProfileEnv>();

  // The service reports a missing proposal as a plain Error; check first so it maps to 404. A
  // proposal belongs to its application's profile.
  function requireProposal(c: Context<ProfileEnv>, id: string): string {
    const proposal = deps.proposalsRepo.get(id);
    const owner = proposal ? deps.applicationsRepo.get(proposal.application_id)?.profile_id : undefined;
    if (!proposal || owner !== c.get('profile').id) throw new HttpError(404, 'Proposal not found');
    return id;
  }

  router.get('/', (c) =>
    c.json(
      deps.proposalsRepo
        .listPending(c.get('profile').id)
        .map((p) => ({ ...p, application: deps.applicationsRepo.get(p.application_id) })),
    ),
  );

  router.post('/:id/accept', (c) => c.json(deps.proposalService.accept(requireProposal(c, c.req.param('id')))));

  router.post('/:id/reject', (c) => {
    const proposal = deps.proposalService.reject(requireProposal(c, c.req.param('id')));
    return c.json({ proposal });
  });

  return router;
}
