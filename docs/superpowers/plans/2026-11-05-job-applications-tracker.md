# Job Applications Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 of `job-applications-tracker`: an npm-installable local web app that uses the user's own CLI agent to find job openings and to propose application status changes from Gmail, with every change confirmed by the user.

**Architecture:** One Node process. A Hono API and a bundled React SPA share the process; SQLite (better-sqlite3) holds all state under `~/.job-applications-tracker/`. Agent work runs through an `AgentAdapter` (CLI presets for Claude Code and Codex, plus a custom command) inside a persisted, single-worker run queue whose logs stream to the UI over SSE. Discovery results pass through link verification and dedupe before display; mail findings become proposals in a review queue.

**Tech Stack:** Node >= 22 (ruling 2026-11-05, see Global Constraints), TypeScript (ESM), Hono 4 + @hono/node-server 2, better-sqlite3 13, zod 4 (`z.toJSONSchema`), tsup 9 (server bundle), Vite 8 + React 19 (UI), vitest 5, `open` 11.

**Spec:** `docs/superpowers/specs/2026-11-05-job-applications-tracker-design.md`

## Global Constraints

- Node.js 22 or newer (`"engines": { "node": ">=22" }`). ESM only (`"type": "module"`). Amended from 20 on 2026-11-05: Node 20 reached end of life in April 2026, and better-sqlite3 13, vitest 5 and tsup 9 all require Node 22.
- No native build step on install: `better-sqlite3` is the only native dependency and ships prebuilt binaries.
- Package name `job-applications-tracker`, binary `jobtrack`, default port `4173`, server binds `127.0.0.1` only, never `0.0.0.0`.
- Data directory `~/.job-applications-tracker/` holding `data.db` and `runs/`; overridable via `--data-dir` or `JOBTRACK_DATA_DIR`. Plan-level deviation from the spec default: no `config.json` is written in v1; `port` lives in the `settings` table like every other setting.
- The app holds no model keys and makes no model calls. The agent runs as a child process.
- Status pipeline, exact strings: `saved`, `applied`, `screening`, `interview`, `offer`, `rejected`, `withdrawn`, `no_response`.
- Run statuses: `queued`, `running`, `succeeded`, `failed`, `aborted`. Run kinds: `discover_jobs`, `sync_mail`. Verification statuses: `ok`, `redirected`, `dead`, `unverified`.
- Run queue concurrency is 1. Default run timeout 600000 ms.
- No application status ever changes from a mail finding without a user accepting the proposal.
- Every prompt tells the agent: read only, never apply, never send or draft mail, never modify labels.
- Repository rules: commit only the files each task names; never `git add -A`; commit messages describe the change and mention no tooling.
- IDs are `crypto.randomUUID()` strings; timestamps are ISO-8601 UTC strings.

## Review Focus

1. A custom agent prints the JSON wrapped in a markdown fence or preceded by prose. Expected: the adapter still extracts the last JSON object; a person should not have to fix their agent's chatter. Test pinned in Task 9.
2. The same posting comes back as `https://Boards.Greenhouse.io/acme/jobs/123?utm_source=x` and `https://boards.greenhouse.io/acme/jobs/123/`. Expected: one job, not two. Test pinned in Task 10.
3. The user manually moves an application to `interview`, then accepts a stale proposal for `interview`. Expected: no duplicate history row and no error. Test pinned in Task 7.
4. The server is killed while a run is `running`. Expected: on next start that run shows `aborted` with a reason; queued runs still execute. Test pinned in Task 11.
5. Port 4173 is already taken by another app. Expected: the server starts on the next free port and prints that URL, instead of crashing. Test pinned in Task 17.

---

## Part A: server, services and CLI

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `tsup.config.ts`, `vitest.config.ts`, `.gitignore`, `.npmignore` (or `files` in package.json), `src/server/version.ts`, `test/server/version.test.ts`

**Interfaces:**
- Produces: `APP_VERSION: string` exported from `src/server/version.ts`, read from `package.json` at build time via tsup `define`.
- Scripts: `build` (tsup server + vite UI; UI part added in Task 18), `dev:server` (`tsx watch src/server/index.ts`), `test` (`vitest run`), `typecheck` (`tsc -p tsconfig.server.json --noEmit`).

- [ ] **Step 1: Write the failing test**

`test/server/version.test.ts`: `APP_VERSION` matches `/^\d+\.\d+\.\d+/`.

- [ ] **Step 2: Run `npx vitest run test/server/version.test.ts`** and confirm it fails because the module does not exist.

- [ ] **Step 3: Create the scaffold**

`package.json`: name `job-applications-tracker`, version `0.1.0`, `type: module`, `bin: { jobtrack: "bin/jobtrack.js" }`, `engines.node >=20`, `files: ["bin", "dist", "prompts", "README.md"]`. Dependencies: `hono`, `@hono/node-server`, `better-sqlite3`, `zod`, `open`. Dev: `typescript`, `tsup`, `tsx`, `vitest`, `@types/better-sqlite3`, `@types/node`. Pin majors as listed in Tech Stack.
`tsconfig.server.json`: `module: NodeNext`, `target: ES2022`, `strict: true`, `include: ["src/server", "test/server"]`.
`tsup.config.ts`: entry `src/server/index.ts`, format `esm`, outDir `dist/server`, external `better-sqlite3`, `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`.
`.gitignore`: `node_modules`, `dist`, `.tmp`, `.DS_Store`, `*.log`.
`src/server/version.ts`: `export const APP_VERSION: string = __APP_VERSION__` with a `declare const` and a dev fallback reading `package.json`.

- [ ] **Step 4: Run the test and `npm run typecheck`**; both pass.

- [ ] **Step 5: Commit** `package.json package-lock.json tsconfig.json tsconfig.server.json tsup.config.ts vitest.config.ts .gitignore src/server/version.ts test/server/version.test.ts` with message `Scaffold package, build and test tooling`.

### Task 2: Data directory resolution

**Files:**
- Create: `src/server/config/paths.ts`, `test/server/config/paths.test.ts`

**Interfaces:**
- Produces: `resolveDataDir(opts: { flag?: string; env?: NodeJS.ProcessEnv; home?: string }): string` and `ensureDataDir(dir: string): { dbFile: string; runsDir: string }` (creates `dir` and `dir/runs` recursively).

