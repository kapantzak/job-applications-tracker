# SOW-0001 - Initial implementation of the job applications tracker

## Status

Status: in-progress

Sub-state: SOW framework bootstrapped; implementation plan approved; execution starting at Task 1 of 22.

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
   Each task: implementer subagent, then reviewer subagent, then commit of the task's named files.

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

Execution approach chosen by the user: subagent-driven (fresh implementer and reviewer per task).

## Plan

Follows `docs/superpowers/plans/2026-11-05-job-applications-tracker.md` task by task. Task status is tracked by the plan's checkboxes and by the Execution Log below.

## Execution Log

### 2026-11-05

- Bootstrapped SOW framework: `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` symlinks, `.agents/sow/` layout, `.agents/sow/specs/product-v1.md`, this SOW.
- Decision recorded: no runtime project skills yet (empty project, no observed conventions); create at retrospection.

## Validation

Filled at close per the Validation Gate. Items marked "pending" are not yet evidenced.

Acceptance criteria evidence:

- pending (tarball install check, e2e test, test/typecheck/build runs, per-task review trail).

Tests or equivalent validation:

- pending (`npm test`, `npm run typecheck`, `npm run build` outputs).

Real-use evidence:

- pending (manual run of `node bin/jobtrack.js --no-open --data-dir .tmp/dev`, one real discovery run with the developer's own agent, logs not copied into the repository).

Reviewer findings:

- pending (per-task reviewer subagents and whole-branch review).

Same-failure scan:

- pending (grep for shell-string spawning, `0.0.0.0`, unvalidated agent output paths).

Sensitive data gate:

- pending (confirm fixtures, docs and SOW use invented companies, message ids and addresses; no run logs copied).

Artifact maintenance gate:

- AGENTS.md: pending (commands section refresh after Task 1; lessons at close).
- Runtime project skills: pending (create `project-*` skills from retrospection lessons).
- Specs: pending (reconcile `.agents/sow/specs/product-v1.md` against shipped behavior).
- End-user/operator docs: pending (README from Task 22).
- End-user/operator skills: none exist in this repository; reconfirm at close.
- SOW lifecycle: pending (close with `Status: completed` and move to `done/` in the final task commit).

Specs update:

- pending.

Project skills update:

- pending.

End-user/operator docs update:

- pending.

End-user/operator skills update:

- none exist; reconfirm at close.

Lessons:

- pending.

Follow-up mapping:

- pending (see Followup section for the deferred list).

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

Deferred by design (tracked here, to be mapped at close): API adapter, OAuth/IMAP mail sources, structured job feeds, OS-level scheduling, CSV export, multiple profiles. At close each becomes a pending SOW or is rejected with reason.

## Regression Log

None yet.
