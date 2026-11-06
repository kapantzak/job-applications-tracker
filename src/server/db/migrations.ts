const APP_STATUS =
  "('saved','applied','screening','interview','offer','rejected','withdrawn','no_response')";

// SQL lives in TS (not .sql files) so the bundle needs no asset copying.
export const migrations: { id: number; sql: string }[] = [
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
];
