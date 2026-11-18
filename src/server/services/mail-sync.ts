import type { ApplicationProposalsRepo, NewApplicationProposal } from '../db/application-proposals-repo.js';
import { inferSenderDomain, type createApplicationsRepo } from '../db/applications-repo.js';
import type { Db } from '../db/connection.js';
import type { createJobsRepo } from '../db/jobs-repo.js';
import type { ProfilesRepo } from '../db/profiles-repo.js';
import type { createProposalsRepo, NewProposal } from '../db/proposals-repo.js';
import type { createSettingsRepo } from '../db/settings-repo.js';
import { mailScopeQuery } from '../domain/mail-filter.js';
import { cleanName, cleanSenderDomain, gmailDay, matchKey, toAppliedAt } from '../domain/new-application.js';
import { SCOPE_MATCHED_NOTHING_NOTE, type Application, type Settings } from '../domain/types.js';
import type { MailSource } from '../mail/types.js';
import type { RunContext, RunHandler } from '../runs/queue.js';
import type { NewApplicationResult } from '../tasks/schemas.js';

export interface MailSyncDeps {
  db: Db;
  applicationsRepo: ReturnType<typeof createApplicationsRepo>;
  applicationProposalsRepo: ApplicationProposalsRepo;
  jobsRepo: ReturnType<typeof createJobsRepo>;
  profilesRepo: ProfilesRepo;
  proposalsRepo: ReturnType<typeof createProposalsRepo>;
  settingsRepo: ReturnType<typeof createSettingsRepo>;
  mailSourceFactory: (settings: Settings) => MailSource;
}

// Without a Gmail scope, new applications are searched this far back (decision 3).
const NEW_APPLICATION_LOOKBACK_DAYS = 90;
// The prompt asks for at most this many; the handler enforces it (decision 3).
const NEW_APPLICATION_MAX = 50;

