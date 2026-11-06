# SOW-0001 - Initial implementation of the job applications tracker

## Status

Status: completed

Sub-state: v1 implemented on branch Initial-implementation (36 commits after bootstrap), final whole-branch review done, fix wave applied, suite green; user decisions on Windows, auth probe and license tracked in SOW-0002..0004.

Bootstrap mode: empty/new project.

## Requirements

### Purpose

Deliver v1 of a locally run, npm-installable job applications tracker that uses the user's own agent CLI for job discovery and Gmail-driven status proposals.

### User Request

Create a job applications tracking app installable via npm and run locally. It spawns a server with the UI on localhost. Two main functions: (1) investigate requested job openings from basic profile info and list them with links for manual application; (2) keep track of application state based on Gmail responses. Investigation and sync are done by the user's AI agents, whatever the user provides.

### Assistant Understanding

Facts:

- Repository was empty except a one-line README (commit 990fff6).
- Design approved by the user on 2026-11-05: `docs/superpowers/specs/2026-11-05-job-applications-tracker-design.md`.
- Plan approved by the user on 2026-11-05: `docs/superpowers/plans/2026-11-05-job-applications-tracker.md` (22 tasks).
- Installed agent CLIs on the development machine support headless schema-validated JSON output (Claude Code 2.1.x `-p --json-schema`, Codex 0.163 `exec --output-schema`).

Inferences:

- Single user per machine, desktop browser, English UI.

Unknowns:

- Exact CLI flag spellings on the end user's machine may differ from the development machine; the adapter exposes the command template in Settings so users can adjust it.

### Acceptance Criteria

- `npm pack` tarball installs in an empty directory and `npx jobtrack --no-open --port 0` starts a loopback server answering `/api/health` (plan Task 22 step 4).
- End-to-end test through the fake agent: discovery creates verified jobs, mark applied, sync creates a proposal, accept changes status with a `proposal` history row (plan Task 22).
- `npm test`, `npm run typecheck`, `npm run build` pass.
- Every plan task reviewed and its commit present on the branch.

## Analysis

Sources checked:

- Approved design document and plan (paths above).
- `claude --help`, `codex exec --help` on the development machine (2026-11-05).
- npm registry versions for hono, @hono/node-server, better-sqlite3, zod, vite, react, vitest, tsup, open (2026-11-05).

Current state:

- No code exists. Branch `Initial-implementation` contains the design and plan documents only.

Risks:

- Agent output quality and link hallucination: mitigated by schema validation, link verification, dedupe.
- CLI flag drift: mitigated by editable command templates and `check()` health reporting.
- Headless permission prompts in agent CLIs: presets pass permission mode and allowlists; users can edit.
- Native dependency install failures (`better-sqlite3`): prebuilt binaries cover macOS, Linux, Windows on Node 20+; verified at Task 22 package check on the development platform only.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Greenfield build. There is no existing behavior to fix; the model of the problem is the approved design document.

Evidence reviewed:

- Design document, implementation plan, installed CLI help output, npm registry versions. No external open-source repositories were used as evidence.

Affected contracts and surfaces:

- New: npm package, `jobtrack` CLI, HTTP API under `/api`, SQLite schema, prompt templates and output schemas, React UI, README.

Existing patterns to reuse:

- None in the repository. Conventions are set by the plan (repository factories `createXRepo(db)`, `RunHandler`, `AgentAdapter`, `MailSource`, `startApp`).

Risk and blast radius:

- No existing users or data. Blast radius is limited to the new package. Security-relevant choices (loopback only, no shell spawning, scoped Gmail prompts) are fixed in the design.

Sensitive data handling plan:

- Development may involve real agent runs against the developer's Gmail. Run logs under `~/.job-applications-tracker/runs/` are never copied into the repository. Test fixtures use invented companies, message ids and addresses. SOW evidence cites file paths and test names only.

Implementation plan:

1. Tasks 1 to 17 of the plan: server, adapter, queue, verification, services, API, bootstrap, CLI.
2. Tasks 18 to 22: UI screens, README, e2e test, package verification.
   Each task: a fresh implementer, then an independent reviewer, then a commit of the task's named files.

Validation plan:

- Per task: the task's tests pass, typecheck passes, reviewer approves.
- End: `npm test`, `npm run build`, e2e test, `npm pack` install check, whole-branch review.
- Same-failure search at close: grep for shell-string spawning, `0.0.0.0`, unvalidated agent output paths.

Artifact impact plan:

