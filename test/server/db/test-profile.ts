import { randomUUID } from 'node:crypto';
import type { Db } from '../../../src/server/db/connection.js';

// Inserts a bare profile row: runs, jobs and applications need an owner (SOW-0014).
export function insertTestProfile(db: Db, name = 'Test profile'): string {
  const id = randomUUID();
  db.prepare('INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)').run(id, name, new Date().toISOString());
  return id;
}
