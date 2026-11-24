import type { ApplicationProposalsRepo } from '../db/application-proposals-repo.js';
import type { createApplicationsRepo } from '../db/applications-repo.js';
import type { Db } from '../db/connection.js';
import { matchKey, toChangedAt } from '../domain/new-application.js';
import type { Application, ApplicationProposal } from '../domain/types.js';
import { ProposalNotPendingError } from './proposals.js';

export interface ApplicationProposalServiceDeps {
  db: Db;
  applicationProposalsRepo: ApplicationProposalsRepo;
  applicationsRepo: ReturnType<typeof createApplicationsRepo>;
}

// created: a new application; moved: a saved one took the proposed status; already_tracked: nothing changed.
export type AcceptOutcome = 'created' | 'moved' | 'already_tracked';

export type AcceptManyResult = { accepted: number } & Record<AcceptOutcome, number>;

export interface AcceptResult {
  proposal: ApplicationProposal;
  application: Application;
  outcome: AcceptOutcome;
}

// Accepting a new-application proposal creates the application (SOW-0045). Like Add application, it writes
// no history row: the Dashboard reads the starting status from the first row's from_status.
export function createApplicationProposalService({
  db,
  applicationProposalsRepo,
  applicationsRepo,
}: ApplicationProposalServiceDeps) {
  function requirePending(id: string): ApplicationProposal {
    const proposal = applicationProposalsRepo.get(id);
    if (!proposal) throw new Error(`Application proposal not found: ${id}`);
    if (proposal.state !== 'pending') throw new ProposalNotPendingError(id);
    return proposal;
  }

  // The user may have saved the job or added the application since the sync (decision 11C): a saved one moves
  // on like a status proposal (10A), any other one stays as it is, and nothing is added twice.
  function existingFor(p: ApplicationProposal): Application | null {
    const viaJob = p.job_id ? applicationsRepo.findByJobId(p.job_id) : null;
    if (viaJob) return viaJob;
    const key = matchKey(p.company, p.role);
    const apps = applicationsRepo.list(p.profile_id);
    const own = apps.find((a) => matchKey(a.company, a.role) === key);
    if (own) return own;
    // An alias is a name of an application merged into this one; it counts after every own name (SOW-0055, 9A).
    const aliases = applicationsRepo.aliasesForProfile(p.profile_id);
    return apps.find((a) => (aliases.get(a.id) ?? []).some((n) => matchKey(n.company, n.role) === key)) ?? null;
  }

  function acceptOne(id: string): AcceptResult {
    const p = requirePending(id);
    const existing = existingFor(p);
    if (existing) {
      let application = existing;
      if (existing.status === 'saved') {
        // proposal_id stays null: status_history references the proposals table, not this one.
        application = applicationsRepo.setStatus(existing.id, p.status, 'proposal');
        if (existing.applied_at === null) application = applicationsRepo.update(existing.id, { applied_at: p.applied_at });
      }
      const proposal = applicationProposalsRepo.decide(id, 'accepted', existing.id);
      return { proposal, application, outcome: existing.status === 'saved' ? 'moved' : 'already_tracked' };
    }
    const application = applicationsRepo.create({
      profile_id: p.profile_id,
      job_id: p.job_id,
      company: p.company,
      role: p.role,
      url: p.url,
      status: p.status,
      applied_at: p.applied_at,
      sender_domains: p.sender_domains,
      status_changed_at: toChangedAt(p.evidence.date, p.applied_at, new Date()),
    });
    return { proposal: applicationProposalsRepo.decide(id, 'accepted', application.id), application, outcome: 'created' };
  }

  const accept = db.transaction(acceptOne);

  // Only what the user saw and confirmed (decision 15A), in one transaction; ones decided meanwhile are skipped.
  // The caller checks that every id belongs to the profile.
  // The counts tell the user what happened, since tracked ones add nothing (decision 19A).
  const acceptMany = db.transaction((ids: string[]): AcceptManyResult => {
    const counts: AcceptManyResult = { accepted: 0, created: 0, moved: 0, already_tracked: 0 };
    for (const id of ids) {
      if (applicationProposalsRepo.get(id)?.state !== 'pending') continue;
      counts[acceptOne(id).outcome]++;
      counts.accepted++;
    }
    return counts;
  });

  function reject(id: string): ApplicationProposal {
    requirePending(id);
    return applicationProposalsRepo.decide(id, 'rejected', null);
  }

  return { accept: (id: string) => accept(id), acceptMany: (ids: string[]) => acceptMany(ids), reject };
}
