import Database from 'better-sqlite3';
import { migrations } from './migrations.js';

export type Db = Database.Database;

export function openDatabase(file: string): Db {
  const db = new Database(file);
  // WAL is a no-op for :memory: but harmless.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// Each migration runs in its own transaction; returns how many were applied.
export function migrate(db: Db): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  let count = 0;
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    const apply = db.transaction(() => {
      if (m.sql) db.exec(m.sql);
      m.up?.(db);
      if (m.foreignKeysOff) {
        const broken = db.pragma('foreign_key_check') as unknown[];
        if (broken.length > 0) {
          throw new Error(`Migration ${m.id} left ${broken.length} broken foreign key references`);
        }
      }
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        m.id,
        new Date().toISOString(),
      );
    });
    if (m.foreignKeysOff) {
      const previous = db.pragma('foreign_keys', { simple: true }) as number;
      // Must be set outside the transaction; SQLite ignores it inside one.
      db.pragma('foreign_keys = OFF');
      try {
        apply();
      } finally {
        db.pragma(`foreign_keys = ${previous ? 'ON' : 'OFF'}`);
      }
    } else {
      apply();
    }
    count++;
  }
  return count;
}
