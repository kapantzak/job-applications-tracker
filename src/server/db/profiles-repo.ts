import { randomUUID } from 'node:crypto';
import { slugBase, uniqueSlug } from '../domain/profile-name.js';
import type { CvAnalysisStatus, CvFileType, Profile, ProfileCounts, ProfileListItem } from '../domain/types.js';
import type { Db } from './connection.js';

export type ProfileInput = Omit<Profile, 'id' | 'slug' | 'created_at' | 'cv'>;

// The kept CV as stored (SOW-0023); the file itself lives under the data directory.
export interface StoredCv {
  file_name: string;
  file_type: CvFileType;
  added_at: string;
}

// Typed so the API maps it to 404: a profile can be deleted while another request is in flight.
export class ProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`Profile not found: ${id}`);
    this.name = 'ProfileNotFoundError';
  }
}

interface ProfileRow {
  id: string;
  name: string;
  slug: string;
  target_roles: string;
  locations: string;
  remote: Profile['remote'];
  seniority: string;
  keywords: string;
  excluded_companies: string;
  notes: string;
  mail_filter_kind: Profile['mail_filter_kind'];
  mail_filter: string;
  cv_file_name: string | null;
  cv_file_type: CvFileType | null;
  cv_added_at: string | null;
  created_at: string;
}

function fromRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    target_roles: JSON.parse(row.target_roles) as string[],
    locations: JSON.parse(row.locations) as string[],
    remote: row.remote,
    seniority: row.seniority,
    keywords: JSON.parse(row.keywords) as string[],
    excluded_companies: JSON.parse(row.excluded_companies) as string[],
    notes: row.notes,
    mail_filter_kind: row.mail_filter_kind,
    mail_filter: row.mail_filter,
    cv: row.cv_file_name && row.cv_added_at ? { file_name: row.cv_file_name, added_at: row.cv_added_at } : null,
    created_at: row.created_at,
  };
}

function toParams(input: ProfileInput) {
  return {
    name: input.name,
    target_roles: JSON.stringify(input.target_roles),
    locations: JSON.stringify(input.locations),
    remote: input.remote,
    seniority: input.seniority,
    keywords: JSON.stringify(input.keywords),
    excluded_companies: JSON.stringify(input.excluded_companies),
    notes: input.notes,
    mail_filter_kind: input.mail_filter_kind,
    mail_filter: input.mail_filter,
  };
}

