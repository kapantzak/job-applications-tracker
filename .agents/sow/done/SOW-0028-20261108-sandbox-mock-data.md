# SOW-0028 - Sandbox with mocked data

## Status

Status: completed

Sub-state: delivered and validated.

## Requirements

### Purpose

Let the user test the UI against realistic, varied data without creating it by hand and without any real agent, web search or Gmail access.

### User Request

"Please add a new script that starts the app in sandbox dir with mocked data (profile, jobs, applications etc) so I can test the UI."

### Assistant Understanding

Facts:

- `npm run sandbox` builds and runs `node bin/jobtrack.js --data-dir .tmp/sandbox` (`package.json`).
- Repositories stamp `created_at` and similar timestamps with the current time (`src/server/db/jobs-repo.ts`, `applications-repo.ts`, `runs-repo.ts`, `profiles-repo.ts`); jobs can only be inserted under a run (`jobs-repo.ts` `insertMany`).
- The run queue starts any `queued` run at startup (`src/server/runs/queue.ts` `nextQueued`), and running runs are marked aborted on restart.
- Default settings select the real Claude Code agent (`src/server/db/settings-repo.ts`), which would run real web searches and read the user's real Gmail.
- A custom agent receives the prompt as `prompt.md` through the `{prompt_file}` placeholder and returns the last JSON object on stdout (`src/server/agents/presets.ts`, `cli-adapter.ts`); its health check runs `<argv0> --version`.
- Discovery verifies every link over the network; `https://example.com/?<query>` answers 200 and the query survives `canonicalUrl` (probed 2026-11-08), while other `example.com` paths answer 404 (dead).
- An open application is `applied`, `screening`, `interview`, `no_response`, or `offer` changed in the last 30 days (`applications-repo.ts`).
- A profile CV lives at `<data-dir>/profiles/<id>/cv.<type>` plus `cv-text.txt` (`src/server/cv/service.ts`).

Inferences:

- Dates must be relative to the seed time so "open" and "N days ago" stay meaningful.

Unknowns:

- None blocking.

### Acceptance Criteria

- `npm run sandbox:mock` builds, wipes and reseeds `.tmp/sandbox-mock`, and starts the app on it; extra flags after `--` reach `bin/jobtrack.js`. Verified by running it.
- Seeded data covers three profiles (rich with CV, sparse, empty), every application status, status history, pending/accepted/rejected proposals, every job verification status, fit verdicts, a dismissed job, and finished runs of each terminal status with log files. Verified by the seed test and by browsing the app.
- Find jobs, Sync mail and CV analysis in the mock sandbox use the mock agent and never the user's real agent. Verified by the mock agent test and real runs in the sandbox.
- A vitest test fails when a migration breaks the seed. Verified by the test running in `npm test`.

## Analysis

Sources checked:

- `package.json`, `bin/jobtrack.js`, `src/server/index.ts`, `src/server/config/*`, `src/server/db/*`, `src/server/services/*`, `src/server/mail/agent-source.ts`, `src/server/agents/presets.ts`, `src/server/agents/cli-adapter.ts`, `src/server/verify/*`, `src/server/tasks/schemas.ts`, `prompts/*.md`, `src/ui/App.tsx`, `README.md`, `AGENTS.md`.

Current state:

- No seed or mock data tooling exists; tests build rows ad hoc.

Risks:

- Real agent use from the sandbox (Gmail, cost): removed by the mock agent setting (decision 3).
- Deleting the wrong folder on reset: the wipe is limited to `<repo>/.tmp/sandbox-mock`, checked before deletion.
- Seed drift after migrations: guarded by the seed test (decision 5).
- Link checks need network: offline, mock-discovered jobs are marked dead and hidden. Documented.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Testing the UI needs data in many states; the only way to get it today is real agent runs, which are slow, cost money and touch the user's real Gmail.

Evidence reviewed:

- Files listed under Analysis; schema dumped from `migrate()` on an in-memory database.

Affected contracts and surfaces:

- New npm script `sandbox:mock`; new `scripts/sandbox-mock/` (not shipped: `package.json` `files` lists only `bin`, `dist`, `prompts`, `README.md`, `LICENSE`); `tsconfig.server.json` include; new tests; `README.md` Development section; `AGENTS.md` commands list.
- No change to `src/`, the API, the schema or the prompts.

Existing patterns to reuse:

- `openDatabase`, `migrate`, `ensureDataDir`, the repositories and `createProposalService` for writes; `renderPrompt` and the zod output schemas in the mock agent test; `test/fixtures/fake-agent.mjs` style for a node script agent.

Risk and blast radius:

- Developer tooling only; production code untouched. The wipe is path-guarded.

