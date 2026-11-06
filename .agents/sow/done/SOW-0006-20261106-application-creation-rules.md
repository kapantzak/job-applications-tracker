# SOW-0006 - Idempotent job actions and sender-domain inference for manual applications

## Status

Status: completed

Sub-state: closed.

## Requirements

### Purpose

Two product behaviours flagged in SOW-0001 reviews: (a) Save or Mark applied on a job that already has an application creates a second application (double click, or Save then Mark applied); (b) manually added applications never get `sender_domains` inferred from their URL, so Gmail sync cannot match them until the user edits the domains.

### User Request

User decision 2026-11-06: (a) make the job actions idempotent (return or advance the existing application for that job); (b) infer sender domains for manual applications from the URL exactly as job-based ones do.

### Assistant Understanding

Facts:

- `POST /api/jobs/:id/save` and `/applied` call `applicationsRepo.create` unconditionally (`src/server/api/jobs.ts`). `applications.job_id` has no unique index. `POST /api/applications` ignores the URL for `sender_domains` (`src/server/api/applications.ts`). `inferSenderDomain` lives in `src/server/db/applications-repo.ts`.

Inferences:

- "Advance" means: Save on a job that already has an application returns that application unchanged (200); Mark applied on a job whose application is `saved` sets it to `applied` with `applied_at = now` via `setStatus` (source `user`), returning 200; Mark applied on an already-applied one returns it unchanged (200). Creation stays 201.

Unknowns:

- None.

### Acceptance Criteria

- Repeated Save/Mark applied never create a second row for the same job; API tests assert row counts and status codes.
- Manual create with an `http(s)` URL stores inferred `sender_domains` unless the body supplies `sender_domains` explicitly (add it to the create schema as optional).
- UI: Jobs screen shows "Saved"/"Applied" from the server response status, so a saved job can still be marked applied; existing tests updated.

## Analysis

Sources checked: `src/server/api/jobs.ts`, `src/server/api/applications.ts`, `src/server/db/applications-repo.ts`, `src/ui/pages/JobsPage.tsx`, `test/server/api/jobs.test.ts`, `test/ui/JobsPage.test.tsx`.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Unconditional `create` in the job routes and no `job_id` lookup; manual create does not call `inferSenderDomain`.

Evidence reviewed:

- Files above; SOW-0001 final review minors 2-3 of Task 15 and item 5 of the close-out decisions.

Affected contracts and surfaces:

- `applicationsRepo.findByJobId(jobId): Application | null` (new); `POST /api/jobs/:id/save|applied` semantics (200 vs 201); `POST /api/applications` schema gains optional `sender_domains: string[]`; `JobsPage` action state; `product-v1.md`; README "How discovery works" (one sentence).

Existing patterns to reuse:

- `setStatus(id, to, source)`; `inferSenderDomain`; API harness tests.

Risk and blast radius:

- Users who intentionally created two applications for one job can no longer do so from the Jobs screen (manual add still works). Status transitions use the existing history mechanism.

Sensitive data handling plan:

- Invented data only.

Implementation plan:

1. Repo: `findByJobId`; test.
2. Routes: look up by `job_id` before create; Save returns existing (200); Mark applied advances `saved` → `applied` (200) or returns existing (200); create → 201. Tests for each path with row-count assertions.
3. Manual create: `sender_domains` optional in schema; default to `inferSenderDomain(url)` when absent and url present. Test.
4. UI: `JobsPage` marks a row from the response's `status` (`saved` → "Saved" + keep "Mark applied"; `applied` → "Applied"); test update.
5. Spec and README sentences.

Validation plan:

- `npx vitest run test/server/api/jobs.test.ts test/server/api/applications.test.ts test/ui/JobsPage.test.tsx`, then `npm test`, `npm run typecheck`, e2e still green.

Artifact impact plan:

- Spec `product-v1.md` updated; README one sentence; skills unaffected; AGENTS.md unaffected; SOW closes in the commit.

Open-source reference evidence:

- None.

Open decisions:

- None.

## Execution Log

### 2026-11-06

- Gate filled while SOW-0002 was in progress.
- Implemented test-first: new tests failed (7 RED) before the repo, route, schema and UI changes; all green after.

## Validation
Acceptance criteria evidence:

- Repeated Save/Mark applied: jobs.test.ts 'POST save twice returns the same application and creates no duplicate', 'POST applied after save advances the same application to applied', 'POST applied twice returns the existing application unchanged', 'POST save and applied leave an application in a later status unchanged' (row counts and 201/200 asserted).
- Manual create: applications.test.ts 'POST infers sender_domains from the url unless the body supplies them' (inference, ATS host, no url, explicit override, empty string and >20 rejected).
- UI: JobsPage.test.tsx 'shows Saved but keeps Mark applied, then Applied after marking the same row'; existing mark-applied test updated.

Tests or equivalent validation:

- RED before implementation: 7 new tests failed. GREEN after: `npm test` -> "Test Files  45 passed (45) / Tests  310 passed (310)"; `npm run typecheck` clean; e2e test/e2e/discovery-flow.test.ts included and green.
- Repo: applications-repo.test.ts 'findByJobId returns the newest application for a job, or null'.

Real-use evidence:

- None beyond the API harness and UI tests (no live browser run).

Reviewer findings:

- Independent review 2026-11-06: one Important (FK-off repository test, fixed in the follow-up commit by inserting real run/job parent rows); minors: two-call advance (made transactional), 'Applied' label for statuses past applied (SOW-0005).

Same-failure scan:

- `grep -rn "applicationsRepo.create" src/server/api` shows only jobs.ts (guarded by findByJobId) and applications.ts (manual create). Proposal accept path does not create applications.

Sensitive data gate:

- invented data only; nothing sensitive expected.

Artifact maintenance gate:

- AGENTS.md: unaffected.
- Runtime project skills: unaffected.
- Specs: product-v1.md updated.
- End-user/operator docs: README updated.
- End-user/operator skills: none exist.
- SOW lifecycle: closed and moved to done in the implementing commit.

Specs update:

- product-v1.md Status pipeline: idempotent job actions and manual sender-domain inference.

Project skills update:

- None needed.

End-user/operator docs update:

- README "How discovery works": one sentence on duplicate-free Save/Mark applied.

End-user/operator skills update:

- none exist.

Lessons:

- Idempotency belongs in the route layer lookup until a unique index on job_id is justified (existing databases may hold duplicates).

Follow-up mapping:

- None.

## Outcome

Save and Mark applied are idempotent per job (200 for existing, 201 for new; saved advances to applied with applied_at set and a user history row). Manual applications infer sender_domains from their URL unless supplied. The Jobs screen derives Saved/Applied from the response status.

## Lessons Extracted

- Without a DB uniqueness guarantee, `findByJobId` returns the newest row so legacy duplicates behave deterministically.

## Followup

None yet.

## Regression Log

None yet.
