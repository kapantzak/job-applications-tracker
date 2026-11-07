import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  cleanProfileName,
  cutProfileName,
  isValidProfileName,
  normalizeProfileName,
  slugBase,
  uniqueSlug,
} from '../domain/profile-name.js';

const APP_STATUS =
  "('saved','applied','screening','interview','offer','rejected','withdrawn','no_response')";

export interface Migration {
  id: number;
  sql?: string;
  // Data steps that SQL alone cannot express (ids, JSON parsing); runs after `sql`.
  up?: (db: Database.Database) => void;
  // Table rebuilds need foreign keys off (SQLite cannot toggle them inside a transaction);
  // the runner checks integrity with foreign_key_check before committing.
  foreignKeysOff?: boolean;
}

// SQL lives in TS (not .sql files) so the bundle needs no asset copying.
export const migrations: Migration[] = [
  {
    id: 1,
    sql: `
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  target_roles TEXT NOT NULL DEFAULT '[]',
  locations TEXT NOT NULL DEFAULT '[]',
  remote TEXT NOT NULL DEFAULT 'any' CHECK (remote IN ('remote','hybrid','onsite','any')),
  seniority TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]',
  excluded_companies TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('discover_jobs','sync_mail')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','aborted')),
  started_at TEXT,
  finished_at TEXT,
  adapter_id TEXT NOT NULL DEFAULT '',
  prompt_version TEXT,
  summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_runs_status ON runs (status);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs (id),
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  remote TEXT NOT NULL DEFAULT 'unknown' CHECK (remote IN ('remote','hybrid','onsite','unknown')),
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source_site TEXT,
  posted_at TEXT,
  salary TEXT,
  description_excerpt TEXT,
  match_reason TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('ok','redirected','dead','unverified')),
  verified_at TEXT,
  dedupe_key TEXT NOT NULL,
  dismissed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_jobs_dedupe_key ON jobs (dedupe_key);
CREATE INDEX idx_jobs_run_id ON jobs (run_id);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs (id),
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL CHECK (status IN ${APP_STATUS}),
  applied_at TEXT,
  status_changed_at TEXT NOT NULL,
  notes TEXT,
  sender_domains TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_applications_status ON applications (status);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs (id),
  application_id TEXT NOT NULL REFERENCES applications (id),
  proposed_status TEXT NOT NULL CHECK (proposed_status IN ${APP_STATUS}),
  confidence REAL NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','rejected')),
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_proposals_state ON proposals (state);
CREATE INDEX idx_proposals_application_id ON proposals (application_id);

CREATE TABLE status_history (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ${APP_STATUS}),
  to_status TEXT NOT NULL CHECK (to_status IN ${APP_STATUS}),
  changed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user','proposal')),
  proposal_id TEXT REFERENCES proposals (id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_status_history_application_id ON status_history (application_id);
`,
  },
  {
    id: 2,
    sql: `
ALTER TABLE runs ADD COLUMN agent_model TEXT;
ALTER TABLE runs ADD COLUMN agent_effort TEXT;
ALTER TABLE runs ADD COLUMN agent_model_reported TEXT;
`,
  },
  {
    id: 3,
    foreignKeysOff: true,
    up: migrateToProfiles,
  },
  {
    id: 4,
    up: addProfileSlugs,
  },
  {
    // Discovery effort levels (SOW-0016): run mode, what the agent reported spending, per-job fit verdicts.
    id: 5,
    sql: `
ALTER TABLE runs ADD COLUMN effort_mode TEXT NOT NULL DEFAULT 'default' CHECK (effort_mode IN ('default','max'));
ALTER TABLE runs ADD COLUMN usage_cost_usd REAL;
ALTER TABLE runs ADD COLUMN usage_input_tokens INTEGER;
ALTER TABLE runs ADD COLUMN usage_output_tokens INTEGER;
ALTER TABLE jobs ADD COLUMN fit_checks TEXT;
`,
  },
  {
    // CV upload (SOW-0023): the CV a profile keeps, and the one analysis in progress or awaiting review.
    // The files live under the data directory; rows hold names and dates only.
    id: 6,
    sql: `
ALTER TABLE profiles ADD COLUMN cv_file_name TEXT;
ALTER TABLE profiles ADD COLUMN cv_file_type TEXT CHECK (cv_file_type IN ('pdf','docx','txt','md'));
ALTER TABLE profiles ADD COLUMN cv_added_at TEXT;

CREATE TABLE cv_analyses (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','interrupted')),
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf','docx','txt','md')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  draft TEXT,
  error TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL
);
`,
  },
];

