import type { createApplicationsRepo } from '../db/applications-repo.js';
import type { createProposalsRepo, NewProposal } from '../db/proposals-repo.js';
import type { createSettingsRepo } from '../db/settings-repo.js';
import type { Settings } from '../domain/types.js';
import type { MailSource } from '../mail/types.js';
import type { RunHandler } from '../runs/queue.js';

export interface MailSyncDeps {
  applicationsRepo: ReturnType<typeof createApplicationsRepo>;
  proposalsRepo: ReturnType<typeof createProposalsRepo>;
  settingsRepo: ReturnType<typeof createSettingsRepo>;
  mailSourceFactory: (settings: Settings) => MailSource;
}

export function createMailSyncHandler(deps: MailSyncDeps): RunHandler {
  const { applicationsRepo, proposalsRepo, settingsRepo, mailSourceFactory } = deps;

  return async (ctx) => {
    const profileId = ctx.run.profile_id;
    const open = applicationsRepo.list(profileId, { open: true });
    if (open.length === 0) {
      ctx.log('No open applications to check');
      return { summary: 'no open applications' };
    }

    const settings = settingsRepo.getAll();
    const source = mailSourceFactory(settings);
    const findings = await source.sync(
      {
        applications: open.map((a) => ({
          id: a.id,
          company: a.company,
          role: a.role,
          // Open applications always have applied_at; fall back to be safe.
          applied_at: a.applied_at ?? a.created_at,
          sender_domains: a.sender_domains,
        })),
        reviewed_message_ids: proposalsRepo.reviewedMessageIds(profileId),
      },
      {
        log: ctx.log,
        signal: ctx.signal,
        runDir: ctx.runDir,
        timeoutMs: settings.run_timeout_ms,
        recordAgent: ctx.recordAgent,
      },
    );

    // Past this point the run cannot be cancelled; throws if a cancel or shutdown came first.
    ctx.beginSaving();

    const known = new Set(open.map((a) => a.id));
    const collected: NewProposal[] = [];
    let skipped = 0;
    // hasPending only sees stored rows, so track repeats within this response too.
    const seen = new Set<string>();
    for (const f of findings.findings) {
      if (f.proposed_status === 'no_change') continue;
      if (!known.has(f.application_id)) {
        ctx.log(`Dropping finding for unknown application ${f.application_id}`);
        continue;
      }
      const key = `${f.application_id}|${f.proposed_status}`;
      if (seen.has(key)) {
        ctx.log(`Skipping duplicate finding for ${f.application_id} (${f.proposed_status})`);
        skipped++;
        continue;
      }
      seen.add(key);
      if (proposalsRepo.hasPending(f.application_id, f.proposed_status)) {
        skipped++;
        continue;
      }
      collected.push({
        application_id: f.application_id,
        proposed_status: f.proposed_status,
        confidence: f.confidence,
        reason: f.reason,
        evidence: f.evidence,
      });
    }
    if (collected.length > 0) proposalsRepo.createMany(ctx.run.id, collected);

    const summary = `${collected.length} proposals created, ${skipped} skipped`;
    ctx.log(summary);
    return { summary, promptVersion: findings.promptVersion, adapterId: findings.adapterId ?? settings.adapter_id };
  };
}