export function createProfilesRepo(db: Db) {
  const selectById = db.prepare('SELECT * FROM profiles WHERE id = ?');
  // NOCASE matches the unique index, so the check and the constraint agree.
  const selectAll = db.prepare('SELECT * FROM profiles ORDER BY name COLLATE NOCASE ASC, rowid ASC');
  const insert = db.prepare(
    `INSERT INTO profiles (id, name, slug, target_roles, locations, remote, seniority, keywords,
       excluded_companies, notes, mail_filter_kind, mail_filter, cv_file_name, cv_file_type, cv_added_at,
       created_at)
     VALUES (@id, @name, @slug, @target_roles, @locations, @remote, @seniority, @keywords,
       @excluded_companies, @notes, @mail_filter_kind, @mail_filter, @cv_file_name, @cv_file_type, @cv_added_at,
       @created_at)`,
  );
  const updateCv = db.prepare(
    'UPDATE profiles SET cv_file_name = @file_name, cv_file_type = @file_type, cv_added_at = @added_at WHERE id = @id',
  );
  const updateStmt = db.prepare(
    `UPDATE profiles SET name = @name, slug = @slug, target_roles = @target_roles, locations = @locations,
       remote = @remote, seniority = @seniority, keywords = @keywords,
       excluded_companies = @excluded_companies, notes = @notes, mail_filter_kind = @mail_filter_kind,
       mail_filter = @mail_filter
     WHERE id = @id`,
  );
  const selectNameOwner = db.prepare('SELECT id FROM profiles WHERE name = ? COLLATE NOCASE');
  const selectBySlug = db.prepare('SELECT * FROM profiles WHERE slug = ?');
  const countStmt = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM jobs WHERE profile_id = @id) AS jobs,
       (SELECT COUNT(*) FROM applications WHERE profile_id = @id) AS applications,
       (SELECT COUNT(*) FROM runs WHERE profile_id = @id) AS runs`,
  );
  const selectAnalysisStatus = db.prepare(
    'SELECT status FROM cv_analyses WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
  );
  const selectRunIds = db.prepare('SELECT id FROM runs WHERE profile_id = ?');
  // Children first: no foreign key cascades, so the order must follow the references.
  const deleteSteps = [
    `DELETE FROM status_history WHERE application_id IN (SELECT id FROM applications WHERE profile_id = @id)
       OR proposal_id IN (SELECT id FROM proposals WHERE run_id IN (SELECT id FROM runs WHERE profile_id = @id))`,
    `DELETE FROM proposals WHERE application_id IN (SELECT id FROM applications WHERE profile_id = @id)
       OR run_id IN (SELECT id FROM runs WHERE profile_id = @id)`,
    'DELETE FROM applications WHERE profile_id = @id',
    'DELETE FROM jobs WHERE profile_id = @id',
    'DELETE FROM runs WHERE profile_id = @id',
    // The profile's CV analysis (SOW-0024); the CV service stops its agent and deletes its files.
    'DELETE FROM cv_analyses WHERE profile_id = @id',
    'DELETE FROM profiles WHERE id = @id',
  ].map((sql) => db.prepare(sql));

  function get(id: string): Profile | null {
    const row = selectById.get(id) as ProfileRow | undefined;
    return row ? fromRow(row) : null;
  }

  function getBySlug(slug: string): Profile | null {
    const row = selectBySlug.get(slug) as ProfileRow | undefined;
    return row ? fromRow(row) : null;
  }

  // The slug follows the name (SOW-0015) and changes only when the name does, so saving other fields
  // never moves `cafe-2` to a `cafe` that has since become free.
  function slugFor(name: string, current?: Profile): string {
    if (current && current.name === name) return current.slug;
    const base = slugBase(name);
    const exceptId = current?.id;
    return uniqueSlug(base, (slug) => {
      const owner = selectBySlug.get(slug) as ProfileRow | undefined;
      return owner !== undefined && owner.id !== exceptId;
    });
  }

  function counts(id: string): ProfileCounts {
    return countStmt.get({ id }) as ProfileCounts;
  }

  function list(): ProfileListItem[] {
    return (selectAll.all() as ProfileRow[]).map((row) => ({
      ...fromRow(row),
      counts: counts(row.id),
      cv_analysis_status:
        (selectAnalysisStatus.get(row.id) as { status: CvAnalysisStatus } | undefined)?.status ?? null,
    }));
  }

  // True when another profile already uses this name, ignoring ASCII case.
  function nameTaken(name: string, exceptId?: string): boolean {
    const row = selectNameOwner.get(name) as { id: string } | undefined;
    return row !== undefined && row.id !== exceptId;
  }

  // `id` lets the caller place the CV files before the row exists (SOW-0023).
  function create(input: ProfileInput, opts: { id?: string; cv?: StoredCv } = {}): Profile {
    const id = opts.id ?? randomUUID();
    insert.run({
      ...toParams(input),
      id,
      slug: slugFor(input.name),
      cv_file_name: opts.cv?.file_name ?? null,
      cv_file_type: opts.cv?.file_type ?? null,
      cv_added_at: opts.cv?.added_at ?? null,
      created_at: new Date().toISOString(),
    });
    return get(id) as Profile;
  }

  function storedCv(id: string): StoredCv | null {
    const row = selectById.get(id) as ProfileRow | undefined;
    if (!row?.cv_file_name || !row.cv_file_type || !row.cv_added_at) return null;
    return { file_name: row.cv_file_name, file_type: row.cv_file_type, added_at: row.cv_added_at };
  }

  function setCv(id: string, cv: StoredCv | null): Profile {
    if (!get(id)) throw new ProfileNotFoundError(id);
    updateCv.run({ id, file_name: cv?.file_name ?? null, file_type: cv?.file_type ?? null, added_at: cv?.added_at ?? null });
    return get(id) as Profile;
  }

  function update(id: string, input: ProfileInput): Profile {
    const existing = get(id);
    if (!existing) throw new ProfileNotFoundError(id);
    updateStmt.run({ ...toParams(input), id, slug: slugFor(input.name, existing) });
    return get(id) as Profile;
  }

  // Removes the profile and every row it owns in one transaction; returns the run ids so the
  // caller can delete their log files.
  const remove = db.transaction((id: string): string[] => {
    if (!get(id)) throw new ProfileNotFoundError(id);
    const runIds = (selectRunIds.all(id) as { id: string }[]).map((r) => r.id);
    for (const step of deleteSteps) step.run({ id });
    return runIds;
  });

  return {
    list,
    get,
    getBySlug,
    counts,
    nameTaken,
    create,
    update,
    storedCv,
    setCv,
    remove: (id: string) => remove(id),
  };
}

export type ProfilesRepo = ReturnType<typeof createProfilesRepo>;