- [ ] **Step 1: Write failing tests**
  - `resolveDataDir` with no flag and no env returns `<home>/.job-applications-tracker`.
  - `env.JOBTRACK_DATA_DIR` wins over home; `flag` wins over env.
  - `ensureDataDir(tmp)` creates `runs/` and returns `dbFile` ending in `data.db`.
- [ ] **Step 2: Run tests; fail.**
- [ ] **Step 3: Implement** both functions with `node:path` and `node:fs`.
- [ ] **Step 4: Run tests; pass.**
- [ ] **Step 5: Commit** `src/server/config/paths.ts test/server/config/paths.test.ts`, message `Resolve and create the data directory`.

### Task 3: Database, migrations and domain types

**Files:**
- Create: `src/server/domain/types.ts`, `src/server/db/connection.ts`, `src/server/db/migrations.ts`, `test/server/db/migrations.test.ts`

**Interfaces:**
- Produces in `domain/types.ts`: string-literal unions `ApplicationStatus`, `RunKind`, `RunStatus`, `VerificationStatus`, `ProposalState = 'pending'|'accepted'|'rejected'`, `HistorySource = 'user'|'proposal'`; row types `Profile`, `Settings`, `Run`, `Job`, `Application`, `StatusHistoryEntry`, `Proposal` with the columns from spec section 5.5, `sender_domains: string[]` and `evidence: ProposalEvidence` already parsed from JSON; `ProposalEvidence = { message_id; date; from; subject; snippet }`.
- Produces in `db/connection.ts`: `openDatabase(file: string): Database` (better-sqlite3, `journal_mode = WAL`, `foreign_keys = ON`), `migrate(db: Database): number` returning the number of migrations applied.
- Produces in `db/migrations.ts`: `export const migrations: { id: number; sql: string }[]`; migration 1 creates `schema_migrations`, `profile`, `settings`, `runs`, `jobs`, `applications`, `status_history`, `proposals` with the columns in spec 5.5. `applications.applied_at` is nullable. `jobs.dedupe_key` has a unique index. `proposals.state` and `runs.status` are indexed.

- [ ] **Step 1: Write failing tests**
  - `migrate(openDatabase(':memory:'))` returns 1 and `sqlite_master` lists the eight tables.
  - Calling `migrate` twice returns 0 the second time.
- [ ] **Step 2: Run; fail.**
- [ ] **Step 3: Implement** types, connection and migration 1 as SQL strings in TypeScript (no `.sql` files, so the bundle needs no asset copying).
- [ ] **Step 4: Run; pass.**
- [ ] **Step 5: Commit** the four files, message `Add SQLite connection, schema migration and domain types`.

### Task 4: Profile and settings repositories

**Files:**
- Create: `src/server/db/profile-repo.ts`, `src/server/db/settings-repo.ts`, `test/server/db/profile-repo.test.ts`, `test/server/db/settings-repo.test.ts`

**Interfaces:**
- Produces: `createProfileRepo(db): { get(): Profile | null; save(input: ProfileInput): Profile }` where `ProfileInput = { target_roles: string[]; locations: string[]; remote: 'remote'|'hybrid'|'onsite'|'any'; seniority: string; keywords: string[]; excluded_companies: string[]; notes: string }`. Single row, `save` upserts.
- Produces: `createSettingsRepo(db): { getAll(): Settings; set(patch: Partial<Settings>): Settings }`. `Settings = { adapter_id: 'claude'|'codex'|'custom'; custom_command: string; permission_mode_discover: string; permission_mode_sync: string; allowed_tools_discover: string; allowed_tools_sync: string; sandbox_discover: string; sandbox_sync: string; run_timeout_ms: number; sync_interval: 'off'|'1h'|'6h'|'24h'; port: number }`. `DEFAULT_SETTINGS` exported: `adapter_id 'claude'`, `run_timeout_ms 600000`, `sync_interval 'off'`, `port 4173`, `permission_mode_* 'default'`, `allowed_tools_discover 'WebSearch,WebFetch'`, `allowed_tools_sync 'mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Gmail__get_message'`, `sandbox_* 'read-only'`, `custom_command ''`. Stored as key/value with JSON-encoded values; unknown keys ignored on read.

- [ ] **Step 1: Write failing tests**
  - profile: `get()` is `null` on empty db; `save` then `get` round-trips arrays; second `save` replaces, still one row.
  - settings: `getAll()` equals `DEFAULT_SETTINGS` on empty db; `set({ port: 5000 })` persists and leaves other defaults; `set` with an unknown key throws.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit** the four files, message `Add profile and settings repositories`.

### Task 5: Jobs repository

**Files:**
- Create: `src/server/db/jobs-repo.ts`, `test/server/db/jobs-repo.test.ts`

**Interfaces:**
- Produces: `createJobsRepo(db): { insertMany(runId: string, jobs: NewJob[]): Job[]; list(opts?: { includeDead?: boolean; includeDismissed?: boolean }): Job[]; get(id: string): Job | null; dismiss(id: string): void; existingDedupeKeys(): Set<string>; recentCanonicalUrls(limit: number): string[] }`.
- `NewJob = Omit<Job, 'id'|'run_id'|'dismissed_at'|'created_at'>`. `list` orders by `created_at` desc; by default excludes `verification_status = 'dead'` and dismissed rows. `insertMany` is one transaction and silently skips rows whose `dedupe_key` already exists, returning only inserted rows.

- [ ] **Step 1: Write failing tests**
  - insert two jobs, `list()` returns both newest first.
  - inserting a job with an existing `dedupe_key` returns an empty array and leaves one row.
  - `list()` hides `dead` and dismissed; `list({ includeDead: true, includeDismissed: true })` shows them.
  - `recentCanonicalUrls(1)` returns only the newest.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit**, message `Add jobs repository`.

### Task 6: Applications and status history repository

**Files:**
- Create: `src/server/db/applications-repo.ts`, `test/server/db/applications-repo.test.ts`

