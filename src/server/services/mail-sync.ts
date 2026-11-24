import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApplicationProposalsRepo, NewApplicationProposal } from '../db/application-proposals-repo.js';
import { inferSenderDomain, type createApplicationsRepo } from '../db/applications-repo.js';
import type { Db } from '../db/connection.js';
import type { createJobsRepo } from '../db/jobs-repo.js';
import type { MailThreadsRepo } from '../db/mail-threads-repo.js';
import type { ProfilesRepo } from '../db/profiles-repo.js';
import type { createProposalsRepo, NewProposal } from '../db/proposals-repo.js';
import type { createSettingsRepo } from '../db/settings-repo.js';
import { mailScopeQuery } from '../domain/mail-filter.js';
import { cleanName, cleanSenderDomain, gmailDay, matchKey, toAppliedAt } from '../domain/new-application.js';
// Findings never propose a stage not past the application's (decision 13B).
import { stageOf } from '../domain/stage.js';
import { groupThreadRecords } from '../domain/thread-grouping.js';
import {
  batchesFailedNote,
  SCHEDULED_SYNC_INPUT,
  SCOPE_MATCHED_NOTHING_NOTE,
  UNLISTED_MAIL_NOTE,
  type Application,
  type ApplicationAlias,
  type Settings,
} from '../domain/types.js';
import type { MailSource } from '../mail/types.js';
import { RUN_INPUT_FILE, type RunContext, type RunHandler } from '../runs/queue.js';
import type { NewApplicationResult } from '../tasks/schemas.js';

export interface MailSyncDeps {
  db: Db;
  applicationsRepo: ReturnType<typeof createApplicationsRepo>;
  applicationProposalsRepo: ApplicationProposalsRepo;
  jobsRepo: ReturnType<typeof createJobsRepo>;
  mailThreadsRepo: MailThreadsRepo;
  profilesRepo: ProfilesRepo;
  proposalsRepo: ReturnType<typeof createProposalsRepo>;
  settingsRepo: ReturnType<typeof createSettingsRepo>;
  mailSourceFactory: (settings: Settings) => MailSource;
}

// An application's own name, then the names of applications merged into it (SOW-0055, decision 6C).
const namesOf = (app: Application, aliases: Map<string, ApplicationAlias[]>): ApplicationAlias[] => [
  { company: app.company, role: app.role },
  ...(aliases.get(app.id) ?? []),
];

// Without a Gmail scope, new applications are searched this far back (decision 3).
const NEW_APPLICATION_LOOKBACK_DAYS = 90;
// A safety net against a runaway agent, not a page size (SOW-0051, decision 2B; was 50 in SOW-0045).
const NEW_APPLICATION_MAX = 500;

// A scheduled sync carries a run input file (decision 14B); a click on Sync has none.
function isScheduled(runDir: string): boolean {
  try {
    const input = JSON.parse(readFileSync(join(runDir, RUN_INPUT_FILE), 'utf8')) as { trigger?: unknown };
    return input.trigger === SCHEDULED_SYNC_INPUT.trigger;
  } catch {
    return false;
  }
}

// The Gmail day before a YYYY/MM/DD day, or null when it is not one. The overlap covers time zones, since
// Gmail's after: is day-granular.
function dayBefore(day: string): string | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(day);
  if (!m) return null;
  return gmailDay(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
}

// A grouped new application of a scoped sync names the threads behind it (SOW-0051).
type NewEntry = NewApplicationResult & { thread_ids?: string[] };

