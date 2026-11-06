# SOW-0009 - Jobs page shows persisted application state

## Status

Status: open

Sub-state: gate filled; starts when SOW-0008 closes (one SOW at a time).

## Requirements

### Purpose

After Save or Mark applied, the Jobs page must keep showing the job's application state across reloads and navigation, from the database rather than React state.

### User Request

"When marking a job as applied, the state is not persisted." Investigation showed the application row is stored and listed on the Applications page; only the Jobs page badge is lost. User chose option A: the jobs list API returns the application status per job (2026-11-06).

### Assistant Understanding

Facts:

- `src/ui/pages/JobsPage.tsx:22` keeps `done: Record<jobId, ApplicationStatus>` in local state, filled only by the Save/Mark applied handlers (lines 126, 136). A reload empties it.
- `src/server/db/jobs-repo.ts:53` `list()` selects from `jobs` only; `Job` (`src/server/domain/types.ts:67`) has no application field. The UI imports the same `Job` type via `src/ui/api/client.ts:11`.
- `applications.job_id` links to jobs; `applicationsRepo.findByJobId` picks the latest application per job (`applications-repo.ts:115`). Save/applied are idempotent per job (`jobs.ts`, SOW-0006), so at most one live application per job is the expected shape, but the schema does not enforce uniqueness.
- SOW-0005 lines 20 and 23 list this defect and the related "show the real status, not Applied" item.
- Verified on the user's running server: one `applied` application exists for a discovered job; `GET /api/jobs` returns no application info.

Inferences:

- A left join on the latest application per job in `list()` is enough; `get()` and `insertMany()` keep the bare `Job` shape.

Unknowns:

- None blocking.

### Acceptance Criteria

- `GET /api/jobs` items carry `application_status: ApplicationStatus | null` (latest application for the job, or null). Verified by `test/server/api/jobs.test.ts` (after POST applied, the GET item shows `applied`; untouched jobs show `null`).
- Jobs page renders the badge from that field on load and after a click, with no local `done` map; badge text shows the real status (Saved, Applied, Screening, Interview, Offer, Rejected, No response). Save hidden when an application exists; Mark applied shown when none or `saved`. Verified by `test/ui/JobsPage.test.tsx`.
- Reload keeps the badge: real-use check on a dev data dir (mark applied, reload, badge still there).
- `npm test`, `npm run typecheck`, `npm run build` pass.

## Analysis

Sources checked:

- `src/ui/pages/JobsPage.tsx`, `src/ui/api/client.ts`, `src/server/api/jobs.ts`, `src/server/db/jobs-repo.ts`, `src/server/db/applications-repo.ts`, `src/server/domain/types.ts`, `test/server/api/jobs.test.ts`, `test/ui/JobsPage.test.tsx`, `.agents/sow/pending/SOW-0005-…` lines 20, 23, `.agents/sow/specs/product-v1.md` line 31, the user's data dir (counts only).

Current state:

- Persisted correctly; displayed only until the page unmounts.

Risks:

- The join must pick one application per job deterministically (latest by `created_at`, rowid tiebreak) or rows would duplicate.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The badge is derived from transient UI state because the list endpoint has no application data. Evidence above.

Evidence reviewed:

- As listed. No open-source references needed.

Affected contracts and surfaces:

- `GET /api/jobs` response shape (additive field), `JobListItem` type exported from `src/server/domain/types.ts` and used by the UI client, `jobs-repo.list`, `JobsPage`, tests for API and page, `product-v1.md` (jobs list contract), SOW-0005 (strike lines 20 and 23).

Existing patterns to reuse:

- `applicationsRepo.findByJobId` ordering (`created_at DESC, rowid DESC`); API harness tests in `test/server/api/`; `vi.mock` client pattern in `test/ui/JobsPage.test.tsx`; `VerificationBadge` as the badge style.

Risk and blast radius:

- Additive API field; no migration. UI change confined to the Jobs page. Dashboard and Applications pages untouched.

Sensitive data handling plan:

- No sensitive data; tests use invented companies.

Implementation plan:

1. RED: API test for `application_status` on GET; page test for badge from list field and for post-click update; remove reliance on `done`.
2. GREEN: `JobListItem` type; `list()` with a correlated subquery for the latest application status; `JobsPage` derives from the field and patches the row from the POST response.
3. Spec line for the jobs list contract; strike SOW-0005 items 20 and 23 as done here.
4. `npm test`, typecheck, build; real-use reload check.

Validation plan:

- Tests above; full suite; manual reload on a dev data dir; same-failure search for other pages deriving persisted state from local state (`useState<Record<` in `src/ui/pages`).

Artifact impact plan:

- AGENTS.md: unaffected.
- Runtime project skills: `project-local-api` only if the route contract conventions change (not expected); `project-testing` unaffected.
- Specs: `product-v1.md` jobs list contract.
- End-user/operator docs: README unaffected (behaviour becomes what the README already implies).
- End-user/operator skills: none exist.
- SOW lifecycle: SOW-0005 items 20 and 23 moved here; close with the work in one commit.

Open-source reference evidence:

- None.

Open decisions:

- Resolved: option A (user, 2026-11-06).

## Implications And Decisions

1. Source of the badge state: A (server returns `application_status` per job) selected; B (page fetches applications list too) and C (browser storage) rejected.

## Plan

See Implementation plan.

## Execution Log

Not started.

## Validation

Pending.

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

None yet.

## Regression Log

None yet.
