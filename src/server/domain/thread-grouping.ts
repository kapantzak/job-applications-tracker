// Turns the per-thread records of a scoped sync into status findings and new applications (SOW-0051). The
// agent reads threads in batches, so one application's threads can come from different calls; grouping here
// keeps the result independent of how the threads were batched. The output goes through the same handler
// rules as the single-run sync.
import type { MailFindingResult, NewApplicationResult, ThreadRecordResult } from '../tasks/schemas.js';
import { cleanName, mailTime, matchKey } from './new-application.js';

export interface GroupingInput {
  records: ThreadRecordResult[];
  // The open applications the read prompt listed.
  open: { id: string; company: string; role: string; applied_at: string }[];
  // Every application of the profile, for threads that name no role (decision 9).
  applications: { company: string; role: string }[];
}

export type GroupedNewApplication = NewApplicationResult & { thread_ids: string[] };

export interface GroupingOutput {
  findings: MailFindingResult[];
  newApplications: GroupedNewApplication[];
  logs: string[];
}

// The role of an application whose mail never names one (decision 12A); the user edits it after accepting.
export const ROLE_NOT_STATED = 'Not stated';

// A rejection ranks furthest: it ends the application whatever came before (decision 13B).
export const STAGE_RANK: Record<ThreadRecordResult['status'], number> = {
  applied: 1,
  screening: 2,
  interview: 3,
  offer: 4,
  rejected: 5,
};
const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const companyKey = (company: string): string => cleanName(company).toLowerCase();
const timeOf = (r: ThreadRecordResult): number => mailTime(r.evidence.date) ?? mailTime(r.first_date) ?? 0;

// The furthest stage wins, so a late acknowledgement never hides an interview; on the same stage the newest
// message wins (decision 13B).
function furthest(records: ThreadRecordResult[]): ThreadRecordResult {
  return records.reduce((best, r) => {
    const d = STAGE_RANK[r.status] - STAGE_RANK[best.status];
    return d > 0 || (d === 0 && timeOf(r) > timeOf(best)) ? r : best;
  });
}

interface Group {
  company: string;
  role: string;
  // A group made from an existing application keeps that application's names.
  fixed: boolean;
  records: ThreadRecordResult[];
}

export function groupThreadRecords(input: GroupingInput): GroupingOutput {
  const logs: string[] = [];
  const openById = new Map(input.open.map((a) => [a.id, a]));
  const openByKey = new Map<string, string>();
  for (const a of input.open) if (!openByKey.has(matchKey(a.company, a.role))) openByKey.set(matchKey(a.company, a.role), a.id);

  const byApp = new Map<string, ThreadRecordResult[]>();
  const groups = new Map<string, Group>();
  const roleless: { company: string; record: ThreadRecordResult }[] = [];
  const toApp = (id: string, r: ThreadRecordResult) => byApp.set(id, [...(byApp.get(id) ?? []), r]);
  const toGroup = (company: string, role: string, r: ThreadRecordResult, fixed = false) => {
    const key = matchKey(company, role);
    const g = groups.get(key) ?? { company, role, fixed, records: [] };
    g.records.push(r);
    groups.set(key, g);
  };

  for (const r of input.records) {
    const company = cleanName(r.company);
    const role = cleanName(r.role);
    // A known application needs no names (review L4).
    if (openById.has(r.application_id)) {
      toApp(r.application_id, r);
      continue;
    }
    // Agent text: quoted, so a line break cannot forge a log line (review L2).
    if (r.application_id.trim() !== '') logs.push(`Ignoring an unknown application id from the agent: ${JSON.stringify(r.application_id)}`);
    if (!company) {
      logs.push('Skipping a thread without a company');
      continue;
    }
    const appId = role ? (openByKey.get(matchKey(company, role)) ?? '') : '';
    if (appId) toApp(appId, r);
    else if (role) toGroup(company, role, r);
    else roleless.push({ company, record: r });
  }

  // Decision 9: the company's only group in this sync, else its only open application, else its only
  // application of the profile; a company with none of these becomes one application whose role is not
  // stated (decision 12A). Two or more of any is ambiguous, and the thread is skipped.
  for (const { company, record } of roleless) {
    const key = companyKey(company);
    const sameGroups = [...groups.values()].filter((g) => companyKey(g.company) === key);
    const sameOpen = input.open.filter((a) => companyKey(a.company) === key);
    const sameApps = input.applications.filter((a) => companyKey(a.company) === key);
    if (sameGroups.length === 1) sameGroups[0]!.records.push(record);
    else if (sameGroups.length === 0 && sameOpen.length === 1) toApp(sameOpen[0]!.id, record);
    else if (sameGroups.length === 0 && sameOpen.length === 0 && sameApps.length === 1) {
      toGroup(cleanName(sameApps[0]!.company), cleanName(sameApps[0]!.role), record, true);
    } else if (sameGroups.length === 0 && sameOpen.length === 0 && sameApps.length === 0) {
      toGroup(company, ROLE_NOT_STATED, record, true);
    } else logs.push(`Skipping a thread that names no role: ${company}`);
  }

  const findings: MailFindingResult[] = [];
  for (const [id, records] of byApp) {
    const appliedAt = mailTime(openById.get(id)!.applied_at);
    // Mail from before the application was sent is about something else; a day of slack covers time zones.
    const relevant = records.filter((r) => appliedAt === null || timeOf(r) === 0 || timeOf(r) > appliedAt - DAY_MS);
    if (relevant.length === 0) continue;
    const latest = furthest(relevant);
    if (latest.status === 'applied') continue;
    findings.push({
      application_id: id,
      proposed_status: latest.status,
      confidence: latest.confidence,
      reason: latest.reason,
      evidence: latest.evidence,
    });
  }

  const newApplications: GroupedNewApplication[] = [...groups.values()].map((g) => {
    const latest = furthest(g.records);
    const byTime = [...g.records].sort((a, b) => timeOf(a) - timeOf(b));
    // The thread that started earliest usually is the confirmation, which names the company and role in full
    // (review L1: by its first message, not its newest).
    const startOf = (r: ThreadRecordResult) => mailTime(r.first_date) ?? timeOf(r);
    const first = [...g.records].sort((a, b) => startOf(a) - startOf(b))[0]!;
    const days = g.records.map((r) => r.first_date.trim()).filter((d) => DAY.test(d)).sort();
    const domain = [...byTime].reverse().find((r) => r.sender_domain.trim() !== '')?.sender_domain ?? '';
    return {
      company: g.fixed ? g.company : cleanName(first.company),
      role: g.fixed ? g.role : cleanName(first.role) || g.role,
      status: latest.status,
      applied_at: days[0] ?? latest.first_date,
      sender_domain: domain,
      confidence: latest.confidence,
      reason: latest.reason,
      evidence: latest.evidence,
      thread_ids: g.records.map((r) => r.thread_id),
    };
  });
  newApplications.sort((a, b) => (a.applied_at < b.applied_at ? -1 : a.applied_at > b.applied_at ? 1 : 0));
  return { findings, newApplications, logs };
}
