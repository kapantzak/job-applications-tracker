# SOW-0021 - PR #11 review fixes

## Status

Status: completed

Sub-state: delivered 2026-11-07 on the PR #11 branch and committed with this file's move to `done/`.

## Requirements

### Purpose

Fix what the pre-merge code review of PR #11 found, before the merge.

### User Request

Decision 1A on "is it ready to be merged?": run a code review of the whole PR and one Max search through the app, then merge. On the review: "1.B, 2.A, 3.A".

### Assistant Understanding

Facts (each finding checked against the code, 2026-11-07):

- R1: `src/server/services/discovery.ts` link-checks every returned job before dedupe; Max workers overlap, so one URL is fetched several times in the save phase, which cannot be cancelled.
- R2: `src/server/agents/presets.ts` omits `--tools` when `allowed_tools_discover` has no built-in name, so Claude loads every built-in tool. `claude --help` (2.1.319): `--tools` accepts `""` to disable all built-in tools.
- R3: discovery records the usage of finished workers even when the run fails or is cancelled; `MaxSearchDialog` quotes the last Max run with any usage, so a partial total can appear as "your last Max-effort search". The dialog and README also say a cancelled search "reports nothing", which is not true for a Max run whose other workers finished.
- R4: `src/server/api/runs.ts` comment says the button sends no body; since SOW-0016 the client always sends `{mode}`. The empty-body path stays for other API callers.
- R5: `src/server/runs/queue.ts` comment says "one agent at a time"; a Max run starts up to three. Queue behaviour is by design: other runs, including scheduled syncs, wait behind a Max run.
- C1: `src/ui/format.ts` `compact()` picks the unit before rounding (999,960 shows as "1000.0k"); a cost under half a cent shows as "$0.00".
- C2: `MaxSearchDialog` keeps "Start Max-effort search" disabled when its informational details fail to load.
- U1: Codex `--disable multi_agent` was checked on codex-cli 0.163.0 only.
- U2: `claudeMdExcludes: ["**/CLAUDE.md"]` may not cover `CLAUDE.local.md` or `~/.claude/rules/*.md`; neither exists on the test machine.

Inferences:

- None beyond the decisions.

Unknowns:

- U1 and U2 behaviour on other setups; documented, not changed.

### Acceptance Criteria

- R1: each distinct canonical URL is checked once per run; a test with repeated URLs proves it.
- R2: `--tools ""` when no built-in tool is allowed; preset test updated.
- R3: the dialog quotes only the last Max run that succeeded with no failed workers; wording no longer says a cancelled search reports nothing; README matches.
- R4, R5: comments corrected; README says other runs wait behind a running search.
- C1: values just under a million show as "1.0M"; costs above 0 and under $0.01 show as "<$0.01".
- C2: the Start button works when the details failed to load; the error text stays.
- U1: README and `project-agent-adapter` say Codex runs are tested on codex-cli 0.163.0 or newer.
- U2: `project-agent-adapter` records the exclude pattern's unverified coverage.
- `npm test`, `npm run typecheck`, `npm run build` pass.

## Analysis

Sources checked:

- The review output (10 findings, unverified) and the code lines above.

Current state:

- See Facts.

Risks:

- R1 changes the save path for every discovery run; existing discovery tests and a new repeat-URL test cover it.
- R2 changes argv for users who allow only MCP tools for discovery.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- See Facts; each is a local defect or stale text.

Evidence reviewed:

- Files above; `claude --help` 2.1.319.

Affected contracts and surfaces:

- `discovery.ts`, `presets.ts`, `MaxSearchDialog.tsx`, `format.ts`, `api/runs.ts` comment, `queue.ts` comment, their tests, README, spec, `project-agent-adapter` skill.

Existing patterns to reuse:

- `mapLimit` and the injected `verify` in discovery tests; preset argv tests; `test/ui/format.test.ts`; FindJobsButton and Jobs page dialog tests.

Risk and blast radius:

- Discovery save path (R1) and Claude discovery argv (R2). No schema or API change.

Sensitive data handling plan:

- None involved; invented test data only.

Implementation plan:

1. R1 in `discovery.ts` with a test.
2. R2 in `presets.ts` with the test change.
3. R3 and C2 in `MaxSearchDialog.tsx` with tests; README wording.
4. C1 in `format.ts` with tests.
5. R4, R5 comments; README queue line.
6. U1, U2 docs.

Validation plan:

- Tests first per item; full suite, typecheck, build.

Artifact impact plan:

- README, spec (`--tools` and dialog text), `project-agent-adapter` skill; AGENTS.md unaffected.

Open-source reference evidence:

- None.

Open decisions:

- None.

## Implications And Decisions

User decisions (2026-11-07):

