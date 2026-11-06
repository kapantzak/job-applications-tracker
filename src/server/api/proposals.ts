import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { HttpError } from './errors.js';

export function createProposalsRouter(deps: AppDeps): Hono {
  const router = new Hono();

  // The service reports a missing proposal as a plain Error; check first so it maps to 404.
  function requireProposal(id: string): string {
    if (!deps.proposalsRepo.get(id)) throw new HttpError(404, 'Proposal not found');
    return id;
  }

  router.get('/', (c) =>
    c.json(
      deps.proposalsRepo
        .listPending()
        .map((p) => ({ ...p, application: deps.applicationsRepo.get(p.application_id) })),
    ),
  );

  router.post('/:id/accept', (c) => c.json(deps.proposalService.accept(requireProposal(c.req.param('id')))));

  router.post('/:id/reject', (c) => {
    const proposal = deps.proposalService.reject(requireProposal(c.req.param('id')));
    return c.json({ proposal });
  });

  return router;
}
