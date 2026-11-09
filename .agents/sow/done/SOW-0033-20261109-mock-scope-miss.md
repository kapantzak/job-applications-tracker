# SOW-0033 - Mock sandbox: a profile whose Gmail scope matches nothing

## Status

Status: completed

Sub-state: implemented and validated; committed on `sync-gmail` (PR #26).

## Requirements

### Purpose

Let the user see the SOW-0032 "the Gmail scope matched no mail" result in `npm run sandbox:mock`, which today cannot produce it.

### User Request

"do the mock agent zero-count option too" (2026-11-09), then decisions 1B and 2A below.

### Assistant Understanding

Facts:

- `scripts/sandbox-mock/mock-agent.mjs` reports `scope_message_count` as the number of applications in the prompt, or null without a scope; `src/server/services/mail-sync.ts` returns before calling the agent when a profile has no open applications, so the count is never 0 in the sandbox.
- The seed (`scripts/sandbox-mock/seed.ts`) has three profiles: rich (label `Jobs/Frontend`), sparse (custom search) and empty (no applications).

Inferences:

- A mock that reports 0 should also find nothing, so its findings for that run are all `no_change`.

Unknowns:

- None.

### Acceptance Criteria

- The sandbox seeds a fourth profile, "Scope Miss", with open applications and the label `NoMatch`; its Sync ends "0 proposals created, 0 skipped; the Gmail scope matched no mail". Verified by seed and mock-agent tests and a sandbox run.

## Analysis

Sources checked:

- `scripts/sandbox-mock/seed.ts`, `scripts/sandbox-mock/mock-agent.mjs`, `test/server/sandbox-mock/*.test.ts`, README sandbox paragraph, `src/server/mail/agent-source.ts` (`renderScope` text the mock reads).

Current state:

- See Facts.

Risks:

- The mock reads the rendered prompt; a wording change in `renderScope` could break detection. `mock-agent.test.ts` goes through the real mail source, so drift fails a test.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The mock's count equals the application count and sync never runs without applications, so the zero path is unreachable in the sandbox.

Evidence reviewed:

- Files under Analysis; SOW-0032 Validation (reviewer item 6).

Affected contracts and surfaces:

- Sandbox seed data and its banner, mock agent output, sandbox tests, README sandbox paragraph. No app code, API, schema or prompt change.

Existing patterns to reuse:

- `APPS` and `profileInputs` tables in `seed.ts`; the mock's prompt parsing of application lines.

Risk and blast radius:

- Sandbox only; `npm run sandbox:mock` reseeds on every start.

Sensitive data handling plan:

- Invented company names and `example.com` domains only.

Implementation plan:

1. Mock: count 0 and all `no_change` findings when the Mailbox scope section contains `nomatch` (any case).
2. Seed: profile "Scope Miss" (label `NoMatch`) with two open applications; add it to the summary.
3. Tests, README, sandbox run.

Validation plan:

- `npx vitest run test/server/sandbox-mock`, `npm run typecheck`, `npm test`; `npm run sandbox:mock` and a Sync on Scope Miss.

Artifact impact plan:

- AGENTS.md: unaffected; the sandbox command and its drift rule are unchanged.
- Runtime project skills: `project-testing` describes the sandbox tests generically; unaffected.
- Specs: the spec does not describe the seed data; unaffected.
- End-user/operator docs: README sandbox paragraph.
- End-user/operator skills: none exist.
- SOW lifecycle: moves to `done/` in its commit.

Open-source reference evidence:

- None; repository-local.

Open decisions:

- Resolved below.

## Implications And Decisions

Decided by the user on 2026-11-09:

1. (1B) A fourth seeded profile with open applications and the label `NoMatch`, so the warning shows on its first sync. The mock reports 0 when the scope contains `nomatch`, which is what that profile triggers.
2. (2A) A third commit on `sync-gmail`, in PR #26.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-09

- Decisions recorded.
- `mock-agent.mjs` reads the Mailbox scope section; `nomatch` in it gives count 0 and `no_change` findings. `seed.ts` adds "Scope Miss" (label `NoMatch`, two open applications at invented companies) and lists it in the banner. Tests and README updated.
- Self-review of the diff, not a subagent: the change is about 40 lines and sandbox-only.

## Validation

Acceptance criteria evidence:

- `test/server/sandbox-mock/seed.test.ts`: four profiles, Scope Miss has two open applications, its scope is label `NoMatch`.
- `test/server/sandbox-mock/mock-agent.test.ts`: through the real mail source, `label:NoMatch` gives count 0 and all `no_change`; other scopes and no scope keep their earlier counts.

Tests or equivalent validation:

- `npm run typecheck`: clean. `npm test`: `Test Files  70 passed (70)`, `Tests  988 passed (988)`.

Real-use evidence:

- `npm run sandbox:mock`: the banner lists "Scope Miss"; its Sync succeeded with "0 proposals created, 0 skipped; the Gmail scope matched no mail"; the Run page showed the warning line in the warning tone and the summary muted.

Reviewer findings:

- Self-review: if a prompt wording change broke the section regex, an unscoped run would report a count instead of null. That is harmless, because the handler ignores the count without a scope, and the mock-agent null test runs through the real prompt, so drift fails there. No change.

Same-failure scan:

- `grep -rn "No scope is set" scripts src`: the mock and `agent-source.ts` agree on the wording.

Sensitive data gate:

- Invented companies (Hooli Devices, Massive Dynamic) and `example.com` domains only. `bash .agents/sow/audit.sh` clean.

Artifact maintenance gate:

- AGENTS.md: unaffected; the `sandbox:mock` command and its drift rule are unchanged.
- Runtime project skills: `project-testing` describes the sandbox tests without listing seed contents; unaffected.
- Specs: `product-v1.md` does not describe the sandbox seed; unaffected.
- End-user/operator docs: README sandbox paragraph updated.
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/` in its commit.

Specs update:

- None needed; see above.

Project skills update:

- None needed; see above.

End-user/operator docs update:

- `README.md`.

End-user/operator skills update:

- None exist.

Lessons:

- None new; the existing sandbox drift tests covered the prompt dependency.

Follow-up mapping:

- None.

## Outcome

`npm run sandbox:mock` now shows a profile whose Gmail scope matches no mail, and its sync result carries the warning.

## Lessons Extracted

None beyond the Validation note.

## Followup

None.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
