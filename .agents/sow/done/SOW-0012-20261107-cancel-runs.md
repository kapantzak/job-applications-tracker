# SOW-0012 - Cancel a run from the UI

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered and committed (2026-11-07).

## Requirements

### Purpose

Let the user stop a discovery or mail-sync run that is waiting or whose agent is still working, without restarting the app.

### User Request

"Users should be able to cancel a run at any time"

### Assistant Understanding

Facts:

- Each run has an `AbortController` (`src/server/runs/queue.ts`, `execute`); aborting it makes the adapter kill the agent's process tree (`src/server/agents/cli-adapter.ts`, `onAbort` → `terminate`, SIGTERM then SIGKILL after 5 s), the handler throws, and the queue records `aborted` / `Aborted`.
- The only trigger today is `queue.stop()` on server shutdown. There is no API route and no UI control.
- A queued run cannot be removed; `enqueue` returns the existing active run of the same kind, so it also blocks new runs of that kind.
- After the agent returns, discovery verifies links (5 at a time, 8 s timeout each, up to ~30 jobs) and inserts jobs; mail sync creates proposals. Discovery checks the signal once before verification (`discovery.ts`); mail sync never does. The queue records `succeeded` for a handler that returns, even if abort was requested.

Inferences:

- Under decision 1B the server must know when a run enters its saving phase, refuse cancellation from then on, and tell the UI.

Unknowns:

- None.

### Acceptance Criteria

- A queued run can be cancelled and is recorded `aborted` / "Cancelled by user" at once; the queue never starts it. Verified by queue and API tests.
- A running run whose agent is working can be cancelled: the agent's process tree is killed and the run is recorded `aborted` / "Cancelled by user". Verified by queue tests and the e2e test with the hanging fake agent.
- Once the agent has returned, cancellation is refused with 409; the run finishes normally. Verified by queue, service and API tests.
- Run page and Runs list show a Cancel button for queued and running runs, behind a confirmation dialog; the Run page shows "Saving results…" (disabled) once the saving phase starts and "Cancelling…" after a cancel request. Verified by UI tests.

## Analysis

Sources checked:

- `src/server/runs/queue.ts`, `src/server/api/runs.ts`, `src/server/services/discovery.ts`, `src/server/services/mail-sync.ts`, `src/server/agents/cli-adapter.ts`, `src/server/verify/links.ts`, `src/server/runs/scheduler.ts`
- `src/ui/pages/RunPage.tsx`, `src/ui/pages/RunsPage.tsx`, `src/ui/components/DataSection.tsx` (confirmation pattern), `src/ui/api/client.ts`
- `.agents/sow/specs/product-v1.md` (Runs, UI confirmation rule), design doc section 5.2 (shutdown aborts)

Risks:

- Race between cancel and the queue picking up a queued run: Node is single-threaded and `better-sqlite3` is synchronous, so a cancel either marks the row before `nextQueued()` reads it, or finds the run as the current entry.
- Race between cancel and the agent finishing: handled by `beginSaving()` checking the signal; the agent result is discarded if the abort came first.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The abort path exists but is reachable only from shutdown; queued runs have no removal path; post-agent work has no phase marker, so a late abort is silently ignored (run ends `succeeded`). Evidence: `queue.ts` (`stop`, `execute` outcome), `api/runs.ts` route list, `discovery.ts` single signal check.

Evidence reviewed:

- Code listed under Analysis; spec and design doc. No external open-source references are relevant (internal queue and process control only).

Affected contracts and surfaces:

- `RunQueue` (`cancel`), `RunContext` (`beginSaving`), new route `POST /api/runs/:id/cancel`, discovery and mail-sync handlers, UI client, Run page, Runs list, new `CancelRunButton` component, spec `product-v1.md`, README, skill `project-local-api` (new state-changing route).

Existing patterns to reuse:

- `AlertDialog` confirmation from `DataSection.tsx`; `HttpError` mapping in `api/errors.ts`; queue `finish()`/`safeLog()`; fake agent `hang` mode with pid file for kill assertions; harness `handlers` swap for API tests.

Risk and blast radius:

- No schema change (decision 4A). Shutdown behaviour unchanged ("Aborted"). A cancel sent during the saving phase gets 409 and changes nothing.
- The run stays `running` for up to ~6 s after a cancel while the agent is killed (SIGTERM grace 5 s + close grace 1 s); the UI shows "Cancelling…".

Sensitive data handling plan:

- No secrets or personal data involved; tests use invented data.

Implementation plan:

1. Queue: `cancel(id)` returning `cancelled | cancelling | saving | finished | not_found`; per-entry `saving` flag and `cancelReason`; `RunContext.beginSaving()` (throws `Aborted` if already aborted, then sets `saving` and logs "Saving results; the run can no longer be cancelled"); abort outcome uses the cancel reason.
2. Handlers: discovery calls `beginSaving()` right after a successful agent run (replaces the single signal check); mail sync calls it after the mail source returns.
3. API: `POST /api/runs/:id/cancel` → 202 run (cancelled/cancelling), 404 unknown, 409 saving ("This run is saving its results and can no longer be cancelled") or finished ("This run has already finished").
4. UI: `cancelRun` client; `CancelRunButton` (confirm dialog); Run page header (Cancel / Cancelling… / Saving results…, the latter from the log line); Runs list column with Cancel on active rows, refreshing the list after a cancel and showing a 409 inline.
5. Docs: spec, README, `project-local-api` skill.

