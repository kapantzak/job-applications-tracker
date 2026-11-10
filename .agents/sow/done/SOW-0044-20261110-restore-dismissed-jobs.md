# SOW-0044 - Restore dismissed jobs

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: implemented, validated and committed with the work on 2026-11-10 on branch `Fixes-1`; the user asked for a PR.

## Requirements

### Purpose

Let the user undo a dismiss. Today a dismissed job can be shown again but never brought back into the list.

### User Request

"When I click dismiss on a job, the row still has the dismiss action. How to revoke dismiss action?" After the analysis the user chose option 1B: show "Restore" instead of Dismiss on dismissed rows, backed by a new restore route.

### Assistant Understanding

Facts:

- `POST /api/profiles/:pid/jobs/:id/dismiss` is the only route that changes `jobs.dismissed_at` (`src/server/api/jobs.ts:65-68`); it sets the current time (`src/server/db/jobs-repo.ts:59,130-132`). Nothing clears it.
- The Jobs page renders the Dismiss button and its confirmation on every row, dismissed or not (`src/ui/pages/JobsPage.tsx:382-406`); the UI never reads `dismissed_at`, although `JobListItem` carries it (`src/server/domain/types.ts:234`, `jobs-repo.ts` `SELECT j.*`).
- The dismiss dialog says "Turn on Show dismissed to see it again" (`JobsPage.tsx:393-395`).
- SOW-0005 backlog line 22 lists "Hide 'Dismiss' on already dismissed rows" together with an unrelated loading fix.
- A dismissed job found again by a later search stays dismissed (spec `product-v1.md:101`, `test/server/services/discovery.test.ts:291`). This SOW does not change that.
- The mock sandbox seed already contains a dismissed job (`test/server/sandbox-mock/seed.test.ts:109-116`), so the flow can be checked with `npm run sandbox:mock` without a seed change.

Inferences:

- Restoring is reversible (the user can dismiss again), so it is not a destructive action under spec `product-v1.md:144`.

Unknowns:

- None; decisions 1-4 are recorded.

### Acceptance Criteria

- `POST /api/profiles/:pid/jobs/:id/restore` clears `dismissed_at` and answers 204; 404 for an unknown id and for another profile's job; a job that is not dismissed stays not dismissed (204). Verified by `test/server/api/jobs.test.ts` and `test/server/db/jobs-repo.test.ts`.
- With Show dismissed on, a dismissed row shows a "Dismissed" badge and a Restore button and no Dismiss; clicking Restore calls the client at once (no confirmation) and reloads the list. Save and Mark applied are unchanged. Verified by `test/ui/JobsPage.test.tsx`.
- Non-dismissed rows keep Dismiss with its confirmation unchanged (existing tests stay green).
- `restoreJob` client function sends `POST .../restore`. Verified by `test/ui/client.test.ts`.
- Spec, README and the SOW-0005 backlog line reflect the new behaviour.

## Analysis

Sources checked:

- `src/server/api/jobs.ts`, `src/server/db/jobs-repo.ts`, `src/server/domain/types.ts`
- `src/ui/pages/JobsPage.tsx`, `src/ui/api/client.ts`, `src/ui/help-text.ts`
- `test/server/api/jobs.test.ts`, `test/server/db/jobs-repo.test.ts`, `test/ui/JobsPage.test.tsx`, `test/ui/client.test.ts`, `test/server/sandbox-mock/seed.test.ts`
- `.agents/sow/specs/product-v1.md` (lines 27, 91-92, 101, 142, 144), `README.md:290`, design doc section on the Jobs screen
- `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md:22`

Current state:

- One-way dismiss; Dismiss button on dismissed rows is a no-op that only re-stamps `dismissed_at`.

Risks:

- Low. One new state-changing route under the existing guard and profile scoping; one repository statement; one conditional in a table row.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Dismiss was designed one-way (design doc lists only "Dismiss" per row) and the row actions never branch on `dismissed_at`. Evidence: `jobs-repo.ts:130-132`, `JobsPage.tsx:382-406`.

Evidence reviewed:

- Files listed under Analysis. No external or open-source references are relevant.

Affected contracts and surfaces:

- HTTP API: new `POST /api/profiles/:pid/jobs/:id/restore` (204, no body).
- Repository: `jobsRepo.restore(id)`.
- UI client: `restoreJob(profileId, id)`.
- Jobs page row actions and dismiss dialog text.
- Spec `product-v1.md`, `README.md` Interface section, SOW-0005 backlog line 22.