**Interfaces:**
- Produces: `createApplicationsRepo(db): { create(input: NewApplication): Application; get(id): Application | null; list(filter?: { open?: boolean }): Application[]; update(id, patch: Partial<Pick<Application,'company'|'role'|'url'|'notes'|'sender_domains'|'applied_at'>>): Application; setStatus(id, to: ApplicationStatus, source: HistorySource, proposalId?: string): Application; history(id): StatusHistoryEntry[] }`.
- `NewApplication = { job_id?: string | null; company; role; url?: string | null; status?: ApplicationStatus; applied_at?: string | null; notes?: string; sender_domains?: string[] }`. Default status `applied` with `applied_at = now` unless `status === 'saved'` (then `applied_at = null`).
- `list({ open: true })` returns applications whose status is in `applied`, `screening`, `interview`, `no_response`, or `offer` with `status_changed_at` within the last 30 days. Never `saved`, `rejected`, `withdrawn`.
- `setStatus` writes a `status_history` row and updates `status` and `status_changed_at` in one transaction. Setting the same status is a no-op returning the unchanged row.
- `inferSenderDomain(url: string): string | null` exported: hostname without `www.`, or `null` for known ATS hosts (`greenhouse.io`, `lever.co`, `ashbyhq.com`, `myworkday.com`, `workdayjobs.com`, `smartrecruiters.com`, `linkedin.com`, `indeed.com`).

- [ ] **Step 1: Write failing tests**
  - `create` with `status: 'saved'` has `applied_at === null`; default create has `applied_at` set and status `applied`.
  - `setStatus(id, 'screening', 'user')` writes one history row `applied -> screening` with source `user`; calling again with `screening` writes nothing.
  - `list({ open: true })` excludes `saved`, `rejected`, `withdrawn` and an `offer` whose `status_changed_at` is 31 days old, includes `no_response`.
  - `inferSenderDomain('https://www.acme.com/careers/1')` is `acme.com`; for `https://boards.greenhouse.io/acme/jobs/1` is `null`.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit**, message `Add applications repository with status history`.

### Task 7: Proposals repository and decisions

**Files:**
- Create: `src/server/db/proposals-repo.ts`, `src/server/services/proposals.ts`, `test/server/db/proposals-repo.test.ts`, `test/server/services/proposals.test.ts`

**Interfaces:**
- Produces: `createProposalsRepo(db): { createMany(runId: string, items: NewProposal[]): Proposal[]; listPending(): Proposal[]; get(id): Proposal | null; decide(id, state: 'accepted'|'rejected'): Proposal; reviewedMessageIds(): string[]; hasPending(applicationId: string, proposedStatus: ApplicationStatus): boolean }`.
- `NewProposal = { application_id; proposed_status: ApplicationStatus; confidence: number; reason: string; evidence: ProposalEvidence }`. `reviewedMessageIds` returns `evidence.message_id` of every non-pending proposal.
- Produces in services: `createProposalService({ proposalsRepo, applicationsRepo }): { accept(id: string): { proposal: Proposal; application: Application }; reject(id: string): Proposal }`. `accept`: if the application's status already equals `proposed_status`, mark accepted and write no history; otherwise `applicationsRepo.setStatus(appId, proposed, 'proposal', id)` then mark accepted. Accepting or rejecting a non-pending proposal throws `ProposalNotPendingError`.

- [ ] **Step 1: Write failing tests**
  - repo: `createMany` then `listPending` returns them; `decide(id,'rejected')` removes it from pending and its message id appears in `reviewedMessageIds()`; `hasPending` true/false.
  - service: accept moves `applied -> interview` with one history row, source `proposal`, `proposal_id` set.
  - service (Review Focus 3): application already `interview`, accept proposal for `interview`: state `accepted`, history length unchanged, no throw.
  - service: accept twice throws `ProposalNotPendingError`.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit** the four files, message `Add proposals repository and accept/reject service`.

### Task 8: Task schemas and prompt templates

**Files:**
- Create: `src/server/tasks/schemas.ts`, `src/server/tasks/prompts.ts`, `prompts/discover_jobs.md`, `prompts/sync_mail.md`, `test/server/tasks/schemas.test.ts`, `test/server/tasks/prompts.test.ts`

**Interfaces:**
- Produces in `schemas.ts`: zod schemas `DiscoverJobsOutput` and `SyncMailOutput` exactly as spec section 7 (`sync_mail` includes required `mail_access: boolean`; `proposed_status` enum `screening|interview|offer|rejected|no_change`; `confidence` 0..1), inferred types `DiscoverJobsResult`, `SyncMailResult`, and `outputJsonSchema(kind: RunKind): Record<string, unknown>` via `z.toJSONSchema`.
- Produces in `prompts.ts`: `renderPrompt(kind: RunKind, vars: Record<string, unknown>): { text: string; version: string }`. Templates live in `prompts/<kind>.md` with YAML front matter `version: 1`; placeholders `{{name}}` for strings and `{{#each list}}...{{/each}}` is NOT supported: list variables are pre-rendered by the caller as strings. `PROMPTS_DIR` is resolved from `import.meta.url` so it works from `dist/` and from `src/`.
- Template content requirements (exact copy left to the builder, these points are mandatory): both templates state read-only rules from Global Constraints. `discover_jobs.md` takes `{{profile}}`, `{{known_urls}}`, asks for employer careers or ATS links over aggregators, and asks for the `jobs` array only. `sync_mail.md` takes `{{applications}}`, `{{reviewed_message_ids}}`, `{{ats_domains}}`, restricts search to listed companies and ATS domains newer than each `applied_at`, at most one finding per application, short snippet only, and instructs: "If you have no tool that can search Gmail, set `mail_access` to false and return an empty `findings` array."

- [ ] **Step 1: Write failing tests**
  - `DiscoverJobsOutput.parse` accepts a valid sample and rejects a job without `url`.
  - `SyncMailOutput.parse` rejects a payload missing `mail_access`.
  - `outputJsonSchema('sync_mail')` has `required` containing `mail_access`.
  - `renderPrompt('discover_jobs', { profile: 'P', known_urls: 'U' })` returns version `'1'`, text containing `P`, `U`, and the phrase `read only` (case-insensitive), and no unreplaced `{{`.
- [ ] **Step 2: Run; fail.** **Step 3: Implement** schemas, renderer and both templates. **Step 4: Run; pass.**
- [ ] **Step 5: Commit** the six files, message `Add task output schemas and prompt templates`.

### Task 9: Agent adapter with CLI presets

