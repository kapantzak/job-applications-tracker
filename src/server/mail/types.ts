import type { ReadThread } from '../db/mail-threads-repo.js';
import type { AgentRunRecord, UsageRecord } from '../db/runs-repo.js';
import type { DateRange } from '../domain/mail-coverage.js';
import type { SyncMailResult, ThreadRecordResult } from '../tasks/schemas.js';

export interface MailSyncRequest {
  applications: {
    id: string;
    company: string;
    role: string;
    applied_at: string;
    sender_domains: string[];
  }[];
  reviewed_message_ids: string[];
  // The profile's Gmail search (SOW-0031); null searches by company and ATS sender.
  mail_scope: string | null;
  // Without a scope, new applications are searched from this day on, as Gmail's YYYY/MM/DD (SOW-0045).
  new_applications_since: string;
  // Applications and earlier proposals the agent must not report as new (SOW-0045, decision 14A).
  tracked: { company: string; role: string }[];
  // Threads a scoped sync read before: thread id -> newest message id then (SOW-0051, decision 3A).
  known_threads: Map<string, string>;
  // Gmail's YYYY/MM/DD for today, so the list call can split open date ranges.
  today: string;
  // A scheduled sync lists only mail from this YYYY/MM/DD on; null lists the whole scope (decision 14B).
  list_since: string | null;
}

// What a scoped sync read (SOW-0051); the handler groups the records into findings and new applications.
export interface ThreadSyncResult {
  records: ThreadRecordResult[];
  // Threads read in batches that succeeded, with the newest message id the list call reported.
  read: ReadThread[];
  listed: number;
  // Date ranges the list calls could not confirm as complete.
  uncovered: DateRange[];
  batches: { total: number; failed: number };
  // Threads that needed reading but were not read (failed batches, threads the agent left out).
  unread: number;
}

// promptVersion and adapterId are optional so non-agent sources can omit them; the handler passes them
// to the run record. A scoped sync returns empty findings and new applications plus `threads`.
export type MailSyncFindings = SyncMailResult & { promptVersion?: string; adapterId?: string; threads?: ThreadSyncResult };

export interface MailSyncContext {
  log: (line: string) => void;
  signal: AbortSignal;
  runDir: string;
  timeoutMs: number;
  recordAgent: (record: AgentRunRecord) => void;
  // Summed over every agent call of the sync (decision 10A); also recorded when the sync fails.
  recordUsage: (record: UsageRecord) => void;
}

export interface MailSource {
  id: 'agent';
  sync(req: MailSyncRequest, ctx: MailSyncContext): Promise<MailSyncFindings>;
}

export class MailAccessError extends Error {
  constructor() {
    super('Your agent has no Gmail tool. See the setup guide in Settings.');
    this.name = 'MailAccessError';
  }
}