// Frozen for migration 3; the live rule is in domain/profile-name.ts.
const PROFILE_NAME_MAX = 80;

interface OldProfileRow {
  target_roles: string;
  locations: string;
  remote: string;
  seniority: string;
  keywords: string;
  excluded_companies: string;
  notes: string;
  created_at: string;
}

function nameFromRoles(targetRoles: string): string {
  try {
    const roles = JSON.parse(targetRoles) as unknown;
    const first = Array.isArray(roles) && typeof roles[0] === 'string' ? roles[0].trim() : '';
    if (first) return first.slice(0, PROFILE_NAME_MAX);
  } catch {
    // Malformed list: fall back to the default name.
  }
  return 'Default';
}

const RUN_COLUMNS =
  'id, kind, status, started_at, finished_at, adapter_id, prompt_version, summary, error, created_at, agent_model, agent_effort, agent_model_reported';
const JOB_COLUMNS =
  'id, run_id, company, title, location, remote, url, canonical_url, source_site, posted_at, salary, description_excerpt, match_reason, verification_status, verified_at, dedupe_key, dismissed_at, created_at';
const APPLICATION_COLUMNS =
  'id, job_id, company, role, url, status, applied_at, status_changed_at, notes, sender_domains, created_at';

// Replaces the single-row `profile` table with `profiles` and gives runs, jobs and applications an
// owner (SOW-0014). Proposals and status history inherit the owner through their application.
function migrateToProfiles(db: Database.Database): void {
  db.exec(`
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  target_roles TEXT NOT NULL DEFAULT '[]',
  locations TEXT NOT NULL DEFAULT '[]',
  remote TEXT NOT NULL DEFAULT 'any' CHECK (remote IN ('remote','hybrid','onsite','any')),
  seniority TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]',
  excluded_companies TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_profiles_name ON profiles (name COLLATE NOCASE);
`);

  const old = db.prepare('SELECT * FROM profile WHERE id = 1').get() as OldProfileRow | undefined;
  const hasData =
    (
      db
        .prepare(
          `SELECT EXISTS (SELECT 1 FROM runs) OR EXISTS (SELECT 1 FROM jobs)
             OR EXISTS (SELECT 1 FROM applications) AS present`,
        )
        .get() as { present: number }
    ).present === 1;

  // Null only when there is no profile and no data: the copies below then move zero rows.
  let ownerId: string | null = null;
  if (old) {
    ownerId = randomUUID();
    db.prepare(
      `INSERT INTO profiles (id, name, target_roles, locations, remote, seniority, keywords,
         excluded_companies, notes, created_at)
       VALUES (@id, @name, @target_roles, @locations, @remote, @seniority, @keywords,
         @excluded_companies, @notes, @created_at)`,
    ).run({ ...old, id: ownerId, name: nameFromRoles(old.target_roles) });
  } else if (hasData) {
    ownerId = randomUUID();
    db.prepare('INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)').run(
      ownerId,
      'Default',
      new Date().toISOString(),
    );
  }

  db.exec(`
CREATE TABLE runs_new (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id),
  kind TEXT NOT NULL CHECK (kind IN ('discover_jobs','sync_mail')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','aborted')),
  started_at TEXT,
  finished_at TEXT,
  adapter_id TEXT NOT NULL DEFAULT '',
  prompt_version TEXT,
  summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  agent_model TEXT,
  agent_effort TEXT,
  agent_model_reported TEXT
);

CREATE TABLE jobs_new (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id),
  run_id TEXT NOT NULL REFERENCES runs (id),
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  remote TEXT NOT NULL DEFAULT 'unknown' CHECK (remote IN ('remote','hybrid','onsite','unknown')),
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source_site TEXT,
  posted_at TEXT,
  salary TEXT,
  description_excerpt TEXT,
  match_reason TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('ok','redirected','dead','unverified')),
  verified_at TEXT,
  dedupe_key TEXT NOT NULL,
  dismissed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE applications_new (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id),
  job_id TEXT REFERENCES jobs (id),
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL CHECK (status IN ${APP_STATUS}),
  applied_at TEXT,
  status_changed_at TEXT NOT NULL,
  notes TEXT,
  sender_domains TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
`);

  // rowid order is kept so same-millisecond tiebreaks still list rows in insertion order.
  for (const [table, columns] of [
    ['runs', RUN_COLUMNS],
    ['jobs', JOB_COLUMNS],
    ['applications', APPLICATION_COLUMNS],
  ] as const) {
    db.prepare(
      `INSERT INTO ${table}_new (${columns}, profile_id) SELECT ${columns}, ? FROM ${table} ORDER BY rowid`,
    ).run(ownerId);
  }

  // Documented SQLite rebuild order: drop the old table, then rename the copy into its place.
  db.exec(`
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE INDEX idx_runs_status ON runs (status);
CREATE INDEX idx_runs_profile_id ON runs (profile_id);

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE UNIQUE INDEX idx_jobs_profile_dedupe_key ON jobs (profile_id, dedupe_key);
CREATE INDEX idx_jobs_run_id ON jobs (run_id);

DROP TABLE applications;
ALTER TABLE applications_new RENAME TO applications;
CREATE INDEX idx_applications_status ON applications (status);
CREATE INDEX idx_applications_profile_id ON applications (profile_id);
CREATE INDEX idx_applications_job_id ON applications (job_id);

DROP TABLE profile;
`);
}