**Files:**
- Create: `src/server/agents/types.ts`, `src/server/agents/cli-adapter.ts`, `src/server/agents/presets.ts`, `src/server/agents/extract-json.ts`, `src/server/agents/index.ts`, `test/fixtures/fake-agent.mjs`, `test/server/agents/cli-adapter.test.ts`, `test/server/agents/extract-json.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  type AdapterId = 'claude' | 'codex' | 'custom';
  interface AdapterHealth { id: AdapterId; installed: boolean; version?: string; message?: string }
  interface AgentTask { kind: RunKind; prompt: string; outputSchema: Record<string, unknown> }
  interface RunOptions { timeoutMs: number; cwd: string; onLog?: (line: string) => void; signal?: AbortSignal }
  interface AgentResult { ok: boolean; output?: unknown; rawStdout: string; rawStderr: string; exitCode: number | null; durationMs: number; error?: string }
  interface AgentAdapter { id: AdapterId; check(): Promise<AdapterHealth>; run(task: AgentTask, opts: RunOptions): Promise<AgentResult> }
  interface CliAdapterConfig { id: AdapterId; argv: string[]; promptVia: 'stdin' | 'argv' | 'file'; resultFrom: 'claude-stream-json' | 'output-file' | 'stdout-json'; versionArgv?: string[] }
  ```
  `argv` placeholders: `{schema}` (inline JSON), `{schema_file}`, `{prompt_file}`, `{output_file}`, `{permission_mode}`, `{allowed_tools}`, `{sandbox}`. Temp files go under `opts.cwd` (the run directory) and are kept for debugging.
- Produces in `presets.ts`: `buildAdapterConfig(settings: Settings, kind: RunKind): CliAdapterConfig`. Presets:
  - claude: `['claude','-p','--output-format','stream-json','--verbose','--json-schema','{schema}','--permission-mode','{permission_mode}','--allowedTools','{allowed_tools}']`, `promptVia: 'stdin'`, `resultFrom: 'claude-stream-json'`, `versionArgv: ['claude','--version']`.
  - codex: `['codex','exec','--json','--output-schema','{schema_file}','--skip-git-repo-check','--sandbox','{sandbox}','-o','{output_file}']`, `promptVia: 'argv'` (appended last), `resultFrom: 'output-file'`, `versionArgv: ['codex','--version']`.
  - custom: `settings.custom_command` split by shell-style whitespace (quoted segments respected), `promptVia: 'file'`, `resultFrom: 'stdout-json'`.
  - The builder must re-check the flag spellings against `claude --help` and `codex exec --help` on the build machine and note any change in the commit message.