Validation plan:

- RED/GREEN per chunk; `npm test`, `npm run typecheck`, `npm run build`.
- e2e: cancel a running custom-command run using the fake agent `hang` mode and assert the process is dead and the run `aborted` / "Cancelled by user".
- Real use: built app with a custom command that sleeps; cancel from the browser; queued-run cancel via API.
- Independent review of the diff.

Artifact impact plan:

- AGENTS.md: no change expected.
- Runtime project skills: `project-local-api` (new state-changing route, 409 mapping); `project-agent-adapter` unaffected (adapter abort semantics unchanged) unless implementation shows otherwise.
- Specs: `product-v1.md` Runs and UI sections.
- End-user/operator docs: README (runs / interface).
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW, closed with the work in one commit.

Open-source reference evidence:

- None relevant.

Open decisions:

- All resolved, see below.

## Implications And Decisions

User decisions (2026-11-07):

1. Cancel after the agent finished → **B**: cancel only while queued or while the agent works; once saving starts the control shows "Saving results…" and the server refuses.
2. Confirmation → **A**: confirmation dialog before cancelling.
3. Placement → **B**: Run page and each queued/running row on the Runs list.
4. Recording → **A**: status `aborted`, error "Cancelled by user"; no migration.

Decision raised by the independent review (2026-11-07):

5. Starting a run of a kind whose run is being cancelled (agent still stopping, up to ~6 s): evidence `src/server/runs/queue.ts` `enqueue` returned the dying run, so the click (or a scheduled sync) was silently dropped. Options: A queue a new run behind it; B refuse with 409; C leave as is. User chose **A**. `enqueue` ignores the current run when it carries a user cancel reason and returns another active run of the kind or creates one (`runsRepo.findActiveExcept`). Spec rule updated to "one active run per kind, not counting a run that is being cancelled".

Implementation details derived from the decisions (reported with the result):

- Dialog: title "Cancel this run?", text "The agent is stopped and nothing from this run is saved.", buttons "Keep running" and "Cancel run" (destructive).
- The Run page learns the saving phase from the exact log line "Saving results; the run can no longer be cancelled" (shared constant `RUN_SAVING_LOG_LINE`; no API shape change). The Runs list does not stream: after a cancel it re-reads the list each second (up to 30 s) until the run ended; a 409 is shown above the list and the list is re-read once.
- Cancelling an already-cancelling run returns 202 again (idempotent).

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- SOW created with decisions recorded.
- Server: `queue.cancel()` and `RunContext.beginSaving()` (`src/server/runs/queue.ts`); `beginSaving()` in `discovery.ts` (replaces the single signal check) and `mail-sync.ts`; `POST /api/runs/:id/cancel` (`api/runs.ts`). RED observed for queue, handler, API and UI tests before implementation. The e2e cancel test was written after the server code and passed on first run (no RED observed).
- UI: `cancelRun` client call, `CancelRunButton` (confirm dialog), Run page header control, Runs list action column with polling after a cancel; new `test/ui/RunsPage.test.tsx`.
- Real use and independent review, see Validation.
- Decision 5A implemented: `enqueue` queues behind a run being cancelled (`runsRepo.findActiveExcept`); RED observed first.
- Review fixes: exact saving-line match via shared constant; Runs list shows refusals and refresh errors above the list and re-reads after a refusal; cancel during shutdown keeps "Aborted" and stop()'s give-up path keeps "Cancelled by user"; constants moved below imports; README wording; foreign-Host test; Runs list running-run polling and unmount tests (fake timers); e2e now uses `hang-tree` and asserts the helper process dies too, with a 30 s timeout.

## Validation

Acceptance criteria evidence:

- Queued cancel recorded at once and never started: `test/server/runs/queue.test.ts` ("cancels a queued run at once and never starts it"), `test/server/api/runs.test.ts` ("cancels a queued run at once and returns it").
- Running cancel kills the agent tree and records "Cancelled by user": queue and API tests; `test/e2e/discovery-flow.test.ts` ("cancels a running discovery: the agent and its helper die and nothing is saved", fake agent `hang-tree`, both pids asserted dead, no jobs).
- Refused once saving started, run still succeeds; a cancel that came first makes `beginSaving()` throw and nothing is saved: queue tests, `test/server/services/discovery.test.ts`, `test/server/services/mail-sync.test.ts`, API 409 tests.
- UI: confirmation with dismiss path, Cancelling…, Saving results… (exact line only), queued-run immediate state, no control on finished runs, Runs list polling until ended, unmount stops polling, refusals and refresh errors shown above the list: `test/ui/RunPage.test.tsx`, `test/ui/RunsPage.test.tsx`, `test/ui/client.test.ts`.
- Decision 5A: `queue.test.ts` ("queues a new run of the same kind behind a run that is being cancelled"), repo assertion for `findActiveExcept`.