1. B. Fix R1-R5, C1 and C2 before merge, with tests. U3 (Claude output parsed twice) stays an opportunity.
2. A. Document that Codex runs are tested on codex-cli 0.163.0 or newer.
3. A. Record the exclude pattern's unverified coverage in the adapter skill.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- Pre-merge Max search through the app on the user's decision 1A (split button, prompt v4, SOW-0018 flags, Claude, throwaway data dir, invented profile): succeeded in 6 min 42 s, 31 new, 1 dead (`jobs.eu.lever.co`), 5 unverified (`himalayas.app` 4, `weworkremotely.com` 1), 0 dead of 3 Ashby, all 5 workers finished, reported estimate $4.24. The instance was started and stopped by PID.
- Code review of PR #11 (`/code-review high`): 10 findings, each checked against the code (Facts).
- R1: `discovery.ts` checks each distinct canonical URL once (`verdicts` map) and reuses the verdict. Test written first (failed: 4 checks for 2 URLs). My first expected summary was wrong: `dedupeKey` keys on the canonical URL, so the same link with another title is a duplicate; corrected to 2 new, 2 duplicates.
- R2: `presets.ts` always passes `--tools`, empty when no built-in tool is allowed. Test changed first. Probe: `claude -p --tools ""` (2.1.319) ran and reported 0 built-in tools, $0.009.
- R3: `workersFailedNote`/`hasFailedWorkers` in `domain/types.ts` (discovery writes the note, the dialog reads it); the dialog quotes only the last Max run with status `succeeded`, no failed workers and usage; text "Your last complete Max-effort search reported ..." or "No earlier complete Max-effort search to compare with." Tests first (failed), including aborted, failed and partial runs.
- C2: Start enabled when the details failed to load; the error stays visible. Test first.
- C1: `compact()` rounds before choosing the unit; `formatCost` shows `<$0.01` for costs above 0 and under half a cent. Tests first; two of my expected values were wrong (1,959 rounds to 2.0k; 0.005 sits on a float edge) and were corrected.
- R4, R5: comments corrected; README notes that runs go one at a time and that a Max search can hold the queue for about twice the run timeout.
- U1, U2: README (Codex tested on 0.163.0 or newer) and `project-agent-adapter` (exclude coverage unverified; Codex flags verified on 0.163.0).

## Validation

Acceptance criteria evidence:

- R1: `test/server/services/discovery.test.ts` "checks each distinct link once, also when workers return it several times".
- R2: `test/server/agents/cli-adapter.test.ts` "claude discovery turns every built-in tool off when none is allowed"; real CLI probe above.
- R3: `test/ui/JobsPage.test.tsx` "quotes what the last max-effort search used", "quotes only complete max-effort searches, never a cancelled, failed or partial one", "says when there is no complete max-effort search to quote"; README and spec wording.
- C1: `test/ui/format.test.ts` rounding and tiny-cost tests.
- C2: `test/ui/FindJobsButton.test.tsx` "still lets the user start when the warning details fail to load".
- R4, R5, U1, U2: comment and doc diffs.

Tests:

- `npm test` four consecutive runs: `Tests  651 passed (651)` each, `Test Files  55 passed (55)`. `npm run typecheck` clean. `npm run build` passes (same chunk-size warning).

Real-use evidence:

- Pre-merge Max search through the app (Execution Log) ran before these fixes; R1-R3 do not change what the agent does. `--tools ""` probed against the real CLI.

Reviewer findings:

- This SOW handles the review: R1-R5, C1, C2 fixed; U1, U2 documented; U3 (Claude output parsed twice in `usage.ts` and `extract-json.ts`) left as an opportunity by user decision 1B, reported to the user.

Same-failure search:

- `grep -rn "workers failed" src` lists only `domain/types.ts` and the log formatter's summary pattern (`src/ui/log-format.ts`), which already accepts the note. `grep -rn "toFixed(2)" src/ui` lists no other cost formatting.

Sensitive data gate:

- No data involved; invented test data only.

Artifact maintenance gate:

- `AGENTS.md`: unaffected.
- Runtime project skills: `project-agent-adapter` updated (`--tools ""`, exclude coverage, Codex version).
- Specs: `product-v1.md` (`--tools`, dialog quote rule, partial Max usage).
- End-user/operator docs: README (usage wording, queue note, Codex version).
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/`.

Spec update: see above.

Project skill update: see above.

## Outcome

- The review's real findings are fixed with tests; the unverified ones are documented. PR #11 is ready for the user's merge decision.

## Lessons Extracted

- Several earlier SOWs on this branch closed without a separate reviewer pass; the pre-merge review found real defects (R1-R3). A review before merge is worth running for multi-SOW branches.

## Followup

- U3 (parse Claude output once for result and usage): an opportunity reported to the user, not required for this SOW's outcome; rejected for now by user decision 1B.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
