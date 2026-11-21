import type { Db } from './connection.js';

export interface ReadThread {
  thread_id: string;
  last_message_id: string;
}

export interface MailListing {
  scope: string;
  // Gmail's YYYY/MM/DD of the day the listing ran.
  listed_through: string;
}

// The threads a scoped Gmail sync has read (SOW-0051, decision 3A), and the profile's last complete listing
// (decision 14B).
export function createMailThreadsRepo(db: Db) {
  const selectListing = db.prepare('SELECT scope, listed_through FROM mail_listings WHERE profile_id = ?');
  const upsertListing = db.prepare(
    `INSERT INTO mail_listings (profile_id, scope, listed_through) VALUES (?, ?, ?)
     ON CONFLICT (profile_id) DO UPDATE SET scope = excluded.scope, listed_through = excluded.listed_through`,
  );
  const selectKnown = db.prepare('SELECT thread_id, last_message_id FROM mail_threads WHERE profile_id = ?');
  const upsert = db.prepare(
    `INSERT INTO mail_threads (profile_id, thread_id, last_message_id, read_at)
     VALUES (@profile_id, @thread_id, @last_message_id, @read_at)
     ON CONFLICT (profile_id, thread_id) DO UPDATE SET last_message_id = excluded.last_message_id, read_at = excluded.read_at`,
  );

  // thread id -> newest message id seen when it was read.
  function known(profileId: string): Map<string, string> {
    const rows = selectKnown.all(profileId) as ReadThread[];
    return new Map(rows.map((r) => [r.thread_id, r.last_message_id]));
  }

  // Callers run this inside their save transaction, so the ledger never runs ahead of the proposals.
  function upsertMany(profileId: string, threads: ReadThread[]): void {
    const readAt = new Date().toISOString();
    for (const t of threads) upsert.run({ profile_id: profileId, thread_id: t.thread_id, last_message_id: t.last_message_id, read_at: readAt });
  }

  function listing(profileId: string): MailListing | null {
    return (selectListing.get(profileId) as MailListing | undefined) ?? null;
  }

  function setListing(profileId: string, scope: string, listedThrough: string): void {
    upsertListing.run(profileId, scope, listedThrough);
  }

  return { known, upsertMany, listing, setListing };
}

export type MailThreadsRepo = ReturnType<typeof createMailThreadsRepo>;