- AGENTS.md: update project-specific commands once Task 1 fixes them; add lessons at close.
- Runtime project skills: create `project-*` skills at retrospection for agent adapter testing, run queue, and verification lessons.
- Specs: reconcile `.agents/sow/specs/product-v1.md` with shipped behavior at close.
- End-user/operator docs: README written in Task 22.
- End-user/operator skills: none exist; none expected.
- SOW lifecycle: single SOW; close with `Status: completed` and move to `done/` in the same commit as the final task.

Open-source reference evidence:

- None used. Library behavior was taken from installed CLI help output and package registry metadata, not from mirrored repositories.

Open decisions:

- None. Decisions 1 to 7 resolved below.

## Implications And Decisions

Recorded from the design conversation on 2026-11-05.

1. Agent integration: D, adapter interface with a CLI adapter first (presets Claude Code, Codex, custom). API adapter deferred.
2. Gmail access: B, the agent reads Gmail with its own tools behind a `MailSource` interface. OAuth and IMAP deferred.
3. Job discovery: C, agent web search plus app-side link verification and dedupe. Structured feeds deferred.
4. Stack: A, Node 20+, TypeScript, Hono, better-sqlite3, React + Vite.
5. Status updates from email: B, proposals confirmed by the user.
6. v1 scope: A, both discovery and Gmail sync in v1 (user overrode the recommendation of B).
7. Agent without a Gmail tool: B, self-reported `mail_access` capability and a documented setup step for non-Claude adapters.

Author calls recorded in the design doc: 403/429/999/5xx/timeout classified `unverified` and shown; `no_response` user-set only; `saved` status with a Save action; Claude preset uses `stream-json` for live logs. Plan-level deviation: no `config.json`, port stored in settings.

Execution approach chosen by the user: delegated, task by task (fresh implementer and independent reviewer per task).

Implementation ruling (assistant, 2026-11-05, Task 1 review): Node floor raised from 20 to 22. Evidence: `npm view better-sqlite3@13.0.3 engines.node` is `>=22`; vitest 5 and tsup 9 require 22+; Node 20 reached end of life in April 2026. Alternative rejected: pinning better-sqlite3 12 and older toolchains to keep an end-of-life runtime. Cost if wrong: users on Node 20 must upgrade Node. Design doc, plan, and spec amended with the same note; user to confirm or revert.

## Plan

Follows `docs/superpowers/plans/2026-11-05-job-applications-tracker.md` task by task. Task status is tracked by the plan's checkboxes and by the Execution Log below.

## Execution Log

### 2026-11-05