// NOCASE folds ASCII letters only; keys must match the unique index on profiles.name.
const nocaseKey = (name: string) => name.replace(/[A-Z]/g, (c) => c.toLowerCase());

// Gives every profile a unique slug and makes every stored name follow the name rule (SOW-0015).
// Valid names are kept first; invalid ones are cleaned and numbered on a clash. Reusing the domain rules
// is deliberate: a later change to them needs its own migration anyway.
function addProfileSlugs(db: Database.Database): void {
  db.exec("ALTER TABLE profiles ADD COLUMN slug TEXT NOT NULL DEFAULT ''");
  const rows = db.prepare('SELECT id, name FROM profiles ORDER BY rowid').all() as { id: string; name: string }[];

  const finalName = new Map<string, string>();
  const usedNames = new Set<string>();
  const pending: { id: string; base: string }[] = [];
  for (const row of rows) {
    const normalized = normalizeProfileName(row.name);
    if (isValidProfileName(normalized) && !usedNames.has(nocaseKey(normalized))) {
      finalName.set(row.id, normalized);
      usedNames.add(nocaseKey(normalized));
    } else {
      pending.push({ id: row.id, base: isValidProfileName(normalized) ? normalized : cleanProfileName(row.name) });
    }
  }
  for (const { id, base } of pending) {
    let name = base;
    for (let n = 2; usedNames.has(nocaseKey(name)); n++) {
      const suffix = ` ${n}`;
      name = `${cutProfileName(base, PROFILE_NAME_MAX - suffix.length)}${suffix}`;
    }
    finalName.set(id, name);
    usedNames.add(nocaseKey(name));
  }

  // Two phases, so a row taking a name another row still holds never trips the unique index.
  const setName = db.prepare('UPDATE profiles SET name = ? WHERE id = ?');
  for (const row of rows) setName.run(`~${row.id}`, row.id);
  for (const row of rows) setName.run(finalName.get(row.id), row.id);

  const usedSlugs = new Set<string>();
  const setSlug = db.prepare('UPDATE profiles SET slug = ? WHERE id = ?');
  for (const row of rows) {
    const slug = uniqueSlug(slugBase(finalName.get(row.id) as string), (s) => usedSlugs.has(s));
    usedSlugs.add(slug);
    setSlug.run(slug, row.id);
  }
  db.exec('CREATE UNIQUE INDEX idx_profiles_slug ON profiles (slug)');
}