export function createMailSyncHandler(deps: MailSyncDeps): RunHandler {
  const { db, applicationsRepo, applicationProposalsRepo, jobsRepo, profilesRepo, proposalsRepo, settingsRepo, mailSourceFactory } =
    deps;

  // What the agent must not report as new (decision 14A): applications that are neither open (listed in the
  // prompt) nor saved (10A needs those reported), and every new-application proposal of the profile.
  function trackedNames(profileId: string, open: Set<string>): { company: string; role: string }[] {
    const apps = applicationsRepo.list(profileId);
    const saved = new Set(apps.filter((a) => a.status === 'saved').map((a) => matchKey(a.company, a.role)));
    const closed = apps
      .filter((a) => a.status !== 'saved' && !open.has(a.id))
      .map((a) => ({ company: a.company, role: a.role }));
    // A proposal that shares a saved application's company and role must not hide that application's mail.
    const proposed = applicationProposalsRepo.names(profileId).filter((p) => !saved.has(matchKey(p.company, p.role)));
    return [...closed, ...proposed];
  }

  // Agent output is untrusted: names are cleaned, matches checked against every application of the profile,
  // and repeats dropped. A match with a saved application becomes a status proposal for it (decision 10A).
  function collectNewApplications(
    entries: NewApplicationResult[],
    profileId: string,
    statusProposals: NewProposal[],
    findingMessages: string[],
    ctx: RunContext,
  ): { items: NewApplicationProposal[]; skipped: number } {
    const now = new Date();
    const tracked = new Map<string, Application>();
    // Newest first, so the newest application with a key wins.
    for (const app of applicationsRepo.list(profileId)) {
      const key = matchKey(app.company, app.role);
      if (!tracked.has(key)) tracked.set(key, app);
    }
    // Any earlier proposal, pending or decided, blocks its company and role (decision 12A).
    const seenKeys = new Set(applicationProposalsRepo.names(profileId).map((p) => matchKey(p.company, p.role)));
    // A message that is evidence elsewhere is not a new application (S2).
    // A blank id identifies nothing, so it never counts as used.
    const seenMessages = new Set(
      [...applicationProposalsRepo.messageIds(profileId), ...proposalsRepo.reviewedMessageIds(profileId), ...findingMessages].filter(
        (id) => id.trim() !== '',
      ),
    );
    const used = (id: string) => id.trim() !== '' && seenMessages.has(id);
    const savedSeen = new Set<string>();
    const jobs = jobsRepo.list(profileId, { includeDead: true, includeDismissed: true });
    const items: NewApplicationProposal[] = [];
    let skipped = 0;
    let capped = false;

    for (const entry of entries) {
      const company = cleanName(entry.company);
      const role = cleanName(entry.role);
      if (!company || !role) {
        ctx.log('Dropping new application without a company or role');
        skipped++;
        continue;
      }
      const key = matchKey(company, role);
      const appliedAt = toAppliedAt(entry.applied_at, entry.evidence.date, now);
      const existing = tracked.get(key);
      if (existing?.status === 'saved') {
        // One proposal per saved application and response (S5).
        const repeat = savedSeen.has(existing.id) || used(entry.evidence.message_id);
        if (repeat || proposalsRepo.hasPending(existing.id, entry.status)) {
          ctx.log(`Skipping new application for a saved one already proposed: ${company} - ${role}`);
          skipped++;
          continue;
        }
        savedSeen.add(existing.id);
        seenMessages.add(entry.evidence.message_id);
        statusProposals.push({
          application_id: existing.id,
          proposed_status: entry.status,
          confidence: entry.confidence,
          reason: entry.reason,
          evidence: entry.evidence,
          applied_at: appliedAt,
        });
        continue;
      }
      if (existing) {
        ctx.log(`Skipping new application already tracked: ${company} - ${role}`);
        skipped++;
        continue;
      }
      if (seenKeys.has(key)) {
        ctx.log(`Skipping new application already proposed: ${company} - ${role}`);
        skipped++;
        continue;
      }
      if (used(entry.evidence.message_id)) {
        ctx.log(`Skipping new application from a message already used: ${company} - ${role}`);
        skipped++;
        continue;
      }
      if (items.length >= NEW_APPLICATION_MAX) {
        ctx.log(`Skipping new application past the limit of ${NEW_APPLICATION_MAX}: ${company} - ${role}`);
        capped = true;
        skipped++;
        continue;
      }
      seenKeys.add(key);
      seenMessages.add(entry.evidence.message_id);

      // Decision 6: link only an unambiguous job that has no application yet.
      const matches = jobs.filter((j) => matchKey(j.company, j.title) === key);
      const job = matches.length === 1 && matches[0]!.application_status === null ? matches[0]! : null;
      const url = job ? (job.canonical_url ?? job.url) : null;
      const domain = cleanSenderDomain(entry.sender_domain) ?? (url ? inferSenderDomain(url) : null);
      items.push({
        company,
        role,
        status: entry.status,
        applied_at: appliedAt,
        job_id: job?.id ?? null,
        url,
        sender_domains: domain ? [domain] : [],
        confidence: entry.confidence,
        reason: entry.reason,
        evidence: entry.evidence,
      });
    }
    if (capped) ctx.log(`Keeping the first ${NEW_APPLICATION_MAX} new applications; the next sync looks again`);
    return { items, skipped };
  }

  return async (ctx) => {
    const profileId = ctx.run.profile_id;
    const profile = profilesRepo.get(profileId);
    if (!profile) throw new Error('Profile not found');
    // No early exit without open applications: the same run finds new ones (SOW-0045).
    const open = applicationsRepo.list(profileId, { open: true });
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - NEW_APPLICATION_LOOKBACK_DAYS);

    const settings = settingsRepo.getAll();
    const source = mailSourceFactory(settings);
    const scope = mailScopeQuery(profile.mail_filter_kind, profile.mail_filter);
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
        reviewed_message_ids: [
          ...new Set([...proposalsRepo.reviewedMessageIds(profileId), ...applicationProposalsRepo.messageIds(profileId)]),
        ],
        mail_scope: scope,
        new_applications_since: gmailDay(since),
        tracked: trackedNames(profileId, new Set(open.map((a) => a.id))),
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
    const findingMessages = findings.findings.map((f) => f.evidence.message_id);
    const fresh = collectNewApplications(findings.new_applications, profileId, collected, findingMessages, ctx);
    skipped += fresh.skipped;
    // One transaction, so a failed write never leaves half a sync result behind (S3).
    db.transaction(() => {
      if (collected.length > 0) proposalsRepo.createMany(ctx.run.id, collected);
      if (fresh.items.length > 0) applicationProposalsRepo.createMany(ctx.run.id, profileId, fresh.items);
    })();

    // Only an explicit 0 counts: null or a missing count says nothing about the scope.
    const scopeMissed = scope !== null && findings.scope_message_count === 0;
    if (scopeMissed) ctx.log('The Gmail scope matched no mail; check the label or search on the Profile page');
    const summary =
      `${collected.length} proposals created, ${fresh.items.length} new applications found, ${skipped} skipped` +
      (scopeMissed ? SCOPE_MATCHED_NOTHING_NOTE : '');
    ctx.log(summary);
    return { summary, promptVersion: findings.promptVersion, adapterId: findings.adapterId ?? settings.adapter_id };
  };
}
