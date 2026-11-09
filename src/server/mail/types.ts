import type { AgentRunRecord } from '../db/runs-repo.js';
import type { SyncMailResult } from '../tasks/schemas.js';

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
}

// promptVersion and adapterId are optional so non-agent sources can omit them; the handler passes them
// to the run record.
export type MailSyncFindings = SyncMailResult & { promptVersion?: string; adapterId?: string };

export interface MailSyncContext {
  log: (line: string) => void;
  signal: AbortSignal;
  runDir: string;
  timeoutMs: number;
  recordAgent: (record: AgentRunRecord) => void;
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