Sensitive data handling plan:

- All companies, people, emails, message ids and URLs are invented (`example.com`, `example.org`, `msg-…`). No real run logs are copied.

Implementation plan:

1. `scripts/sandbox-mock/mock-agent.mjs`: reads `prompt.md`, detects the task from its `# Task:` heading, logs a few progress lines, waits `--delay-ms <n>` (default 3000; a flag rather than an environment variable, because the adapter passes the app's own environment unchanged), prints canned JSON on one line (discovery jobs on `https://example.com/?mock-job=…` plus one dead link; sync findings for open applications listed in the prompt; a CV draft).
2. `scripts/sandbox-mock/seed.ts`: `seedMockData(db, { dataDir, now, mockAgentCommand })` through the repositories, then backdates timestamps; writes CV files and run logs.
3. `scripts/sandbox-mock/prepare.ts`: guarded wipe of `.tmp/sandbox-mock`, migrate, seed, print a summary.
4. `package.json` script `sandbox:mock`; `tsconfig.server.json` includes `scripts`.
5. Tests: `test/server/sandbox-mock/seed.test.ts`, `test/server/sandbox-mock/mock-agent.test.ts`.
6. Docs: `README.md`, `AGENTS.md`.

Validation plan:

- New tests first, then `npm test` and `npm run typecheck`.
- Run `npm run sandbox:mock -- --no-open --port 0`, check the API returns seeded rows, and run Find jobs, Sync mail and a CV analysis against the mock agent.
- Same-failure scan: no `shell: true` / `exec(` added; no real data in fixtures.

Artifact impact plan:

- AGENTS.md: add the `sandbox:mock` command line.
- Runtime project skills: `project-testing` gains a line on the seed test; others unaffected (no adapter, API or bootstrap change).
- Specs: unaffected; `product-v1.md` describes product behaviour, and this is developer tooling outside the shipped package.
- End-user/operator docs: `README.md` Development section.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW, closed with the work in one commit.

Open-source reference evidence:

- None; no external repositories were relevant.

Open decisions:

- None; see decisions below.

## Implications And Decisions

User decisions (2026-11-08):

1. Seeding approach: **A** - TypeScript seed run with `tsx`, using `openDatabase`/`migrate` and the repositories, then backdating timestamps.
2. Data folder: **A** - `.tmp/sandbox-mock`, wiped and reseeded on every start.
3. Agent in the mock sandbox: **B** - a mock agent script configured as the custom agent, returning canned results per task.
4. Dataset: **A** - coverage set (rich profile with CV, sparse profile, empty profile; all statuses and states).
5. Script and guard: **A** - `npm run sandbox:mock`, code in `scripts/sandbox-mock/`, plus a vitest seed test.

## Plan

See Pre-Implementation Gate, Implementation plan.

## Execution Log

### 2026-11-08

- SOW created with decisions 1A 2A 3B 4A 5A.
- Added `scripts/sandbox-mock/{seed.ts,prepare.ts,mock-agent.mjs}`, `test/server/sandbox-mock/{seed,mock-agent}.test.ts`, the `sandbox:mock` npm script and `scripts` in `tsconfig.server.json`; updated `README.md`, `AGENTS.md`, `.agents/skills/project-testing/SKILL.md`.
- Deviation from plan step 1: the delay is a `--delay-ms` flag, not an environment variable (the adapter passes the app's environment unchanged, so a flag in the saved command is the only per-command knob). Recorded in the plan.
- Independent review (one reviewer subagent, read-only) found 10 items; 1-9 fixed, 10 reported as an opportunity (see Reviewer findings).

## Validation

Acceptance criteria evidence:

- `npm run sandbox:mock -- --no-open --port 0` built, printed the three seeded profiles, and served the app; `GET /` returned 200 and `GET /api/setup/adapters` reported `custom` installed.
- Seeded data through the API: Frontend Platform 13 jobs (11 listed; the dead and the dismissed one hidden by default), 9 applications in all 8 statuses, 3 pending proposals, 6 runs (succeeded, Max with "1 of 5 workers failed", failed, aborted); Data Analyst Roles 2 jobs, 1 application, 1 run; Empty Search 0/0/0. CV download returned 200.
- Mock agent runs in the sandbox: Find jobs default "5 new, 0 duplicates, 1 dead, 0 unverified"; Max "25 new, 0 duplicates, 5 dead, 0 unverified"; Sync mail "2 proposals created, 0 skipped", then a second Sync "0 proposals created, 2 skipped" (the app's own duplicate guard); CV analysis on a new profile `succeeded` with the mock draft.
- Restart wiped the folder: a reseed returned the counts to 3 profiles, 7 runs, 15 jobs, 10 applications, 5 proposals, 0 CV analyses.
- Drift guard: `test/server/sandbox-mock/` runs in `npm test`.

Tests or equivalent validation:

- New tests were written first and failed on the missing modules; the log-line test failed (6 JSON lines) before the compact-output fix.
- `npm test`: `Test Files  67 passed (67)`, `Tests  871 passed (871)`; no `act(...)` warnings.
- `npm run typecheck`: clean.
- Clock-independence check: with the seed time moved to 2025-01-15 the seed tests still passed (9 of 9), proving the fake `Date` covers the repositories' 30-day offer window.

Real-use evidence:

- See acceptance criteria; both server processes were stopped by their own PIDs and shut down cleanly ("Shutting down...").

Reviewer findings:

1. High: `seed.test.ts` depended on the real clock (offer window), failing after 2026-12-04. Fixed with `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(NOW)`.
2. Medium: the sync test typed the prompt lines by hand, so a change in `src/server/mail/agent-source.ts` would not fail it. Fixed: the test runs through `createAgentMailSource(createAdapter(...)).sync(...)`.
3. Medium: pretty-printed JSON split the result over many log rows and lost the Run page's "Agent returned N jobs" summary. Fixed: one-line JSON, with a test.
4. Low: the mock's `--version` branch was unreachable (the check runs `node --version`). Removed; the health test now asserts `version: process.version`.
5. Low: seeded logs had one unprefixed `result` for the Max run and a fixed 10-minute duration. Fixed: one `[worker n]` result per surviving worker, duration from the run's start and finish; tested.
6. Low: proposals were timestamped before their run started. Fixed: `created_at` is the run's finish time; tested.
7. Low: the path guard in `prepare.ts` was always true. Replaced with symbolic-link checks on `.tmp` and `.tmp/sandbox-mock`.
8. Low: `--data-dir` after `--` would move the app off the mock folder. Documented in `README.md` and `AGENTS.md`.
9. Low: plan text named an environment variable; README said offline jobs are "dead" only. Both corrected.
10. Idea: mock discovery never returns a known URL, so the duplicates path is not exercised. Not required for the approved outcome; reported to the user as an opportunity.

Same-failure scan:

- `grep -rn "shell: true\|exec(" scripts/`: only a `RegExp.exec` call in `mock-agent.mjs`, no process spawning.
- Searched the new files for timestamps compared against the real clock: only the offer window (fixed in finding 1).
- `npm pack --dry-run`: 0 entries under `scripts/`, so nothing new ships in the package.

Sensitive data gate:

- All data is invented: fictional company names, placeholder people ("Sam Placeholder", "Dana"), addresses on `*.example.com`, message ids `msg-001`… and `mock-msg-…`, links on `example.com`/`example.org`. No real run logs were copied. The real data folder `~/.job-applications-tracker` was never read or written.

Artifact maintenance gate:

- AGENTS.md: added the `sandbox:mock` command line, its drift rule and the `--data-dir` warning.
- Runtime project skills: `.agents/skills/project-testing/SKILL.md` gains the sandbox-mock tests line. `project-agent-adapter` and `project-local-api` are unaffected: no adapter, prompt, route or bootstrap code changed.
- Specs: no update; `.agents/sow/specs/product-v1.md` describes the shipped product, and this is developer tooling outside the package (`npm pack --dry-run` lists no `scripts/`).
- End-user/operator docs: `README.md` Development section.
- End-user/operator skills: none exist in this repository (`AGENTS.md` lists "Output/reference skills: none").
- SOW lifecycle: single SOW; `Status: completed` and the move to `done/` are committed together with the work.

Specs update:

- None needed; see the artifact maintenance gate.

Project skills update:

- `.agents/skills/project-testing/SKILL.md`.

End-user/operator docs update:

- `README.md`.

End-user/operator skills update:

- None exist.

Lessons:

- Tests of seeded data must freeze `Date`, because repositories read the real clock (the open-offer window).
- A fixture for the prompt format must be produced by the app's own renderer, not typed by hand, or the drift it should catch passes silently.

Follow-up mapping:

- Reviewer item 10 (duplicates path in mock discovery): rejected for this SOW as not required for the approved outcome; reported to the user as an opportunity.
- No other deferred items.

## Outcome

`npm run sandbox:mock` builds the app, recreates `.tmp/sandbox-mock` with invented data covering every UI state, and starts the app on it with a mock agent, so Find jobs, Sync mail and CV analysis work offline from any real agent, web search or Gmail.

## Lessons Extracted

- Recorded under Validation, Lessons. The clock lesson applies to this seed only; no repository-wide skill rule was added beyond the project-testing line.

## Followup

None.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
