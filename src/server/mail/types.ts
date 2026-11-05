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
}

// promptVersion is optional so non-agent sources can omit it; the handler passes it to the run record.
export type MailSyncFindings = SyncMailResult & { promptVersion?: string };

export interface MailSyncContext {
  log: (line: string) => void;
  signal: AbortSignal;
  runDir: string;
  timeoutMs: number;
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