- Produces in `extract-json.ts`: `extractLastJsonObject(text: string): unknown` (strips ``` fences, finds the last balanced top-level `{...}`; throws `NoJsonFoundError`) and `extractClaudeStructuredOutput(ndjson: string): unknown` (last line whose `type === 'result'`; returns its `structured_output`; if absent, falls back to `extractLastJsonObject(result)`).
- Produces in `cli-adapter.ts`: `createCliAdapter(config: CliAdapterConfig): AgentAdapter`. `run` spawns with `child_process.spawn` (no shell), streams stdout and stderr lines to `onLog`, kills the process on timeout or abort (`SIGTERM`, then `SIGKILL` after 5 s; on Windows `taskkill /T`), and resolves `ok: false` with `error` on non-zero exit, timeout, or extraction failure. `check` runs `versionArgv` and reports `installed` from spawn success; `ENOENT` means not installed.
- Produces in `index.ts`: `createAdapter(settings: Settings, kind: RunKind): AgentAdapter`.
- `test/fixtures/fake-agent.mjs`: a Node script controlled by env `FAKE_AGENT_MODE` = `ok` (prints fenced JSON from `FAKE_AGENT_OUTPUT`), `prose` (prose line, then JSON), `claude` (prints NDJSON with a `result` event containing `structured_output`), `fail` (exit 2), `hang` (sleeps 60 s), `codex` (writes `FAKE_AGENT_OUTPUT` to the path given after `-o`).

- [ ] **Step 1: Write failing tests**
  - `extractLastJsonObject('```json\n{"a":1}\n```')` is `{a:1}`; with prose before the object still `{a:1}` (Review Focus 1); plain text throws `NoJsonFoundError`.
  - `extractClaudeStructuredOutput` returns `structured_output` from the `result` line.
  - cli adapter with custom config pointing at the fixture, mode `ok`: `ok === true`, `output` equals the JSON, `onLog` received at least one line.
  - mode `fail`: `ok === false`, `exitCode === 2`.
  - mode `hang` with `timeoutMs: 500`: resolves within 3 s with `ok === false`, `error` mentions timeout.
  - mode `claude` with `resultFrom: 'claude-stream-json'`: output parsed from the result event.
  - mode `codex` with `resultFrom: 'output-file'`: output read from `{output_file}`.
  - `check()` for argv `['definitely-not-a-binary-xyz','--version']` gives `installed === false`.
  - `buildAdapterConfig(settings with adapter_id 'claude', 'sync_mail')` contains `--allowedTools` followed by `settings.allowed_tools_sync`.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit** all nine files, message `Add CLI agent adapter with Claude Code, Codex and custom presets`.

### Task 10: Link verification and dedupe

**Files:**
- Create: `src/server/verify/canonicalize.ts`, `src/server/verify/links.ts`, `test/server/verify/canonicalize.test.ts`, `test/server/verify/links.test.ts`

**Interfaces:**
- Produces: `canonicalUrl(input: string): string` (lowercase scheme and host, drop fragment, drop tracking params `utm_*`, `gclid`, `fbclid`, `ref`, `refId`, `trk`, `trackingId`, `src`, `source`, `mkt_tok`, `gh_src`, `lever-source`, sort remaining params, strip trailing slash except root) and `dedupeKey(job: { canonical_url: string | null; company: string; title: string; location: string }): string` (canonical url if present, else `company|title|location` lowercased, whitespace collapsed, diacritics stripped).
- Produces: `verifyLink(url: string, opts?: { timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<{ status: VerificationStatus; finalUrl: string; httpStatus: number | null }>`. GET with a desktop-browser `User-Agent`, `redirect: 'manual'`, follow at most 5 redirects, no cookies. Classification per spec 6.2 step 3: `2xx` → `ok` (or `redirected` if any hop happened), `404|410|ENOTFOUND|ECONNREFUSED` → `dead`, `403|429|999|5xx|timeout|other` → `unverified`. More than 5 redirects → `unverified`.

- [ ] **Step 1: Write failing tests**
  - canonicalize (Review Focus 2): the two Greenhouse URLs from Review Focus 2 produce equal `canonicalUrl` and equal `dedupeKey`.
  - `dedupeKey` with null url: `' Acme  Corp '/'Senior Engineer'/'Berlin'` equals `'acme corp|senior engineer|berlin'`.
  - links, against a local `http.createServer` started in the test: `/ok` 200 → `ok`; `/r1` 301 → `/ok` → `redirected` with `finalUrl` ending `/ok`; `/gone` 404 → `dead`; `/blocked` 403 → `unverified`; `/slow` never responds with `timeoutMs: 300` → `unverified`; `/loop` redirecting to itself → `unverified`; closed port → `dead`.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit**, message `Add link verification and URL canonicalisation`.

### Task 11: Persisted run queue with log streaming

**Files:**
- Create: `src/server/db/runs-repo.ts`, `src/server/runs/queue.ts`, `src/server/runs/log-store.ts`, `test/server/runs/queue.test.ts`

**Interfaces:**
- Produces: `createRunsRepo(db): { create(kind: RunKind, meta: { adapter_id: string; prompt_version: string | null }): Run; update(id, patch: Partial<Pick<Run,'status'|'started_at'|'finished_at'|'summary'|'error'|'prompt_version'>>): Run; get(id): Run | null; list(limit?: number): Run[]; nextQueued(): Run | null; markInterrupted(): number; hasActive(kind: RunKind): boolean }`. `markInterrupted` sets every `running` row to `aborted` with `error = 'server restarted'`.
- Produces: `createLogStore(runsDir): { append(runId, line): void; read(runId): string; subscribe(runId, cb: (line: string) => void): () => void }` writing `runs/<id>.log`.
- Produces: `createRunQueue({ runsRepo, logStore, handlers: Record<RunKind, RunHandler> }): { enqueue(kind: RunKind): Run; start(): void; stop(): Promise<void>; isRunning(): boolean }` where `RunHandler = (ctx: { run: Run; log: (line: string) => void; signal: AbortSignal; runDir: string }) => Promise<{ summary: string; promptVersion?: string }>`. `start()` calls `markInterrupted` then drains. Concurrency 1. A handler that resolves → `succeeded` with summary; throws → `failed` with `error = message`; aborted via `stop()` → `aborted`. `enqueue` for a kind that already has a `queued` or `running` run returns the existing run instead of creating a second one.

- [ ] **Step 1: Write failing tests**
  - enqueue + start with a handler resolving `{ summary: 'done' }` → run reaches `succeeded`, summary stored, log file contains lines passed to `log`.
  - handler throws `new Error('boom')` → `failed`, `error === 'boom'`.
  - two `enqueue('discover_jobs')` while first is queued → same run id returned.
  - a run inserted directly as `running` before `start()` (Review Focus 4) → after `start()` it is `aborted` with `error 'server restarted'`, and a `queued` run inserted alongside still executes.
  - `stop()` during a handler that awaits `signal` → run `aborted`, `stop()` resolves.
  - `subscribe` receives lines appended after subscription; unsubscribe stops delivery.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit** the four files, message `Add persisted single-worker run queue with log streaming`.

### Task 12: Discovery service

**Files:**
- Create: `src/server/services/discovery.ts`, `test/server/services/discovery.test.ts`

**Interfaces:**
- Consumes: `renderPrompt`, `DiscoverJobsOutput`, `outputJsonSchema`, `AgentAdapter`, `verifyLink`, `canonicalUrl`, `dedupeKey`, repos from Tasks 4 and 5.
- Produces: `createDiscoveryHandler(deps: { profileRepo; jobsRepo; settingsRepo; adapterFactory: (settings: Settings, kind: RunKind) => AgentAdapter; verify?: typeof verifyLink }): RunHandler`.
- Behaviour: throws `Error('Profile is not set')` when no profile. Renders `profile` as a readable multi-line string and `known_urls` from `jobsRepo.recentCanonicalUrls(200)`. Runs the adapter with `settings.run_timeout_ms`, `cwd = ctx.runDir`. On `ok === false` throws with the adapter error. Validates with `DiscoverJobsOutput.safeParse`; on failure throws `Error('Agent output did not match schema: <path>')`. For each job: `canonical_url = canonicalUrl(url)`, verify (concurrency 5, via a small `mapLimit`), `canonical_url = finalUrl` when redirected, `dedupe_key`, drop if key in `existingDedupeKeys()` or duplicated inside the batch. Insert. Summary: `"<n> new, <d> duplicates, <k> dead, <u> unverified"`.

- [ ] **Step 1: Write failing tests** with a stub adapter and a stub `verify`
  - two valid jobs, verify returns `ok` → two rows, summary `2 new, 0 duplicates, 0 dead, 0 unverified`.
  - a job whose canonical url already exists → skipped, summary counts 1 duplicate.
  - verify returns `dead` → row stored with `verification_status 'dead'`, counted as dead.
  - adapter returns `{ ok: true, output: { jobs: [{ title: 'x' }] } }` → throws with `did not match schema`.
  - no profile → throws `Profile is not set` before calling the adapter.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit**, message `Add discovery run handler with verification and dedupe`.

### Task 13: Mail source and mail sync service

**Files:**
- Create: `src/server/mail/types.ts`, `src/server/mail/agent-source.ts`, `src/server/services/mail-sync.ts`, `test/server/mail/agent-source.test.ts`, `test/server/services/mail-sync.test.ts`

**Interfaces:**
- Produces in `mail/types.ts`: `MailSyncRequest = { applications: { id; company; role; applied_at: string; sender_domains: string[] }[]; reviewed_message_ids: string[] }`, `MailSyncFindings = SyncMailResult`, `interface MailSource { id: 'agent'; sync(req: MailSyncRequest, ctx: { log; signal; runDir; timeoutMs }): Promise<MailSyncFindings> }`, `class MailAccessError extends Error` with message `Your agent has no Gmail tool. See the setup guide in Settings.`.
- Produces in `agent-source.ts`: `createAgentMailSource(adapter: AgentAdapter): MailSource`. Renders `sync_mail` prompt (`applications` as a readable list, `ats_domains` constant list from Task 6), runs the adapter, validates with `SyncMailOutput`; throws `MailAccessError` when `mail_access === false`.
- Produces in `services/mail-sync.ts`: `createMailSyncHandler(deps: { applicationsRepo; proposalsRepo; settingsRepo; mailSourceFactory: (settings: Settings) => MailSource }): RunHandler`. Uses `applicationsRepo.list({ open: true })`; if empty, returns summary `'no open applications'` without calling the source. Drops `no_change` findings, drops unknown `application_id` with a log line, skips when `proposalsRepo.hasPending(appId, status)`. Summary: `"<p> proposals created, <s> skipped"`.

- [ ] **Step 1: Write failing tests**
  - agent source with stub adapter returning `mail_access: false` rejects with `MailAccessError`.
  - agent source passes `reviewed_message_ids` into the prompt text (stub adapter captures `task.prompt`).
  - sync handler: one open application, one finding `interview` → one pending proposal with evidence stored, summary `1 proposals created, 0 skipped`.
  - finding with unknown `application_id` → no proposal, log contains `unknown application`.
  - finding `no_change` → nothing created.
  - duplicate pending (same app, same status) → skipped count 1.
  - no open applications → source never called.
  - source throws `MailAccessError` → handler rejects with the same message (queue will mark the run failed).
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit** the five files, message `Add agent mail source and mail sync run handler`.

### Task 14: Sync scheduler

**Files:**
- Create: `src/server/runs/scheduler.ts`, `test/server/runs/scheduler.test.ts`

**Interfaces:**
- Produces: `createSyncScheduler({ settingsRepo, queue }): { start(): void; stop(): void; refresh(): void }`. Interval map `1h → 3600000`, `6h → 21600000`, `24h → 86400000`, `off → none`. On each tick calls `queue.enqueue('sync_mail')` (the queue already dedupes active runs). `refresh()` re-reads settings and resets the timer; the API calls it after settings change.

- [ ] **Step 1: Write failing tests** with `vi.useFakeTimers()`
  - interval `off`: advancing 24 h never enqueues.
  - interval `1h`: advancing 1 h enqueues once, 3 h enqueues three times.
  - `refresh()` after switching to `off` stops further enqueues; `stop()` clears the timer.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit**, message `Add interval-based mail sync scheduler`.

### Task 15: HTTP API

**Files:**
- Create: `src/server/app.ts`, `src/server/api/profile.ts`, `src/server/api/settings.ts`, `src/server/api/jobs.ts`, `src/server/api/applications.ts`, `src/server/api/proposals.ts`, `src/server/api/runs.ts`, `src/server/api/setup.ts`, `src/server/api/errors.ts`, `test/server/api/*.test.ts` (one per router)

**Interfaces:**
- Produces: `createApp(deps: AppDeps): Hono` where `AppDeps = { db; dataDir: string; runsDir: string; profileRepo; settingsRepo; jobsRepo; applicationsRepo; proposalsRepo; runsRepo; proposalService; queue; logStore; scheduler; adapterFactory; uiDir: string | null }`. All routers under `/api`. JSON errors `{ error: string }` with 400 for validation (zod request schemas), 404 for missing ids, 409 for `ProposalNotPendingError`, 422 for `Profile is not set`.
- Routes:
  - `GET /api/health` → `{ ok: true, version, dataDir }`.
  - `GET /api/setup/adapters` → `AdapterHealth[]` for `claude`, `codex`, and `custom` when `custom_command` is non-empty; includes `gmail_guide: boolean` true for non-claude ids.
  - `GET|PUT /api/profile`.
  - `GET|PATCH /api/settings` (PATCH calls `scheduler.refresh()`).
  - `GET /api/jobs?includeDead&includeDismissed`, `POST /api/jobs/:id/dismiss`, `POST /api/jobs/:id/save` (creates application `saved`), `POST /api/jobs/:id/applied` (creates application `applied`, `sender_domains` from `inferSenderDomain(url)`), each returning the created application where applicable.
  - `GET /api/applications?open`, `POST /api/applications` (manual), `GET /api/applications/:id` (with `history`), `PATCH /api/applications/:id` (fields from `update`), `POST /api/applications/:id/status { status }` (source `user`).
  - `GET /api/proposals` (pending, each with its application embedded), `POST /api/proposals/:id/accept`, `POST /api/proposals/:id/reject`.
  - `GET /api/runs?limit`, `GET /api/runs/:id`, `GET /api/runs/:id/log` (full text), `GET /api/runs/:id/events` (SSE: replays existing log lines, then streams new ones, sends `event: done` when run finishes), `POST /api/runs/discover`, `POST /api/runs/sync` (both 202 with the run), `DELETE /api/runs/logs` (deletes every `*.log` in `runsDir` for runs that are not `running`, returns `{ deleted: n }`).
  - Non-`/api` paths: when `uiDir` is set, `serveStatic` from it with `index.html` fallback; otherwise 404.

- [ ] **Step 1: Write failing tests** using `app.request()` with an in-memory db and a stub adapter factory
  - health returns version.
  - `PUT /api/profile` with an invalid body → 400; valid → 200 and `GET` round-trips.
  - `POST /api/jobs/:id/applied` creates an application with `sender_domains` inferred; unknown job → 404.
  - `POST /api/applications/:id/status` with `status: 'bogus'` → 400.
  - `POST /api/proposals/:id/accept` twice → second is 409.
  - `POST /api/runs/discover` without profile → 422 before enqueueing.
  - `POST /api/runs/discover` with profile → 202 and `GET /api/runs/:id` shows it.
  - `GET /api/runs/:id/events` streams a line appended after the request started (read the body stream in the test).
  - `GET /` with `uiDir` pointing at a temp dir containing `index.html` returns it; `GET /anything` returns the same (SPA fallback).
  - `DELETE /api/runs/logs` with two log files in `runsDir` returns `{ deleted: 2 }` and the directory is empty.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit** app, routers and tests, message `Add HTTP API and static UI serving`.

### Task 16: Application bootstrap

**Files:**
- Create: `src/server/index.ts`, `test/server/index.test.ts`

**Interfaces:**
- Produces: `startApp(opts: { dataDir?: string; port?: number; host?: '127.0.0.1'; uiDir?: string | null; env?: NodeJS.ProcessEnv }): Promise<{ url: string; port: number; close(): Promise<void> }>`. Wires Tasks 2 to 15: resolve and ensure data dir, open and migrate db, create repos, adapter factory (`createAdapter`), discovery and mail sync handlers, queue, scheduler, app; `queue.start()`, `scheduler.start()`; listen on `127.0.0.1`. Port: `opts.port` ?? `settings.port`; if `EADDRINUSE`, try the next port, up to 10 attempts, then throw. `close()` stops scheduler, `queue.stop()`, closes the server and the db. Default `uiDir` is `dist/ui` resolved from `import.meta.url` when it exists, else `null`.

- [ ] **Step 1: Write failing tests**
  - `startApp({ dataDir: tmp, port: 0 })` returns a url; `fetch(url + '/api/health')` is ok; `close()` resolves; `tmp/data.db` and `tmp/runs/` exist.
  - (Review Focus 5) occupy a port with `net.createServer().listen(p, '127.0.0.1')`, then `startApp({ port: p })` returns `port === p + 1`.
  - the returned `url` starts with `http://127.0.0.1:` (loopback binding).
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit**, message `Wire application bootstrap with loopback server and port fallback`.

### Task 17: CLI entry

**Files:**
- Create: `bin/jobtrack.js`, `test/server/bin.test.ts`

**Interfaces:**
- Consumes: `startApp` from `dist/server/index.js` (the test builds first, or imports `src` through `tsx`; builder's choice, documented in the test).
- Produces: `bin/jobtrack.js` (plain ESM JavaScript, `#!/usr/bin/env node`). Flags: `--port <n>`, `--data-dir <path>`, `--no-open`, `--help`, `--version`. Prints `Job Applications Tracker running at <url>` and `Data directory: <dir>`. Opens the browser with `open` unless `--no-open` or `CI` env is set. Handles `SIGINT`/`SIGTERM` by calling `close()` then exiting 0. Exits 1 with the error message when `startApp` throws.

- [ ] **Step 1: Write failing test**: spawn `node bin/jobtrack.js --no-open --port 0 --data-dir <tmp>`, wait for the `running at` line, `fetch` health from the printed url, send `SIGINT`, expect exit code 0 within 5 s.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit** `bin/jobtrack.js test/server/bin.test.ts`, message `Add jobtrack CLI entry point`.

## Part B: user interface

### Task 18: UI scaffold, API client and app shell

**Files:**
- Create: `src/ui/index.html`, `src/ui/main.tsx`, `src/ui/App.tsx`, `src/ui/api/client.ts`, `src/ui/styles.css`, `src/ui/components/Layout.tsx`, `vite.config.ts`, `tsconfig.ui.json`, `test/ui/setup.ts`, `test/ui/client.test.ts`
- Modify: `package.json` (scripts `dev:ui` = `vite`, `build` = `tsup && vite build`; dev deps `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `react-router-dom`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`), `vitest.config.ts` (two projects: `server` node env, `ui` jsdom env)

**Interfaces:**
- Produces in `api/client.ts`: typed functions, one per route of Task 15, all returning parsed JSON and throwing `ApiError { status; message }` on non-2xx: `getHealth`, `getAdapters`, `getProfile`, `putProfile`, `getSettings`, `patchSettings`, `listJobs`, `dismissJob`, `saveJob`, `markApplied`, `listApplications`, `createApplication`, `getApplication`, `patchApplication`, `setApplicationStatus`, `listProposals`, `acceptProposal`, `rejectProposal`, `listRuns`, `getRun`, `startDiscovery`, `startSync`, `subscribeRunEvents(id, onLine, onDone): () => void` (EventSource).
- Produces: `Layout` with a left nav: Dashboard `/`, Jobs `/jobs`, Applications `/applications`, Review `/review` (badge with pending count), Runs `/runs`, Settings `/settings`, Profile `/profile`. `App.tsx` mounts routes with placeholder pages; `main.tsx` renders into `#root`.
- `vite.config.ts`: root `src/ui`, `build.outDir` `../../dist/ui`, `emptyOutDir: true`, dev proxy `/api` → `http://127.0.0.1:4173`.

- [ ] **Step 1: Write failing tests** (jsdom, `fetch` mocked)
  - `listJobs()` calls `GET /api/jobs` and returns the body.
  - `putProfile` on a 400 response throws `ApiError` with `status 400` and the server's `error` text.
- [ ] **Step 2: Run; fail.** **Step 3: Implement** scaffold, client, layout. **Step 4: Run UI tests; pass. Run `npm run build`; `dist/ui/index.html` exists. Start `node bin/jobtrack.js --no-open --data-dir .tmp/dev` and confirm `GET /` serves the shell.**
- [ ] **Step 5: Commit** the listed files, message `Scaffold React UI with API client and navigation shell`.

### Task 19: Setup and Profile screens

**Files:**
- Create: `src/ui/pages/SetupPage.tsx`, `src/ui/pages/ProfilePage.tsx`, `src/ui/components/TagInput.tsx`, `test/ui/SetupPage.test.tsx`, `test/ui/ProfilePage.test.tsx`
- Modify: `src/ui/App.tsx` (routes; redirect `/` to `/setup` when `settings.adapter_id` adapter is not installed, then to `/profile` when no profile)

**Interfaces:**
- SetupPage: lists adapters from `getAdapters()` with installed/version, radio to choose, text input for custom command (shown when `custom` chosen), "Gmail access" section rendered when the chosen adapter's `gmail_guide` is true, linking to `README.md#gmail-access-for-other-agents`. Save calls `patchSettings({ adapter_id, custom_command })`.
- ProfilePage: fields per `ProfileInput` (TagInput for list fields, select for `remote`), Save calls `putProfile`, shows inline server error text on 400.

- [ ] **Step 1: Write failing tests** (client mocked)
  - SetupPage shows "Gmail access" section when `codex` is selected and not when `claude` is selected.
  - ProfilePage submit calls `putProfile` with arrays built from TagInput entries; a thrown `ApiError` renders its message.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit**, message `Add setup and profile screens`.

### Task 20: Jobs and Run screens

**Files:**
- Create: `src/ui/pages/JobsPage.tsx`, `src/ui/pages/RunPage.tsx`, `src/ui/pages/RunsPage.tsx`, `src/ui/components/VerificationBadge.tsx`, `src/ui/components/LogView.tsx`, `test/ui/JobsPage.test.tsx`, `test/ui/RunPage.test.tsx`
- Modify: `src/ui/App.tsx` (routes `/jobs`, `/runs`, `/runs/:id`)

**Interfaces:**
- JobsPage: "Find jobs" button → `startDiscovery()` then navigate to `/runs/:id`; toggles "show dead" and "show dismissed"; rows with company, title, location, source, `VerificationBadge` (`ok` green, `redirected` blue, `unverified` amber "Could not verify", `dead` grey), actions Open (new tab, `rel="noopener"`), Save, Mark applied, Dismiss. A `422` from `startDiscovery` shows "Fill in your profile first" with a link to `/profile`.
- RunPage: status, kind, started/finished, summary or error, `LogView` fed by `subscribeRunEvents`; when status becomes `succeeded` or `failed` show a link back to Jobs or Review. A `failed` sync whose error starts with `Your agent has no Gmail tool` shows a link to Settings.
- RunsPage: table of recent runs linking to RunPage.

- [ ] **Step 1: Write failing tests**
  - JobsPage renders an `unverified` job with text "Could not verify" and renders no `dead` job by default.
  - JobsPage "Mark applied" calls `markApplied(id)` and removes the row's Mark applied button (shows "Applied").
  - RunPage appends lines delivered by the mocked `subscribeRunEvents` and shows the summary after `onDone`.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run; pass.**
- [ ] **Step 5: Commit**, message `Add jobs list and run progress screens`.

### Task 21: Applications, Review, Settings and Dashboard screens

**Files:**
- Create: `src/ui/pages/ApplicationsPage.tsx`, `src/ui/pages/ApplicationDetailPage.tsx`, `src/ui/pages/ReviewPage.tsx`, `src/ui/pages/SettingsPage.tsx`, `src/ui/pages/DashboardPage.tsx`, `src/ui/components/StatusSelect.tsx`, `test/ui/ReviewPage.test.tsx`, `test/ui/ApplicationsPage.test.tsx`, `test/ui/SettingsPage.test.tsx`
- Modify: `src/ui/App.tsx` (remaining routes)

**Interfaces:**
- ApplicationsPage: table with company, role, status (`StatusSelect` posting `setApplicationStatus`), applied date, link; "Add application" form (company, role, url, status, applied date); "Sync from Gmail" button → `startSync()` → navigate to run.
- ApplicationDetailPage: editable fields incl. `sender_domains` TagInput, status history list.
- ReviewPage: each pending proposal: application company and role, current → proposed status, confidence, reason, evidence (from, date, subject, snippet, link `https://mail.google.com/mail/#all/<message_id>`), Accept and Reject buttons. Empty state "Nothing to review".
- SettingsPage: adapter and custom command (reuse Setup section), permission mode and allowed tools per task kind, sandbox per task kind (codex), timeout, sync interval select, port (note "takes effect on restart"), data directory read-only from `getHealth().dataDir`, "Purge run logs" button calling `purgeRunLogs()` (add to the client: `DELETE /api/runs/logs`).
- DashboardPage: counts (open applications, pending proposals, new jobs since last visit is out of scope: show total jobs), last successful discovery and sync timestamps from `listRuns`, quick buttons Find jobs and Sync from Gmail.

- [ ] **Step 1: Write failing tests**
  - ReviewPage: Accept calls `acceptProposal(id)` and removes the card; empty list shows "Nothing to review".
  - ApplicationsPage: changing `StatusSelect` calls `setApplicationStatus(id, 'interview')`.
  - SettingsPage: changing sync interval calls `patchSettings({ sync_interval: '6h' })`; "Purge run logs" calls `purgeRunLogs()`.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run all tests (`npm test`) and `npm run build`; pass.**
- [ ] **Step 5: Commit**, message `Add applications, review, settings and dashboard screens`.

### Task 22: README, end-to-end check and package verification

**Files:**
- Create: `README.md` (replace the one-line stub), `test/e2e/discovery-flow.test.ts`

**Interfaces:**
- README sections: Install (`npx job-applications-tracker`, `npm i -g`), First run, How discovery works (verification badges explained), How Gmail sync works (proposals, nothing changes without you), Gmail access for other agents (anchor `gmail-access-for-other-agents`: configure a Gmail MCP server for Codex or custom commands, with the exact tool names expected in `allowed_tools_sync`), Security (loopback only, no auth, what the agent is allowed to do), Data location and logs, Flags.
- e2e test: `startApp` with a temp data dir and settings `adapter_id 'custom'`, `custom_command` pointing at `node test/fixtures/fake-agent.mjs` with `FAKE_AGENT_MODE=ok` and two jobs in `FAKE_AGENT_OUTPUT` whose urls point at a local test server; `PUT /api/profile`; `POST /api/runs/discover`; poll `GET /api/runs/:id` until `succeeded`; `GET /api/jobs` has two rows with `verification_status 'ok'`; `POST /api/jobs/:id/applied`; switch the fake to a sync output proposing `interview`; `POST /api/runs/sync`; poll; `GET /api/proposals` has one; accept; `GET /api/applications/:id` status `interview` with one history row of source `proposal`.

- [ ] **Step 1: Write the e2e test and run it.** The adapter inherits `process.env` (Task 9), so the test sets `FAKE_AGENT_MODE` and `FAKE_AGENT_OUTPUT` on `process.env` before each run. Any failure is a bug in the owning module: fix it there with its own test, not in the e2e test.
- [ ] **Step 2: Run `npm test`; everything passes.**
- [ ] **Step 3: Write README.**
- [ ] **Step 4: Package check**: `npm run build && npm pack --pack-destination .tmp/`, then in an empty temp dir `npm init -y && npm i ../path/to/job-applications-tracker-0.1.0.tgz && npx jobtrack --no-open --data-dir ./data --port 0`; expect the `running at` line, `curl` health ok, Ctrl-C exits 0. Record the exact output in the commit message body.
- [ ] **Step 5: Commit** `README.md test/e2e/discovery-flow.test.ts`, message `Add README and end-to-end discovery and sync test`.

---

## Self-review notes

- Spec coverage: 5.1 layout (T1, T18), 5.2 process model (T11, T15 SSE, T16 signals via T17), 5.3 adapter (T9), 5.4 mail source (T13), 5.5 data model (T3 to T7, T11), 6.1 first run (T16, T17, T19), 6.2 discovery (T10, T12, T20), 6.3 lifecycle (T6, T15, T21), 6.4 sync and review (T7, T13, T21), 6.5 settings (T4, T21), 6.6 scheduler (T14), 7 contract (T8), 8 security (T16 loopback, T9 no shell, T10 no cookies), 9 observability (T11 logs, T15 adapter check route), 10 testing (fake agent T9, local HTTP T10, e2e T22), Decision 7 (T8 prompt, T13 error, T19 guide section, T20 failed-run link).
- Deviation from spec default recorded in Global Constraints: no `config.json`.
- Names used across tasks: `createXRepo`, `RunHandler`, `AgentAdapter`, `MailSource`, `startApp` are defined once and reused by exact name.
