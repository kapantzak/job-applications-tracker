# SOW-0014 - Multiple search profiles

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered, validated and committed with the work (2026-11-07).

## Requirements

### Purpose

Let one user keep several job-search profiles in the same app, each with its own jobs, applications, proposals and runs, while agent and app settings stay shared (GitHub issue #4).

### User Request

"Refactor the app so that it can handle multiple search profiles. Each profile should preserve its own jobs, applications, etc. Settings can be shared for now. Initially, users will see a screen with all available profiles. If no profile available, we should show the profile form and ask users to fill the fields. Users should be able to delete profiles and all their connected data (after confirmation)."

### Assistant Understanding

Facts:

- The schema allows one profile row: `src/server/db/migrations.ts:10` (`id INTEGER PRIMARY KEY CHECK (id = 1)`).
- `jobs`, `applications` and `runs` carry no owner; `proposals` and `status_history` hang off applications and runs (`migrations.ts:42,66,81,82,96`).
- Job dedupe is global: `migrations.ts:61` (`UNIQUE (dedupe_key)`).
- Discovery and the discover route read the single profile: `src/server/services/discovery.ts:59`, `src/server/api/runs.ts:59`.
- Mail sync and the scheduler are global: `src/server/services/mail-sync.ts:19,37`, `src/server/runs/scheduler.ts:38`.
- The queue keeps one active run per kind: `src/server/runs/queue.ts:175`, `src/server/db/runs-repo.ts:49`.
- The UI redirects to `/profile` when there is no profile: `src/ui/App.tsx:17-26`.
- No foreign key cascades; deletion must be ordered explicitly.
- SQLite cannot `ALTER TABLE ADD COLUMN` a `NOT NULL` column with a `REFERENCES` clause; enforcing ownership in the schema needs a table rebuild with foreign keys off (SQLite "Making Other Kinds Of Table Schema Changes" procedure).

Inferences:

- Profile ids should be UUID strings like every other entity id, so the integer `id = 1` row is replaced, not extended.

Unknowns:

- None blocking.

### Acceptance Criteria

- Several profiles can be created, edited and listed; each name is required and unique ignoring ASCII case. Verified by repository and API tests.
- Jobs, applications, proposals and runs are stored per profile and every profile-owned route returns 404 for an entity of another profile. Verified by API tests.
- The same posting can be stored in two profiles; discovery hands the agent only its own profile's known URLs. Verified by repo and discovery tests.
- Mail sync runs per profile over that profile's open applications and reviewed message ids; the scheduler queues one sync per profile with open applications. Verified by service and scheduler tests.
- Deleting a profile removes its runs, jobs, applications, proposals, status history and run log folders; it is refused with 409 while one of its runs is queued or running. Verified by API tests.
- Existing single-profile databases migrate: the old profile becomes the first profile and owns all existing rows; orphan data without a profile gets a profile named "Default". Verified by migration tests on a populated v2 database.
- The UI opens on a profiles screen; with no profiles it shows the profile form; profile pages live under `/profiles/:id/...`; deletion asks for confirmation and shows what will be removed. Verified by UI tests and a manual run of the built app.

## Analysis

Sources checked:

- `src/server/db/*`, `src/server/domain/types.ts`, `src/server/api/*`, `src/server/app.ts`, `src/server/index.ts`, `src/server/services/*`, `src/server/runs/*`, `src/ui/App.tsx`, `src/ui/components/Layout.tsx`, `src/ui/api/client.ts`, `src/ui/pages/*`, `test/server/api/harness.ts`, `.agents/sow/specs/product-v1.md`, `README.md`, `.agents/sow/pending/SOW-0005-*`.

Current state:

- Single-profile design throughout; see Facts.

Risks:

- Migration rewrites user data (three table rebuilds); a mistake could lose rows or mix owners.
- Broad, mechanical change to every API route, client function, page and test.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The product was designed for one profile (design doc, `profile` single row). Ownership of jobs, applications and runs is implicit, so there is nothing to partition by. Adding an explicit `profile_id` owner on `runs`, `jobs` and `applications` (proposals and history inherit through their application) and scoping every query and route by it gives each profile its own data.

Evidence reviewed:

- Code listed under Analysis; GitHub issue #4 (title "Multiple profiles", no comments); SOW-0005 backlog (no overlap: it mentions the profile GET/PUT `created_at` round-trip, which this SOW resolves for the new routes by keeping `created_at` read-only and accepting only the input keys); SOW-0012 (cancel semantics reused for the delete refusal).

Affected contracts and surfaces:

- Schema (migration 3), all repositories, domain types (`Profile.id`, `Profile.name`, `profile_id` on `Run`, `Job`, `Application`).
- HTTP API: `/api/profile` replaced by `/api/profiles` (list, create, get, update, delete) and profile-scoped `/api/profiles/:pid/{jobs,applications,proposals,runs}`; `/api/settings`, `/api/setup/*`, `/api/health` and `DELETE /api/runs/logs` stay global.
- Run queue (`enqueue(kind, profileId)`), scheduler, discovery and mail-sync handlers.
- UI routes, sidebar, client, every page that links or fetches.
- Tests across server, UI and e2e; spec, README, project skills.

Existing patterns to reuse:

- Migration runner in `src/server/db/connection.ts`; repository factories; `HttpError` and `readJson`; zod strict bodies; AlertDialog confirmation from `src/ui/components/DataSection.tsx`; `requireX` 404 helpers in routers; `logStore.purge`-style directory removal in `src/server/runs/log-store.ts`.

Risk and blast radius:

- Data loss in migration: mitigated by running it in one transaction, checking `PRAGMA foreign_key_check` before commit, and tests on a populated v2 database (row counts, ownership, FK integrity, index presence).
- Cross-profile leaks: mitigated by ownership checks in every item route and tests that request another profile's ids.
- Queue fairness: one global queue still runs one agent at a time; per-profile dedupe means two profiles can each have one discovery queued.
- Deleting during a run: refused (409) so a handler never writes into a deleted profile.
- No security surface change: loopback binding, guard and validation unchanged; new state-changing routes sit under `/api` and the guard.

Sensitive data handling plan:

- Tests and docs use invented profiles, companies and message ids only. No real run logs or mailbox content are read or copied.

Implementation plan:

1. Schema and migration runner: migration 3 as a JS step with foreign keys off (profiles table, rebuild runs/jobs/applications with `profile_id NOT NULL REFERENCES profiles(id)`, per-profile dedupe index, backfill, drop old `profile`). Files: `src/server/db/migrations.ts`, `connection.ts`.
2. Repositories and domain types: profiles repo (list with counts, create, update, delete with ordered cascade, name check), scoped jobs/applications/proposals/runs queries. Files: `src/server/db/*`, `src/server/domain/types.ts`.
3. Queue, scheduler, handlers: `enqueue(kind, profileId)`, per-profile active check, scheduler enqueues per profile with open applications, handlers read `ctx.run.profile_id`.
4. API: profiles router, profile-scoped mount with a 404 profile middleware, ownership checks, delete with log-folder removal; global logs purge router. Files: `src/server/api/*`, `src/server/app.ts`, `src/server/index.ts`, `src/server/runs/log-store.ts`.
5. UI: client functions take a profile id; profiles screen (list, empty-state form, delete dialog); profile form create/edit; routes under `/profiles/:pid`; sidebar per context; catch-all redirect to `/`. Files: `src/ui/**`.
6. Tests, docs, spec, skills.

Validation plan:

- `npm test`, `npm run typecheck`, `npm run build`; migration tests on a populated v2 db; API ownership and delete tests; UI tests for the profiles screen, empty state and delete confirmation (including Cancel); e2e discovery flow through the profile-scoped routes; manual sandbox run of the built app with two profiles and a delete; independent code review pass.

Artifact impact plan:

- AGENTS.md: likely unaffected (workflow unchanged); re-check at close.
- Runtime project skills: `project-local-api` (profile-scoped routes, delete 409) and `project-testing` (harness creates a profile, migration runner foreign-keys-off steps).
- Specs: `.agents/sow/specs/product-v1.md` (data model, API, UI, scheduler).
- End-user/operator docs: `README.md` (profiles screen, per-profile data, delete).
- End-user/operator skills: none exist (AGENTS.md lists none).
- SOW lifecycle: single SOW; close as completed in `done/` with the work.

Open-source reference evidence:

- None checked; the change is internal to this codebase. SQLite table-rebuild behaviour follows the SQLite documentation ("ALTER TABLE", section "Making Other Kinds Of Table Schema Changes").

Open decisions:

- All resolved; see Implications And Decisions.

## Implications And Decisions

User answered "All recommended" on 2026-11-07.

1. Mail sync: **A** - one sync per profile over that profile's open applications; the scheduler queues one per profile with open applications.
2. API shape: **A** - every profile-owned route nested under `/api/profiles/:pid`; a mismatched profile returns 404. Settings, setup, health and logs purge stay global.
3. UI routing: **A** - profile id in the URL (`/profiles/:pid/...`); `/` is the profiles screen; `/settings` and `/setup` global.
4. Migration: **A** - the existing profile becomes the first profile, named after its first target role (fallback "Default"), and owns all existing rows; orphan data without a profile gets a "Default" profile.
5. Profile name: **A** - new required `name`, unique ignoring ASCII case.
6. Delete with active runs: **A** - refused with 409 until the profile's runs are cancelled or finished.
7. Delete confirmation: **A** - AlertDialog listing what will be removed (jobs, applications, runs).
8. Dedupe: **A** - per profile; known URLs per profile.
9. Migration mechanics: **A** - table rebuild with `profile_id NOT NULL` and a real foreign key; the runner gains a foreign-keys-off mode.

Assistant defaults presented and not objected to:

- One global run queue (one agent at a time across profiles); "already active" is per profile and kind.
- Sidebar: profiles screen shows Profiles and Settings; inside a profile it shows the profile name, Switch profile, and the profile pages; the Review badge counts that profile only.
- The agent never sees the profile name; prompts unchanged, no prompt version bump.
- No profile duplication.

## Plan

See Pre-Implementation Gate, Implementation plan.

## Execution Log

### 2026-11-07

- SOW created; baseline `npm test`: 444 passed.
- Chunk 1: migration 3 (`src/server/db/migrations.ts`, JS `up` step with `foreignKeysOff`) and the runner mode in `src/server/db/connection.ts` (foreign keys off outside the transaction, `foreign_key_check` before commit, previous setting restored in `finally`). Added `idx_applications_job_id` while rebuilding `applications` (the delete cascade and `findByJobId` filter on it).
- Chunk 2: `src/server/db/profile-repo.ts` renamed to `profiles-repo.ts` (list with counts, get, create, update, `nameTaken`, transactional `remove` returning run ids); jobs, applications, proposals and runs repos take a profile id; `runsRepo.listActiveIds()` replaces the raw SQL in the logs purge route (one SOW-0005 server item, now done).
- Chunk 3: `queue.enqueue(kind, profileId)`, scheduler `syncProfileIds()` (one enqueue per profile, one failure does not block the others), discovery and mail sync read `ctx.run.profile_id`.
- Chunk 4: `src/server/api/profile.ts` renamed to `profiles.ts` (profiles CRUD + scoped mount with a 404 middleware); jobs/applications/proposals/runs routers check ownership; `createRunLogsRouter` keeps `DELETE /api/runs/logs` global; `logStore.remove(runIds)`; the `Profile is not set` 422 mapping in `errors.ts` removed (no caller left).
- Chunk 5: UI client takes a profile id on every profile-owned call; `src/ui/profile-route.ts` (`useProfileId`, `profilePath`, `ProfileShellContext`); `ProfileForm` extracted; `ProfilesPage`/`NewProfilePage`; `ProfilePage` edits by id; routes under `/profiles/:profileId`, catch-all to `/`; sidebar per context; JobsPage "fill in your profile" prompt removed (a run always has a profile now).
- Chunk 6: tests (`test/server/api/profile.test.ts` → `profiles.test.ts`, `test/server/db/profile-repo.test.ts` → `profiles-repo.test.ts`, new `test/server/db/test-profile.ts`, `test/ui/ProfilesPage.test.tsx`), spec, README, project skills.
- File renames done with `git mv` as part of the approved replacement of `/api/profile`; no other files removed.
- Independent review (fresh reviewer, diff only, 2026-11-07): no high findings. Handled:
  1. Medium, confirmed: with the agent missing, `/` always redirected to Setup and every Profiles link bounced back. Fixed: the Setup check in `StartupRedirect` runs once per page load (`src/ui/App.tsx`), covered by `test/ui/App.test.tsx`. This keeps the agreed rule (startup sends a missing agent to Setup) without trapping the user.
  2. Low, confirmed: a profile deleted while a request awaited (agent check, JSON body) gave 500 through the FK error or a plain Error. Fixed: `ProfileNotFoundError` mapped to 404 in `errors.ts`, and `requireProfileStill()` re-checks right before the synchronous write in run start and application create. Tests in `runs.test.ts`, `profiles.test.ts`, `profiles-repo.test.ts`.
  3. Low, confirmed: the production scheduler filter was untested. Fixed: `applicationsRepo.profileIdsWithOpen()` (one SQL query, same open rule as the Applications filter) used by `index.ts` and the harness, tested in `applications-repo.test.ts`.
  4. Low: pages kept the previous profile's rows (and RunsPage kept polling it) when the URL switched straight from one profile to another. Fixed: `ProfileScope` keys the profile outlet by id so pages remount.
  5. Low: the sidebar showed the previous profile's name briefly. Fixed: name and count reset when the profile id changes.
  6. Rejected: "pre-existing broken references would block migration 3". `openDatabase` has enabled foreign keys since migration 1, so such rows cannot exist; if they did, failing loudly and leaving the data untouched is the safe outcome.
  7. Fixed: duplicate `/:pid` middleware removed (Hono's `/:pid/*` also matches `/:pid`; the unknown-profile tests for GET/PUT/DELETE still pass).

## Validation

Acceptance criteria evidence:

- Profiles create/edit/list with unique names: `test/server/db/profiles-repo.test.ts`, `test/server/api/profiles.test.ts` (409 ignoring case, trimmed names, own name in another case allowed).
- Per-profile data and 404 across profiles: `test/server/api/profiles.test.ts` (unknown profile on every collection), `runs.test.ts` ("another profile's run is 404 on every run route", including cancel), `jobs-repo` and `proposals-repo` isolation tests.
- Same posting in two profiles, per-profile known URLs: `jobs-repo.test.ts` (per-profile dedupe), `discovery.test.ts` (prompt carries only the run's profile and its URLs, never the profile name).
- Per-profile sync and scheduler: `mail-sync.test.ts` (only the run's open applications and reviewed ids; findings for another profile dropped), `scheduler.test.ts`, `applications-repo.test.ts` (`profileIdsWithOpen`).
- Delete: `profiles.test.ts` removes rows and run logs and leaves the other profile untouched; 409 while queued or running; not blocked by another profile's run; `guard.test.ts` foreign Origin cannot delete.
- Migration: `migrations.test.ts` on a populated version-2 database (ownership, field copy, row order, indexes, FK integrity, `foreign_keys` restored), Default profile for orphan data, empty database, rollback on a dangling reference.
- UI: `test/ui/ProfilesPage.test.tsx` (list, empty state form, create, delete confirm/cancel/refusal), `ProfilePage.test.tsx`, `Layout.test.tsx`, `App.test.tsx`.

Tests or equivalent validation:

- `npm test`: `Test Files  51 passed (51)`, `Tests  500 passed (500)`; no warnings or `act(...)` lines in the output (baseline before the SOW: 444).
- `npm run typecheck` clean; `--noUnusedLocals` clean apart from the pre-existing unused `Job` import in `src/ui/api/client.ts` (SOW-0005 item).
- `npm run build` succeeds.

Real-use evidence:

- Built app (`node bin/jobtrack.js --no-open --port 0 --data-dir .tmp/mp-real`) on a file database created with migrations 1 and 2 and invented rows: migration 3 produced one profile named "Platform Engineer" owning 2 jobs, 1 application, 1 run; a case-variant name was refused with 409; another profile's job returned 404 on save; `/api/profile` is 404; deleting the profile returned 204 and removed its run log; SPA routes `/`, `/profiles/new`, `/profiles/<id>`, `/profiles/<id>/jobs` and the old `/jobs` all served the app.
- Browser (same server): profiles screen with two cards and counts; a profile dashboard with the profile sidebar (name, pages, Switch profile, Settings); the delete dialog text; deleting both profiles left the "Create your first profile" form; no console errors.
- The end-to-end test now runs discovery, sync and proposal accept through the profile routes and then deletes the profile and checks its run logs are gone.

Reviewer findings:

- See Execution Log, independent review: 1 medium and 4 low fixed, 1 rejected with reason, 1 cleanup.

Same-failure scan:

- `grep -rn "FROM (jobs|applications|runs|proposals)" src/server`: every remaining unscoped query is a lookup by id (routes check the owner), the global queue (`nextQueued`, `markInterrupted`, `listActiveIds`), or keyed by an owned id (`findByJobId`, `hasPending`).
- No `/api/` path outside `src/ui/api/client.ts`; no old `to="/jobs"`-style links; `grep -rn "0.0.0.0\|shell: true" src bin` returns nothing.

Sensitive data gate:

- Fixtures, the sandbox database and docs use invented profiles, companies (`Acme`, `Globex`, `Initech`, `Hooli`, `Umbrella`), `example` hosts and message ids like `msg-001`. The real data directory was not read. No secrets, personal data or run logs in any artifact.

Artifact maintenance gate:

- AGENTS.md: no update; it states workflow and v1 goals ("fills a profile" stays true), not the data model.
- Runtime project skills: updated `.agents/skills/project-local-api/SKILL.md` (profile-scoped mount, ownership 404, delete 409, error map), `.agents/skills/project-testing/SKILL.md` (`insertTestProfile`, harness `h.profile`/`h.base`, `foreignKeysOff` migrations, profile routes in UI tests), `.agents/skills/project-agent-adapter/SKILL.md` (handlers work on the run's profile; profile name never in prompts).
- Specs: `.agents/sow/specs/product-v1.md` (new Profiles section, routes, dedupe, runs, scheduler, UI routes and sidebar, delete confirmation).
- End-user/operator docs: `README.md` (first run, new Profiles section, dedupe and sync per profile, data file contents).
- End-user/operator skills: none exist (AGENTS.md lists none).
- SOW lifecycle: status `completed`, file moved to `.agents/sow/done/`, committed with the work. SOW-0005 updated (logs purge item done here; profile round-trip item re-pointed to the new routes).

Specs update:

- `.agents/sow/specs/product-v1.md` updated as listed. The design document under `docs/superpowers/` is the historical v1 narrative; the deviation (multiple profiles) is recorded here and in the spec.

Project skills update:

- Three runtime skills updated as listed above.

End-user/operator docs update:

- `README.md` updated as listed above.

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- A route that becomes the app's hub must not carry a redirect that runs on every visit; the old root guard was harmless only because other pages stayed reachable from the sidebar.
- Handlers that `await` before writing need a re-check of their parent row right before the synchronous write; a foreign key turns the race into a 500 rather than bad data.
- Filters wired inline in the bootstrap (`index.ts`) escape tests; put them in a repository method.

Follow-up mapping:

- Implemented: everything in the acceptance criteria and all confirmed review findings.
- Rejected: review item 6 (reason above).
- Tracked: SOW-0005 keeps the profile GET/PUT round-trip item (PUT still rejects the `id` and `created_at` that GET returns; the UI strips them) and the unused `Job` import.

## Outcome

Multiple search profiles shipped: the app opens on a profiles screen (or the profile form when there is none), each profile owns its jobs, applications, proposals and runs, settings are shared, and a profile can be deleted with all its data after confirmation. Existing single-profile databases migrate into the first profile.

## Lessons Extracted

See Validation, Lessons. Recorded in the project skills where they change how work is done here (`project-local-api`: ownership checks and delete 409; `project-testing`: migration and profile-route test patterns).

## Followup

- SOW-0005 (pending): profile GET/PUT round-trip; unused `Job` import in the UI client.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