Tests or equivalent validation:

- `npm test`: `Test Files  48 passed (48)`, `Tests  415 passed (415)`; no stderr, act or React warnings.
- `npm run typecheck`: clean. `npm run build`: clean.

Real-use evidence (2026-11-07, built app, throwaway data dir `.tmp/sow12`, custom command running the fake agent in `hang` mode):

- API: a queued sync run behind a hanging discovery was cancelled: 202, `aborted` / "Cancelled by user".
- Browser (Chrome): Runs list showed Cancel only on the running row; Run page Cancel opened "Cancel this run?"; confirming ended the run `aborted` / "Cancelled by user" with the log line "Run … aborted: Cancelled by user"; the agent pid was gone; a second cancel returned 409 "This run has already finished"; `GET /api/jobs` returned `[]`.
- Decision 5A: cancel a hanging discovery, then immediately `POST /api/runs/discover`: a new queued run was returned, a repeated POST returned the same new run, the first ended "Cancelled by user", the new one then ran and was cancelled too; no fake-agent process was left.
- Not exercised live: the "Saving results…" state (needs a real agent result plus slow link checks); covered by queue, API and UI tests.

Reviewer findings (independent read-only subagent review):

1. Saving phase matched by prefix, so agent output could lock the control: fixed (exact match on shared `RUN_SAVING_LOG_LINE`); test added.
2. Runs list kept stale rows after a 409 and swallowed refresh errors: fixed (error above the list, list re-read after a refusal); tests added.
3. A new run request during cancellation returned the dying run: user decision 5A, implemented.
4. Abort label depended on cancel/stop order: fixed (cancel during shutdown keeps "Aborted"; stop give-up keeps the cancel reason); test added.
5. Constants between imports in `RunsPage.tsx`: fixed.
6. A helper that ignores SIGTERM can survive after the agent itself exits: rejected for this SOW; pre-existing behaviour of the adapter kill path, already documented in README "Known limitations"; the e2e test proves an ordinary helper dies on cancel.
7. README said the button shows "Saving results…" everywhere: fixed (Run page only; Runs list shows the refusal).
8. Missing foreign-Host test on the new route: added.
9. No Runs list test for cancelling a running run (multi-poll, unmount): added with fake timers.
10. e2e used `hang` and had no timeout: switched to `hang-tree` with both pids asserted dead; 30 s timeout.
11. No Run page dismiss/409 tests: rejected; the shared `CancelRunButton` paths are covered through the Runs list tests.
12. Fixed sleep in a queue test and no cancel/stop interaction test: interaction test added; the 20 ms sleep stays as a bounded negative check (asserting a handler never starts).

Same-failure scan:

- Other writers of `aborted`: `runs-repo.ts` markInterrupted ("server restarted", running rows only) and `stop()`; both consistent with the new reasons.
- UI assumptions about `aborted`: Dashboard only reads `succeeded`; Run page shows `run.error` for any terminal non-succeeded run; no text assumes shutdown.
- `grep -rn "shell: true\|exec(" src/server`: only regex and SQLite `exec`. `grep -rn "0.0.0.0" src bin`: nothing.

Sensitive data gate:

- No secrets or personal data in durable artifacts; tests use invented data; real-use runs used the fake agent and a throwaway data dir.

Artifact maintenance gate:

- AGENTS.md: no update; no workflow, guardrail or command changed.
- Runtime project skills: `.agents/skills/project-local-api/SKILL.md` (new state-changing route, 409 mapping, beginSaving rule) and `.agents/skills/project-agent-adapter/SKILL.md` (handlers call `beginSaving()` before slow or writing steps). `project-testing`: no update; fake-timer polling tests follow standard vitest usage and the existing confirmation-dialog rule already covers the dialog tests.
- Specs: `.agents/sow/specs/product-v1.md` Runs (cancel contract, one-active-run rule) and User interface.
- End-user/operator docs: `README.md` "Cancelling a run" and Interface confirmation line.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW; set `completed` and moved to `done/` in the same commit as the work.

Specs update:

- `product-v1.md` as above.

Project skills update:

- `project-local-api`, `project-agent-adapter` as above.

End-user/operator docs update:

- `README.md` as above.

End-user/operator skills update:

- None exist.

Lessons:

- An abort flag that only shutdown used hid a gap: a handler that returns after an abort was recorded `succeeded`. An explicit phase boundary (`beginSaving`) makes "can this still be cancelled" a single, testable point.
- UI state derived from log lines must match an exact, shared constant; agent output shares the same log.

Follow-up mapping:

- Reviewer item 6: rejected for this SOW with reason above (pre-existing, documented).
- Reviewer item 11: rejected with reason above.
- No deferred work.

## Outcome

Queued and running runs can be cancelled from the Run page and the Runs list after confirmation; the agent's process tree is killed and nothing is saved. Once a run is saving results it can no longer be cancelled, and the UI says so. A new run of the same kind can be started while a cancelled one is still stopping.

## Lessons Extracted

- Recorded in Validation → Lessons; the durable rule (call `beginSaving()` before writes) is in `project-local-api` and `project-agent-adapter`.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