- Bootstrapped SOW framework: `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` symlinks, `.agents/sow/` layout, `.agents/sow/specs/product-v1.md`, this SOW.
- Decision recorded: no runtime project skills yet (empty project, no observed conventions); create at retrospection.
- Tasks 1 to 8 implemented and reviewed (scaffold, data dir, schema, repositories, schemas and prompts). Rulings: Node floor 22 (better-sqlite3 13, vitest 5, tsup 9 require it; Node 20 end of life); UUID string ids (Task 3 had used integers against the plan's constraint).

### 2026-11-06

- Tasks 9 to 22 implemented and reviewed. Rulings: JSON extraction never falls back to an earlier object; `runs.started_at`/`prompt_version` nullable; API request guard (Host allow-list, Origin on writes, JSON Content-Type) after the Task 15 review found the design's "only client is the local browser" premise wrong; `uiDir` only `<packageRoot>/dist/ui`; Setup Gmail link to the npm package page.
- Fix rounds: Task 1 (engines), Task 9 (spawn rejection, extraction), Task 13 (in-batch duplicate findings), Task 15 (guard), Task 18 (client types).
- Commit history rewritten (messages only, trees identical, backup ref `refs/backup/pre-trailer-strip`) to remove tool-added co-author trailers that violated the repository's commit-message rule; branch had no upstream.
- Final whole-branch review: 1 Critical (custom adapter not selectable), 7 Important. Fix wave commits `1eaad56`, `af10ce4`, `6917bb7`, `344716f`, `72df305`: custom adapter always listed; pre-run adapter check → 422; purge removes run directories; POSIX process-group kill; sync prompt defines ids (version 2); README wording; `runs.adapter_id`; non-http(s) agent URLs dropped; manual applications default to `applied` with server-side date; Jobs screen shows agent errors.
- Retrospection: project skills `project-agent-adapter`, `project-testing`, `project-local-api` created; `AGENTS.md` skills index and commands updated; product spec reconciled; design doc sections 3 and 8 amended; pending SOW-0002..0005 created for deferred work and user decisions.

## Validation

Acceptance criteria evidence:

- Tarball install check (Task 22, output in commit `efc0eea` body): `npx jobtrack --no-open --data-dir ./data --port 0` printed the running URL and data directory; `/api/health` returned `{"ok":true,"version":"0.1.0",...}`; SIGTERM exit 0.
- End-to-end test `test/e2e/discovery-flow.test.ts`: custom adapter → discovery → two verified jobs → mark applied → sync → one proposal → accept → status `interview` with one `proposal` history row. Passes.
- Every plan task has a reviewed commit on the branch (ledger in `.superpowers/sdd/2026-11-05-job-applications-tracker/progress.md`, git-ignored scratch).

Tests or equivalent validation:

- Controller-run on 2026-11-06 at HEAD `72df305`: `npm test` → Test Files 43 passed, Tests 273 passed; `npm run typecheck` exit 0; `npm run build` success (tsup + vite).

Real-use evidence:

- Packaged install and health check (above). A real discovery or sync run with Claude Code or Codex against the developer's own agent has NOT been performed; recorded as a precondition in SOW-0004 before publishing.

Reviewer findings:

- One task reviewer per task (22) plus scoped re-reviews after 5 fix rounds; final whole-branch review on the most capable model; one re-review of the fix wave. All Critical/Important findings fixed; the one regression introduced by the fix wave (Jobs screen 422 mapping) fixed in `72df305` and verified by the controller-run suite.

Same-failure scan:

- `grep -rn "shell: true\|0.0.0.0" src bin` → none. Unvalidated agent output paths: every adapter result goes through `safeParse` in `discovery.ts` and `agent-source.ts`. Attribution trailers: `git log --format=%B | grep -ci co-authored` → 0.

Sensitive data gate:

- Fixtures, tests, docs and this SOW use invented companies, addresses at `example.com`, message ids like `msg-001`. No run logs copied. `.tmp/` and `dist/` git-ignored. Audit script clean.

Artifact maintenance gate:

- AGENTS.md: updated (skills index, commands).
- Runtime project skills: created `.agents/skills/project-agent-adapter/`, `project-testing/`, `project-local-api/`.
- Specs: `.agents/sow/specs/product-v1.md` reconciled with shipped behavior.
- End-user/operator docs: `README.md` written (Task 22) and corrected (fix wave).
- End-user/operator skills: none exist in this repository.
- SOW lifecycle: this SOW `completed` and moved to `done/` in the same commit as the retrospection artifacts; deferred work in SOW-0002..0005.

Specs update:

- `product-v1.md` updated: UUID ids, no `config.json`, API guard, custom adapter always offered, 422 on missing agent, process-group kill, purge semantics, nullable run fields, Windows caveat.

Project skills update:

- Three skills created (above), each with evidence pointers to files and this SOW.

End-user/operator docs update:

- README sections Install, First run, Discovery, Gmail sync, Gmail access for other agents, Security, Data and logs, Command line, Known limitations, Development.

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- Put every Global Constraint into every dispatch: Task 3 deviated (integer ids) because the id rule was not in its brief, costing a conversion in Task 5.
- Reviewers caught two design-level gaps the spec got wrong (cross-site API access, Node 20 end of life): treat "only the local browser can reach it" as false by default for loopback servers.
- Tooling can append co-author trailers to commits unless explicitly forbidden in each delegated brief; check `git log --format=%B` before the final review.
- A fix wave can introduce regressions in callers of changed status codes; grep for the status code in the UI when a server error mapping changes.

Follow-up mapping:

- Windows `.cmd` shims → SOW-0002 (user decision).
- Sign-in probe → SOW-0003 (user decision).
- License, package metadata, real preset smoke runs → SOW-0004 (user decision).
- All accepted-but-deferred reviewer minors → SOW-0005.
- Rejected: `config.json` (port lives in settings; no need), extraction fallback (unsafe), `--` before the codex prompt (unverified flag; folded into SOW-0005 verification list).

## Outcome

v1 delivered on branch `Initial-implementation`: npm package `job-applications-tracker` 0.1.0 with the `jobtrack` CLI, loopback-only Hono API with request guard, SQLite persistence, CLI agent adapter (Claude Code, Codex, custom), persisted run queue with SSE logs, link verification and dedupe, proposal-based Gmail sync, React UI (Setup, Profile, Jobs, Runs, Applications, Review, Settings, Dashboard), README, 273 tests. Not yet merged, published, or smoke-tested with a real agent.

## Lessons Extracted

See Validation → Lessons; captured in the three project skills.

## Followup

Design section 12 items (API adapter, OAuth/IMAP mail sources, structured job feeds, OS-level scheduling, CSV export, multiple profiles) are v2 scope by the approved design and are not tracked as SOWs until the user requests them. Implementation follow-ups: SOW-0002, SOW-0003, SOW-0004, SOW-0005 in `.agents/sow/pending/`.

## Regression Log

None yet.
