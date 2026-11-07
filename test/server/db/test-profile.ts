import { randomUUID } from 'node:crypto';
import type { Db } from '../../../src/server/db/connection.js';
import { slugBase } from '../../../src/server/domain/profile-name.js';

// Inserts a bare profile row: runs, jobs and applications need an owner (SOW-0014).
export function insertTestProfile(db: Db, name = 'Test profile'): string {
  const id = randomUUID();
  db.prepare('INSERT INTO profiles (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    slugBase(name),
    new Date().toISOString(),
  );
  return id;
}