export function createMailSyncHandler(deps: MailSyncDeps): RunHandler {
  const {
    db,
    applicationsRepo,
    applicationProposalsRepo,
    jobsRepo,
    mailThreadsRepo,
    profilesRepo,
    proposalsRepo,
    settingsRepo,
    mailSourceFactory,
  } = deps;

  // What the agent must not report as new (decision 14A): applications that are neither open (listed in the
  // prompt) nor saved (10A needs those reported), and every new-application proposal of the profile.
  function trackedNames(profileId: string, open: Set<string>, aliases: Map<string, ApplicationAlias[]>): ApplicationAlias[] {
    const apps = applicationsRepo.list(profileId);
    const saved = new Set(
      apps.filter((a) => a.status === 'saved').flatMap((a) => namesOf(a, aliases).map((n) => matchKey(n.company, n.role))),
    );
    const closed = apps.filter((a) => a.status !== 'saved' && !open.has(a.id)).flatMap((a) => namesOf(a, aliases));
    // A proposal that shares a saved application's company and role must not hide that application's mail.
    const proposed = applicationProposalsRepo.names(profileId).filter((p) => !saved.has(matchKey(p.company, p.role)));
    return [...closed, ...proposed];
  }

  // Agent output is untrusted: names are cleaned, matches checked against every application of the profile,
  // and repeats dropped. A match with a saved application becomes a status proposal for it (decision 10A).
  function collectNewApplications(
    entries: NewEntry[],
    profileId: string,
    statusProposals: NewProposal[],
    findingMessages: string[],
    ctx: RunContext,
  ): { items: NewApplicationProposal[]; skipped: number; unread: Set<string> } {
    const now = new Date();
    const tracked = new Map<string, Application>();
    const aliases = applicationsRepo.aliasesForProfile(profileId);
    // Newest first, so the newest application with a key wins; an alias counts like the name (SOW-0055), after
    // every own name, so it never hides an application with that very name (decision 9A).
    const apps = applicationsRepo.list(profileId);
    for (const [app, name] of [
      ...apps.map((a) => [a, { company: a.company, role: a.role }] as const),
      ...apps.flatMap((a) => (aliases.get(a.id) ?? []).map((n) => [a, n] as const)),
    ]) {
      const key = matchKey(name.company, name.role);
      if (!tracked.has(key)) tracked.set(key, app);
    }
    // Any earlier proposal, pending or decided, blocks its company and role (decision 12A).
    const seenKeys = new Set(applicationProposalsRepo.names(profileId).map((p) => matchKey(p.company, p.role)));
    // While such a proposal is pending, the user may still accept it; its new mail must then be read again
    // as a reply to the application, so those threads stay out of the ledger (SOW-0051 review H1).
    const pendingKeys = new Set(applicationProposalsRepo.listPending(profileId).map((p) => matchKey(p.company, p.role)));
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
    // Threads behind an entry the cap skipped stay out of the ledger, so the next sync reads them again.
    const unread = new Set<string>();

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
        if (pendingKeys.has(key)) for (const id of entry.thread_ids ?? []) unread.add(id);
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
        for (const id of entry.thread_ids ?? []) unread.add(id);
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
    return { items, skipped, unread };
  }

  return async (ctx) => {
    const profileId = ctx.run.profile_id;
    const profile = profilesRepo.get(profileId);
    if (!profile) throw new Error('Profile not found');
    // No early exit without open applications: the same run finds new ones (SOW-0045).
    const open = applicationsRepo.list(profileId, { open: true });
    const aliases = applicationsRepo.aliasesForProfile(profileId);
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - NEW_APPLICATION_LOOKBACK_DAYS);

    const settings = settingsRepo.getAll();
    const source = mailSourceFactory(settings);
    const scope = mailScopeQuery(profile.mail_filter_kind, profile.mail_filter);
    // Decision 14B: a scheduled sync lists only mail since the day before the last complete listing of this
    // scope; a click on Sync, a first sync or a changed scope lists all of it.
    let listSince: string | null = null;
    if (scope !== null && isScheduled(ctx.runDir)) {
      const mark = mailThreadsRepo.listing(profileId);
      if (!mark) ctx.log('Scheduled sync lists all mail: no complete listing yet');
      else if (mark.scope !== scope) ctx.log('Scheduled sync lists all mail: the Gmail label or search changed');
      else listSince = dayBefore(mark.listed_through);
    }
    const reviewed = [
      ...new Set([...proposalsRepo.reviewedMessageIds(profileId), ...applicationProposalsRepo.messageIds(profileId)]),
    ];
    const findings = await source.sync(
      {
        applications: open.map((a) => ({
          id: a.id,
          company: a.company,
          role: a.role,
          // Open applications always have applied_at; fall back to be safe.
          applied_at: a.applied_at ?? a.created_at,
          sender_domains: a.sender_domains,
          aliases: aliases.get(a.id) ?? [],
        })),
        reviewed_message_ids: reviewed,
        mail_scope: scope,
        new_applications_since: gmailDay(since),
        tracked: trackedNames(profileId, new Set(open.map((a) => a.id)), aliases),
        known_threads: scope === null ? new Map() : mailThreadsRepo.known(profileId),
        today: gmailDay(now),
        list_since: listSince,
      },
      {
        log: ctx.log,
        signal: ctx.signal,
        runDir: ctx.runDir,
        timeoutMs: settings.run_timeout_ms,
        recordAgent: ctx.recordAgent,
        recordUsage: ctx.recordUsage,
      },
    );

    // Past this point the run cannot be cancelled; throws if a cancel or shutdown came first.
    ctx.beginSaving();

    // A scoped sync returns per-thread records; grouping turns them into the shapes the rules below expect.
    let statusFindings = findings.findings;
    let newEntries: NewEntry[] = findings.new_applications;
    const threads = findings.threads;
    if (threads) {
      const grouped = groupThreadRecords({
        records: threads.records,
        open: open.map((a) => ({
          id: a.id,
          company: a.company,
          role: a.role,
          applied_at: a.applied_at ?? a.created_at,
          aliases: aliases.get(a.id) ?? [],
        })),
        applications: applicationsRepo
          .list(profileId)
          .map((a) => ({ company: a.company, role: a.role, aliases: aliases.get(a.id) ?? [] })),
      });
      for (const line of grouped.logs) ctx.log(line);
      statusFindings = grouped.findings;
      newEntries = grouped.newApplications;
    }

    const openStatus = new Map(open.map((a) => [a.id, a.status]));
    // A blank id identifies nothing, so it never counts as reviewed.
    const reviewedSet = new Set(reviewed.filter((id) => id.trim() !== ''));
    const collected: NewProposal[] = [];
    let skipped = 0;
    // hasPending only sees stored rows, so track repeats within this response too.
    const seen = new Set<string>();
    for (const f of statusFindings) {
      if (f.proposed_status === 'no_change') continue;
      if (!openStatus.has(f.application_id)) {
        ctx.log(`Dropping finding for unknown application ${JSON.stringify(f.application_id)}`);
        continue;
      }
      // A proposal to the status the application already has would change nothing (review H2), and one to an
      // earlier stage is old mail read again (decision 13B); a rejection is never earlier.
      if (stageOf(f.proposed_status) <= stageOf(openStatus.get(f.application_id)!)) continue;
      // The agent is told to skip reviewed messages; a scoped sync reads whole threads again, so check here.
      if (reviewedSet.has(f.evidence.message_id)) {
        ctx.log(`Skipping a finding from a message already reviewed: ${f.application_id}`);
        skipped++;
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
    const findingMessages = statusFindings.map((f) => f.evidence.message_id);
    const fresh = collectNewApplications(newEntries, profileId, collected, findingMessages, ctx);
    skipped += fresh.skipped;
    // One transaction, so a failed write never leaves half a sync result behind (S3), and the ledger never
    // marks a thread read whose proposals were not saved (SOW-0051).
    db.transaction(() => {
      if (collected.length > 0) proposalsRepo.createMany(ctx.run.id, collected);
      if (fresh.items.length > 0) applicationProposalsRepo.createMany(ctx.run.id, profileId, fresh.items);
      if (threads) mailThreadsRepo.upsertMany(profileId, threads.read.filter((r) => !fresh.unread.has(r.thread_id)));
      // The mark moves on only when every date was covered and every thread that needed reading was read and
      // recorded; otherwise the next scheduled sync lists from the old mark and finds those threads again.
      if (threads && scope !== null && threads.uncovered.length === 0 && threads.unread === 0 && fresh.unread.size === 0) {
        mailThreadsRepo.setListing(profileId, scope, gmailDay(now));
      }
    })();

    const unlisted = (threads?.uncovered.length ?? 0) > 0;
    // Only an explicit 0 counts: null or a missing count says nothing about the scope, and neither does a
    // listing that could not cover every date, nor one of recent mail only (decision 14B).
    const scopeMissed = scope !== null && listSince === null && findings.scope_message_count === 0 && !unlisted;
    if (scopeMissed) ctx.log('The Gmail scope matched no mail; check the label or search on the Profile page');
    const summary =
      `${collected.length} proposals created, ${fresh.items.length} new applications found, ${skipped} skipped` +
      (threads && threads.batches.failed > 0 ? batchesFailedNote(threads.batches.failed, threads.batches.total) : '') +
      (unlisted ? UNLISTED_MAIL_NOTE : '') +
      (scopeMissed ? SCOPE_MATCHED_NOTHING_NOTE : '');
    ctx.log(summary);
    return { summary, promptVersion: findings.promptVersion, adapterId: findings.adapterId ?? settings.adapter_id };
  };
}