Existing patterns to reuse:

- `requireJob` ownership check and the dismiss route shape (`jobs.ts:15-20,65-68`).
- `run(..., () => setReloadTick(...))` reload after an action (`JobsPage.tsx:401`).
- Existing `Badge`/`Button` shadcn components; dismiss tests as the template for the new tests.

Risk and blast radius:

- Security: the route sits under `/api`, so the Host/Origin guard applies; no body, so no content-type concern. Ownership checked through `requireJob`.
- Data: only `dismissed_at` of one row changes; no migration.
- Compatibility: additive route; existing clients unaffected.

Sensitive data handling plan:

- No secrets or personal data involved. Tests use the existing invented fixtures (Acme, example.com).

Implementation plan:

1. Server: `restore` in `jobs-repo.ts` (`UPDATE jobs SET dismissed_at = NULL WHERE id = ?`), route in `jobs.ts`; tests in `jobs-repo.test.ts` and `jobs.test.ts` (204 and cleared, 404 unknown, 404 other profile, no-op when not dismissed).
2. Client: `restoreJob` in `client.ts`; test in `client.test.ts`.
3. UI: branch the row actions on `job.dismissed_at` (decisions 2A, 3A); update dialog text (decision 4A); tests in `JobsPage.test.tsx`.
4. Docs: spec, README, SOW-0005 line 22.

Validation plan:

- Write failing tests first, then implement.
- `npm test` and `npm run typecheck`, summary lines recorded here.
- Manual check with `npm run sandbox:mock`: turn on Show dismissed, restore the seeded dismissed job, turn Show dismissed off, job still listed.
- `grep -rn "0.0.0.0" src bin` returns nothing.
- Same-failure search: other one-way actions with no undo in the UI (`grep -rn "dismiss\|archive\|hide" src/ui src/server/api`).

Artifact impact plan:

- AGENTS.md: no change expected; no workflow or command changes.
- Runtime project skills: `project-local-api` Update Rules require an entry for a new state-changing route; add one for the job actions.
- Specs: `product-v1.md` gains the restore route and row behaviour.
- End-user/operator docs: `README.md` Interface section mentions restore.
- End-user/operator skills: none exist (AGENTS.md: "Output/reference skills: none").
- SOW lifecycle: SOW-0005 line 22 first half marked done in SOW-0044; the loading half stays in SOW-0005.

Open-source reference evidence:

- None checked; the change is local application logic.

Open decisions:

- All resolved: 1B, 2A, 3A, 4A (see Implications And Decisions).

## Implications And Decisions

1. How dismissed jobs behave. Options: A hide Dismiss only; B Restore instead of Dismiss with a new route; C B plus an Undo notice. **User selected B (2026-11-10).**
2. Restore confirmation. Options: A restore on click; B confirmation dialog. **User selected A (2026-11-10):** restoring is reversible, and spec `product-v1.md:144` confirms only destructive actions.
3. Dismissed row look. Options: A grey "Dismissed" badge, Save and Mark applied unchanged; B Restore only; C badge and hide Save and Mark applied. **User selected A (2026-11-10).**
4. Dismiss dialog wording. Options: A "…Turn on Show dismissed to see or restore it."; B keep. **User selected A (2026-11-10).**

## Plan

See Implementation plan in the gate.

## Execution Log

### 2026-11-10

- Analysis done; SOW created; decision 1B recorded.
- Decisions 2A, 3A, 4A recorded; SOW moved to `current/`, status in-progress.
- Failing tests written first (server: 5 failing; UI and client: 4 failing), then `jobsRepo.restore`, the route, `restoreJob` and the row branch implemented; all green.
- Design deviation recorded: the design doc lists only "Dismiss" per Jobs row; Restore extends it by user decision 1B.
- Reviewer findings handled (see Validation); help text and `project-local-api` skill updated.
- User asked to open a PR; SOW completed and moved to `done/` in the same commit as the work.

## Validation

Acceptance criteria evidence:

- Restore route: `test/server/api/jobs.test.ts` ("POST restore is 204 and shows a dismissed job again", "POST restore on a job that is not dismissed is 204 and changes nothing", "POST dismiss/restore on another profile's job is 404 and leaves it alone", unknown id 404 for `restore`). Repository: `test/server/db/jobs-repo.test.ts` ("restores a dismissed job, and restore of an unknown id is a no-op").
- Client: `test/ui/client.test.ts` ("restoreJob posts to the restore route and returns undefined on 204").
- Jobs page: `test/ui/JobsPage.test.tsx` ("shows a dismissed job with a Dismissed badge and Restore instead of Dismiss", "restores a dismissed job without confirmation and reloads the list", "says in the dismiss confirmation that the job can be restored"); the existing dismiss tests stay green.

Tests or equivalent validation:

- `npm test`: `Test Files  77 passed (77)`, `Tests  1188 passed (1188)`; no warnings, no `act(...)` messages.
- `npm run typecheck`: exit 0. `npm run build`: built.
- `grep -rnF "0.0.0.0" src bin`: no output.

Real-use evidence:

- `npm run sandbox:mock -- --no-open --port 0` (server stopped afterwards by its own PIDs). API: restoring the seeded dismissed job answered 204 and the default list grew from 12 to 13 jobs; the same route with a foreign `Origin` answered 403; dismissing again answered 204.
- Browser (Frontend Platform profile, Show dismissed on): the seeded dismissed row showed a grey "Dismissed" badge and Restore, with Save and Mark applied unchanged; clicking Restore opened no dialog and the row came back with Dismiss.

Reviewer findings and handling (independent review of the diff):

- No bugs, no ownership or guard gaps; the tests were judged non-vacuous and not racy.
- should-fix: `project-local-api` Update Rules require an entry for a new state-changing route. Fixed: job-actions bullet added.
- nit: `FIELD_HELP.showDismissed` did not mention Restore. Fixed: "Jobs you dismissed are hidden. Tick to show them again; each one has a Restore button."
- nit: SOW close-out sections pending. Fixed here.

Same-failure search:

- `grep -rn "router.post\|router.delete" src/server/api/*.ts` and `UPDATE ... _at` statements in `src/server/db/*.ts`: jobs were the only one-way hide without an undo. Application status is already user-editable (`POST /applications/:id/status`). Proposal accept/reject is final by product design (no status change without the user confirming a proposal), a different contract, so it was not changed.
- `dismissed_at` is read only in `jobs-repo.ts` (list filter) and `JobsPage.tsx` (row branch); the Dashboard, application details and table-view filters do not use it.

Sensitive data gate:

- Durable artifacts and tests use only invented data (Acme, Globex, `acme.test`, seeded mock companies). No secrets, personal data, run logs or private endpoints were written.

Artifact maintenance gate:

- AGENTS.md: unchanged; no workflow, command or guardrail changed.
- Runtime project skills: `project-local-api` gains the job-actions bullet (reviewer finding). `project-testing` unchanged: the new tests follow its existing rules (harness, portal dialogs, `vi.spyOn(globalThis, 'fetch')`). `project-agent-adapter` unaffected: no agent, prompt or task change.
- Specs: `product-v1.md` gains the "Dismiss and restore (SOW-0044)" bullet.
- End-user/operator docs: `README.md` Interface section gains the restore line; in-app help `FIELD_HELP.showDismissed` updated. README screenshots: `docs/images/jobs.png` was checked; Show dismissed is unticked and the Actions column is cut off at 1440 px, so no dismissed row or Restore button could appear and no re-take is needed.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: SOW-0005 line 22 split; its Dismiss half marked "Done in SOW-0044", the loading half stays open there.

Spec update: done (above). Project skill update: done (above). End-user docs: done (above). End-user skills: none exist.

Lessons: see below. Follow-up mapping: see below.

## Outcome

A dismissed job can be brought back: with Show dismissed on it is marked Dismissed and has a Restore button, backed by `POST /api/profiles/:pid/jobs/:id/restore`.

## Lessons Extracted

- A skill's Update Rules are binding at plan time: the artifact plan first guessed the local-api skill needed no entry, and the reviewer caught it. Recorded in this SOW; no skill change beyond the entry itself, since the rule was already written down.

## Followup

- None. The remaining half of SOW-0005 line 22 ("Loading" on a failed first load) is tracked in SOW-0005. Search for `defer|later|follow-up|future|TODO|pending` in this SOW: the only hits are the decision history and this mapping.

## Regression Log

None.
