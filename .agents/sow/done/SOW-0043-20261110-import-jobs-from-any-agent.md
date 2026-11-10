# SOW-0043 - Import jobs found by any agent client

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: implemented, validated and committed with the work on 2026-11-10 on branch `custom-prompt` (PR #32; user approved the commit and the screenshot re-take).

## Requirements

### Purpose

Let the user run a job search prompt in any agent client they already use (a chat app or their own CLI session) and bring the results into the app (issue #29, part B).

### User Request

Issue #29: "Allow users to run a prompt on their agent client and send data to the app." Delivered after part A (SOW-0042) as its own SOW (SOW-0042 decision 1C).

### Assistant Understanding

Facts:

- `jobs.run_id` is `NOT NULL REFERENCES runs(id)`; `runs.kind` is limited to `discover_jobs` and `sync_mail` by a CHECK in the table rebuilt by migration 3 (`src/server/db/migrations.ts`, `runs_new`), so a new kind needs a table rebuild.
- Link checks, dedupe and found-again rules run in `src/server/services/discovery.ts` after `ctx.beginSaving()`; each link check waits up to 8 s (`src/server/verify/links.ts`), five at a time.
- `extractLastJsonObject` (`src/server/agents/extract-json.ts`) takes the last balanced JSON object from text with prose or code fences and throws `NoJsonFoundError` otherwise.
- An outside agent receives no schema flag, so the copied prompt must carry the JSON schema (`outputJsonSchema('discover_jobs')`).
- The request guard admits local clients without `Origin` (`src/server/api/guard.ts`); state-changing JSON routes need `Content-Type: application/json`.
- `AgentTaskKind = RunKind | 'analyse_cv'` (`src/server/domain/types.ts`) and the presets key model/effort by run kind; a run kind without an agent must not widen those types.
- The queue keeps one active run per profile and kind and returns the active run on a repeat request (`src/server/runs/queue.ts`).

Inferences:

- Returning an active import for a second paste would silently drop the second paste; it must be refused instead.
- The pasted result must survive a restart while queued, so it belongs on disk, not in memory.

Unknowns:

- None that block implementation; all design choices are recorded below.

### Acceptance Criteria

- "Copy prompt" returns the v5 discovery prompt for the profile (profile, known links, all-sources scope, optional instructions) followed by the required JSON schema. Verified by API test.
- Importing a pasted reply (prose or code fences allowed) or a structured `result` object queues an `import_jobs` run that checks links, dedupes, records found-again jobs and saves new jobs exactly like a discovery. Verified by API, handler and e2e-style tests.
- Invalid input gives a clear 400 (no JSON object, wrong shape, no jobs, more than 100 jobs, both or neither of `reply`/`result`); more than 1 MB gives 413; a second import while one is active gives 409. Verified by API tests.
- Migration 11 widens `runs.kind` to `import_jobs` keeping every row, index and foreign key. Verified by migration test.
- The Find jobs menu has "Import from another agent…" on Jobs and Dashboard; the dialog copies the prompt, accepts the reply and opens the Run page. Verified by UI tests and a browser check.
- Run page shows an import without agent, model, effort, mode or usage, with its instructions and "View jobs"; the Jobs "Found in" label reads "… · Imported" (plus " · Custom"). Verified by UI tests.
- README documents the paste flow and the endpoint with a `curl` example. Verified by review.

## Analysis

Sources checked:

- `src/server/db/migrations.ts` (migration 3 rebuild pattern), `src/server/db/connection.ts` (`foreignKeysOff`), `src/server/runs/queue.ts`, `src/server/services/discovery.ts`, `src/server/agents/extract-json.ts`, `src/server/agents/presets.ts`, `src/server/tasks/schemas.ts`, `src/server/verify/links.ts`, `src/server/api/runs.ts`, `src/server/api/cv-analysis.ts` (`bodyLimit`), `src/server/api/guard.ts`, `src/server/index.ts`, `src/ui/pages/RunPage.tsx`, `RunsPage.tsx`, `JobsPage.tsx`, `DashboardPage.tsx`, `src/ui/components/FindJobsButton.tsx`, `bin/jobtrack.js` (port fallback).

Current state:

- No way to bring jobs into the app except the app's own agent run.

Risks:

- Table rebuild of `runs`: rows are referenced by `jobs.run_id`, `jobs.last_seen_run_id` and `proposals.run_id`. Uses the existing `foreignKeysOff` path, which fails the migration on any `foreign_key_check` row.
- Privacy: the copied prompt holds the profile (including Notes) and up to 200 known job links; the user chooses which outside service receives them. The dialog says so.
- Outside agents may invent links; every link is checked, so they show as dead.
- A public import endpoint: only reachable on loopback like the rest of the API; it adds jobs only, after validation and link checks.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Results can enter the app only through `createDiscoveryHandler`, which always spawns the configured agent. There is no entry point for results produced elsewhere, and the run model has no kind for them.

Evidence reviewed:

- Listed under Analysis; plus `.agents/skills/project-agent-adapter`, `project-local-api`, `project-testing`, SOW-0042.

Affected contracts and surfaces:

- DB: migration 11 rebuilds `runs` with `kind IN ('discover_jobs','sync_mail','import_jobs')`.
- Types: `RUN_KINDS` gains `import_jobs`; new `AgentRunKind` (`discover_jobs | sync_mail`) for agent-facing code; `JobListItem.run_kind`.
- Queue: `enqueue` option `input` written to `runs/<id>/input.json`; a second active import is refused (`ActiveRunConflictError` with a kind-specific message).
- API: `POST /api/profiles/:pid/runs/import/prompt` (`{ custom_prompt? }` → `{ prompt, version }`); `POST /api/profiles/:pid/runs/import` (`{ reply } | { result }`, plus `custom_prompt?`; 1 MB limit; at most 100 jobs).
- Services: shared save step extracted from discovery; new `import_jobs` handler.
- UI: Find jobs menu item, `ImportJobsDialog`, client calls, Run page, Jobs label, help text.
- Docs: README, spec, skills.

Existing patterns to reuse:

- Migration 3 rebuild order and `foreignKeysOff`; `bodyLimit` with a 413 handler from `cv-analysis.ts`; `extractLastJsonObject`; `DiscoverJobsOutput`; `renderPrompt`; `CustomSearchDialog` layout; `FIELD_HELP`.

Risk and blast radius:

- Discovery save step is refactored, not changed; the existing discovery tests (SOW-0040 found-again rules) guard it.
- Narrowing agent types to `AgentRunKind` is compile-time only.
- No change to sync, CV analysis, presets' argv, binding or guard.

Sensitive data handling plan:

- Tests and docs use invented companies, links and text. The pasted reply is stored in the run folder under the data directory like `prompt.md`; nothing is copied into durable artifacts.

Implementation plan:

1. Types, migration 11, queue input and conflict, jobs list `run_kind`. Tests first.
2. Extract the shared save step and prompt builder from discovery; add the import handler; wire it in `src/server/index.ts`.
3. API routes and tests.
4. UI: client, dialog, menu item, pages, help text. Tests.
5. README, spec, skills; full validation; browser check; independent review.

Validation plan:

- Per-file vitest, then `npm test`, `npm run typecheck`, `npm run build`.
- Real use: built app on the mock sandbox; copy the prompt, import a pasted reply through the UI and with `curl`.
- Independent review of the diff.
- Same-failure scan: every `RunKind`/`run.kind` consumer, every `FindJobsButton` mount, every handler map.

Artifact impact plan:

- AGENTS.md: no workflow change expected.
- Runtime project skills: `project-local-api` (new routes, body limit, 409 rule); `project-agent-adapter` (copied prompt reuses `renderPrompt` and `outputJsonSchema`; `AgentRunKind`).
- Specs: `product-v1.md` (run kinds, migration 11, import routes, UI).
- End-user/operator docs: README section with `curl` example; in-app help.
- End-user/operator skills: none exist.
- SOW lifecycle: closes to `done/` with the work in one commit on `custom-prompt`.

Open-source reference evidence:

- None checked; internal change.

Open decisions:

- All resolved (see Implications And Decisions).

## Implications And Decisions

User decisions, 2026-11-10 (all recommended options except 7):

1. Recorded as a new run kind `import_jobs` that goes through the queue (**A**), with a `runs` table rebuild.
2. "Copy prompt" gives exactly the app's v5 discovery prompt with the JSON schema appended (**A**).
3. The paste box is tolerant: the last JSON object of the reply is used and validated (**A**). Limits: 1 MB, 100 jobs.
4. The import endpoint is documented in the README with a `curl` example (**B**); the copied prompt does not tell the agent to call it.
5. "Import from another agent…" item in the Find jobs menu on Jobs and Dashboard, opening a two-step dialog (**A**).
6. Instructions typed for an import are stored on the import run and shown like a custom search (**A**).
7. Implemented on the existing `custom-prompt` branch (user's choice), so PR #32 covers both parts of issue #29.

Defaults stated to the user before approval:

- Imports do not count toward the Dashboard's "Last discovery"; the Runs page shows them as their own kind.

Derived rules (consequences of the decisions):

- A second import while one is queued or running is refused with 409 "An import is already active", because returning the active run would drop the second paste.
- Import runs record no prompt version (the app cannot know which version the user copied) and no agent.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-10

- SOW moved to `current/` with decisions recorded.
- Server:
  - `RUN_KINDS` gains `import_jobs`; new `AgentRunKind`, `IMPORT_MAX_BYTES`, `IMPORT_MAX_JOBS` and `JobListItem.run_kind`.
  - Presets, the discovery adapter factory and the runs API agent check now take `AgentRunKind`.
  - Migration 11 rebuilds `runs` with a frozen column list.
  - The queue writes `input.json` at enqueue (a failed write fails the row and rethrows the original error) and refuses a second active import.
  - `saveFoundJobs`, `savedSummary` and `discoveryPromptVars` are extracted unchanged from the discovery handler.
  - `src/server/services/import-jobs.ts` adds `renderImportPrompt`, `parseImport`, `ImportInputError` and `createImportHandler`, wired in `src/server/index.ts`.
  - Routes `POST /runs/import/prompt` and `POST /runs/import` in `src/server/api/runs.ts`.
- UI:
  - `ImportJobsDialog.tsx`; the "Import from another agent…" menu item and `onImported` prop in `FindJobsButton.tsx`, mounted on the Jobs page and the Dashboard.
  - Run page: no agent rows for imports; instructions row and "View jobs" for imports.
  - Jobs "Imported" round label; client `getImportPrompt` and `importJobs`; help text.
- Found during the browser check and fixed: the Jobs page description and the "About Find jobs" help still described discovery runs only. The help text also missed SOW-0042's Custom search, so it now names both menu items.

## Validation

Acceptance criteria evidence:

- Copy prompt: `test/server/services/import-jobs.test.ts` ("is the v5 discovery prompt for the profile with all sources, the instructions and the schema", "says (none) when there are no instructions"); `test/server/api/runs.test.ts` ("POST import/prompt returns the discovery prompt for the profile with the schema, without an agent").
- Import saves like a discovery:
  - `import-jobs.test.ts` handler tests: link checks, dead links, found-again sighting, no agent recorded, nothing saved on bad input.
  - `test/e2e/discovery-flow.test.ts` ("imports jobs pasted from another agent…"): real app and queue, dedupe within the answer, unsupported link counted dead, `run_kind` on the list.
- Errors: `runs.test.ts` covers:
  - 400: neither, both, no JSON, no jobs, unknown key, over-long instructions;
  - 413: streaming body and explicit `Content-Length`;
  - 415, 404, and 409 for a second import.
  
  `parseImport` tests give the exact messages, including the 100-job cap.
- Migration 11: `test/server/db/migrations.test.ts` ("migration 11 allows import runs and keeps every run, index and reference", "migration 11 fails and changes nothing when a run points at a missing profile").
- UI:
  - `test/ui/FindJobsButton.test.tsx`: copy, clipboard fallback, import with instructions, recorded instructions match the copied prompt, refused import keeps the answer, prompt load error, error cleared on reopen.
  - `test/ui/JobsPage.test.tsx` and `DashboardPage.test.tsx`: an import opens its run.
  - `test/ui/RunPage.test.tsx`: Run page for an import.
  - `JobsPage.test.tsx`: Imported label.

Tests or equivalent validation:

- `npm run typecheck`: no errors.
- `npm test`: "Test Files 77 passed (77)", "Tests 1174 passed (1174)", no warnings.
- `npm run build`: succeeds.

Real-use evidence:

- Built app on the mock sandbox. A `curl` import with a `{ result }` body ran as `import_jobs` and succeeded: "1 new, 0 duplicates, 1 dead, 0 unverified"; the invented link answered as dead, so the link check ran. A reply without JSON got 400 "No JSON object found in the reply".
- Chrome:
  - the menu shows "Import from another agent…" and the dialog opens;
  - the page is a secure context with the Clipboard API. The copy was captured in the page so the user's real clipboard was not overwritten. It held 6,658 characters with the typed instructions between the markers and the "Required schema" section, and the status read "Prompt copied. Paste it into your agent.";
  - pasting a prose-wrapped answer and pressing Import opened the Run page: kind `import_jobs`, no agent rows, the instructions, the summary and a plain-words log;
  - "View jobs" with dead links shown labelled the round "… · Imported · Custom".

Reviewer findings:

- Independent reviewer (subagent, fresh context, given the diff and the SOW): no high or medium findings. Low findings, all fixed:
  1. The import recorded the instructions typed at import time, not those in the copied prompt. It now records the copied prompt's instructions, or the typed ones when nothing was copied (test added).
  2. The copied state went stale after editing the instructions, and an old error stayed after reopening. Editing now clears the copied state, and opening clears the error (tests added).
  3. The input-write failure path could mask the original error and was untested. The original error is now rethrown even if recording fails (test added). The route still answers 500 "Internal error" for this internal failure, consistent with other internal errors.
  4. Missing tests for a second import behind a cancelling one and for 413 with `Content-Length`: added.

Same-failure scan:

- Every branch on a run's kind (`grep -rn "kind ===\|\.kind\b" src`): `RunPage.tsx`, `JobsPage.tsx`, `DashboardPage.tsx` (discovery only, by decision), `MaxSearchDialog.tsx` (discovery only), `RunsPage.tsx` (values from rows), `presets.ts` (now `AgentRunKind`).
- Every handler map: `src/server/index.ts`, `test/server/api/harness.ts`, `test/server/runs/queue.test.ts`.
- Every `FindJobsButton` mount: Jobs page and Dashboard, both pass `onImported`.
- Run folder cleanup: `log-store.ts` `remove` and `purge` delete whole run folders, so `input.json` goes with them.
- `grep -rn "0.0.0.0" src bin`: nothing.

Sensitive data gate:

- Tests, docs, SOW and skills use invented companies (Acme, Globex, Initrode Payments, Vandelay Payments), `example.com` links and invented instructions only.
- The pasted answer is stored only in the git-ignored data folder (`runs/<id>/input.json`), deleted with the run folder.
- The README warns that the copied prompt holds the profile and known links.
- No real run logs or mail data were copied.

Artifact maintenance gate:

- AGENTS.md: no change. No workflow, command or guardrail changed; the sandbox-mock note does not apply because the mock seed and agent need no import data.
- Runtime project skills:
  - `.agents/skills/project-local-api/SKILL.md`: import routes, body limit, no agent check, README contract.
  - `.agents/skills/project-agent-adapter/SKILL.md`: `AgentRunKind` rule, the copied prompt reuses the discovery template and schema.
- Specs: `.agents/sow/specs/product-v1.md` (agent task kinds, run kinds and migration 11, new "Import from another agent" section, Found-in label).
- End-user/operator docs: `README.md` "Import from another agent" section with the `curl` example; in-app help (`importInstructions`, `importReply`, `findJobs`); Jobs page description. README screenshots: `docs/images/jobs.png` showed the old page description, so it was re-taken (user decision, 2026-11-10). Procedure: `npm run sandbox:mock` data, Frontend Platform Jobs page, 1440×900, light, `en-GB`, `playwright-core@1.58` in a scratch `.tmp/shots` with a cached Chromium build passed as `executablePath` (no browser download). Inspected before commit: invented companies and `example.com` only. The other images are unaffected: they show screens whose text did not change, with the Find jobs menu closed.
- End-user/operator skills: none exist.
- SOW lifecycle: closes to `done/` as `completed` in the same commit as the work, on `custom-prompt` (PR #32).

Specs update:

- Updated as listed above.

Project skills update:

- Updated the two skills above. `project-testing` is unchanged: the new tests use the existing harness, fixture and patterns.

End-user/operator docs update:

- README and in-app help as listed.

End-user/operator skills update:

- None exist.

Lessons:

- A new run kind without an agent must not widen agent-facing types. Splitting `AgentRunKind` from `RunKind` made the compiler find every agent path.
- A help text describing a control has to change when the control gains menu items; part A missed it and the browser check caught it.

Follow-up mapping:

- README screenshot `docs/images/jobs.png`: implemented (re-taken in this SOW).
- Mock sandbox import data: rejected. The sandbox already exercises imports live through the dialog, and seeding an import would add an unused fixture.

## Outcome

Users can run the app's search prompt in any agent client and import its answer from the Find jobs menu on the Jobs page and the Dashboard. A shell agent can also send its result with `curl`. Imports are their own run kind: they check links, dedupe and save exactly like a discovery. They are recorded without agent details and labelled "Imported" in the search rounds.

## Lessons Extracted

- Recorded under Validation → Lessons; the `AgentRunKind` rule is in `project-agent-adapter`.

## Followup

None yet.

## Regression Log

None yet.
