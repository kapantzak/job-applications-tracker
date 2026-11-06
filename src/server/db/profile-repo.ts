import type { Profile } from '../domain/types.js';
import type { Db } from './connection.js';

export type ProfileInput = Omit<Profile, 'created_at'>;

interface ProfileRow {
  target_roles: string;
  locations: string;
  remote: Profile['remote'];
  seniority: string;
  keywords: string;
  excluded_companies: string;
  notes: string;
  created_at: string;
}

function fromRow(row: ProfileRow): Profile {
  return {
    target_roles: JSON.parse(row.target_roles) as string[],
    locations: JSON.parse(row.locations) as string[],
    remote: row.remote,
    seniority: row.seniority,
    keywords: JSON.parse(row.keywords) as string[],
    excluded_companies: JSON.parse(row.excluded_companies) as string[],
    notes: row.notes,
    created_at: row.created_at,
  };
}

export function createProfileRepo(db: Db) {
  const selectStmt = db.prepare('SELECT * FROM profile WHERE id = 1');
  // Upsert keeps created_at from the first insert; the update list omits it.
  const upsertStmt = db.prepare(`
    INSERT INTO profile (id, target_roles, locations, remote, seniority, keywords, excluded_companies, notes, created_at)
    VALUES (1, @target_roles, @locations, @remote, @seniority, @keywords, @excluded_companies, @notes, @created_at)
    ON CONFLICT (id) DO UPDATE SET
      target_roles = excluded.target_roles,
      locations = excluded.locations,
      remote = excluded.remote,
      seniority = excluded.seniority,
      keywords = excluded.keywords,
      excluded_companies = excluded.excluded_companies,
      notes = excluded.notes
  `);

  function get(): Profile | null {
    const row = selectStmt.get() as ProfileRow | undefined;
    return row ? fromRow(row) : null;
  }

  function save(input: ProfileInput): Profile {
    upsertStmt.run({
      target_roles: JSON.stringify(input.target_roles),
      locations: JSON.stringify(input.locations),
      remote: input.remote,
      seniority: input.seniority,
      keywords: JSON.stringify(input.keywords),
      excluded_companies: JSON.stringify(input.excluded_companies),
      notes: input.notes,
      created_at: new Date().toISOString(),
    });
    return get() as Profile;
  }

  return { get, save };
}
