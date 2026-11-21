import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createMailThreadsRepo } from '../../../src/server/db/mail-threads-repo.js';
import { insertTestProfile } from './test-profile.js';

let db: Db;
let pid: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  pid = insertTestProfile(db);
});

describe('mail threads repo', () => {
  it('returns the newest message id read for each thread of the profile', () => {
    const repo = createMailThreadsRepo(db);
    expect(repo.known(pid)).toEqual(new Map());
    repo.upsertMany(pid, [
      { thread_id: 'thr-001', last_message_id: 'msg-001' },
      { thread_id: 'thr-002', last_message_id: 'msg-002' },
    ]);
    expect(repo.known(pid)).toEqual(new Map([['thr-001', 'msg-001'], ['thr-002', 'msg-002']]));
  });

  it('replaces the message id when a thread is read again', () => {
    const repo = createMailThreadsRepo(db);
    repo.upsertMany(pid, [{ thread_id: 'thr-001', last_message_id: 'msg-001' }]);
    repo.upsertMany(pid, [{ thread_id: 'thr-001', last_message_id: 'msg-005' }]);
    expect(repo.known(pid)).toEqual(new Map([['thr-001', 'msg-005']]));
    expect((db.prepare('SELECT COUNT(*) AS n FROM mail_threads').get() as { n: number }).n).toBe(1);
  });

  it('keeps each profile apart', () => {
    const repo = createMailThreadsRepo(db);
    const other = insertTestProfile(db, 'Other profile');
    repo.upsertMany(other, [{ thread_id: 'thr-001', last_message_id: 'msg-009' }]);
    repo.upsertMany(pid, [{ thread_id: 'thr-001', last_message_id: 'msg-001' }]);
    expect(repo.known(pid)).toEqual(new Map([['thr-001', 'msg-001']]));
    expect(repo.known(other)).toEqual(new Map([['thr-001', 'msg-009']]));
  });
});

describe('mail threads repo: listing mark (decision 14B)', () => {
  it('stores the scope and day of the last complete listing per profile, replacing the old one', () => {
    const repo = createMailThreadsRepo(db);
    const other = insertTestProfile(db, 'Other profile');
    expect(repo.listing(pid)).toBeNull();
    repo.setListing(pid, 'label:jobs-a', '2026/11/19');
    repo.setListing(other, 'label:jobs-b', '2026/11/01');
    repo.setListing(pid, 'label:jobs-a', '2026/11/20');
    expect(repo.listing(pid)).toEqual({ scope: 'label:jobs-a', listed_through: '2026/11/20' });
    expect(repo.listing(other)).toEqual({ scope: 'label:jobs-b', listed_through: '2026/11/01' });
  });
});
