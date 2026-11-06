# SOW-0008 - Keep discovery runs inside their time budget

## Status

Status: completed

Sub-state: shipped; discovery completes inside the default timeout on the user's profile.

## Requirements

### Purpose

The first real discovery run with Claude Code (after SOW-0007) timed out after 10 minutes without returning any JSON. Make discovery runs finish within the budget and return a usable list.

### User Request

User reported "Last agent run failed" and asked for logs. After the analysis the user approved the recommended set: (1) a one-off baseline rerun with a 30-minute timeout, (2) a prompt change that tells the agent its budget and that the app verifies links, (3) hardening of the Claude Code preset so the agent session is predictable and cannot fan out to subagents. Option (4), raising the default timeout, was not approved.

### Assistant Understanding

Facts:

- Run `506eeff5…` (invented-free id from the user's own data dir) ended with `Timed out after 600000 ms`. Its log holds 40 `WebSearch`, 168 `WebFetch` and 14 `Agent` (web-fetch subagent) calls and no result event. The agent spent the run verifying each posting's open/closed state, paginating boards and calling ATS JSON APIs.
- `prompts/discover_jobs.md` v1 gives no time budget and does not say that the app verifies links itself (`src/server/verify/links.ts` does).
- The Claude preset (`src/server/agents/presets.ts`) passes no tool denial and loads whatever settings the cwd implies. The run cwd is `runs/<id>/` under the data dir, so when the data dir is inside a repo the project `CLAUDE.md`, skills and `.mcp.json` load too (seen in the run's init event: project skills and slash commands present).
- Probes on claude 2.1.319 (`.tmp/probe/`): `--bare` → `Not logged in` (keychain reads skipped), not usable. `--setting-sources ""` → no hooks, no MCP servers (Gmail connector gone), not usable for sync. `--setting-sources user --disallowedTools Agent,Task` → Gmail connector present, `Agent`/`Task` absent from the tool list, project settings skipped.
- `run_timeout_ms` is a Settings field (default 600000, UI label "Run timeout (ms)", API bounds 10 s..1 h).
- Baseline experiment: settings patched to 1800000 on the running server and run `b7881023…` queued at 18:57 EET with prompt v1.

Inferences:

- Telling the agent its budget and removing the duplicated verification work should let it answer in a few minutes; the app's verifier then classifies links.
- Denying `Agent`/`Task` is the only hard limit on fan-out available without losing credentials or MCP.

Unknowns:

- Whether the model honours a prose budget reliably. Measured by the validation run.

### Acceptance Criteria

- `prompts/discover_jobs.md` is version 2 and states: time budget, 10..30 jobs, do not open each posting, do not delegate to subagents, the app verifies links. `test/server/tasks/prompts.test.ts` pins version and the key sentences.
- The Claude preset argv contains `--setting-sources user` and `--disallowedTools Agent,Task` for both task kinds; pinned in `test/server/agents/cli-adapter.test.ts`.
- A real discovery run with the new build and a fresh data dir completes with status `completed` and at least one stored job, within 30 minutes.
- `npm test`, `npm run typecheck`, `npm run build` pass.

## Analysis

Sources checked:

- The failed run's log and run dir (read locally; only counts and the error line are recorded here), `prompts/discover_jobs.md`, `src/server/agents/presets.ts`, `src/server/agents/cli-adapter.ts:245`, `src/server/db/settings-repo.ts`, `src/server/api/settings.ts`, `src/ui/pages/SettingsPage.tsx`, `src/server/verify/links.ts`, `test/server/tasks/prompts.test.ts`, `test/server/agents/cli-adapter.test.ts`, design spec lines 95, 148, 188; `claude --help` 2.1.319; probe logs under `.tmp/probe/`.

Current state:

- Discovery with Claude Code cannot finish in 10 minutes on a realistic profile.

Risks:

- `--setting-sources user` still loads the user's hooks and plugins; a slow hook delays every run. Accepted: removing them loses credentials or MCP.
- A user with a project-level `settings.json` that configures Claude (rare for a data dir) loses it; documented in the spec.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The agent has no budget signal and treats "only include openings you actually found" as "verify each one", fanning out to subagents; the 10-minute timeout kills it before it answers. Evidence: tool counts and absent result event in the run log.

Evidence reviewed:

- Listed under Analysis. No mirrored open-source repositories consulted; CLI behaviour established empirically.

Affected contracts and surfaces:

- `prompts/discover_jobs.md` (version 2), `src/server/agents/presets.ts` (Claude argv), tests above, `.agents/skills/project-agent-adapter/SKILL.md`, `.agents/sow/specs/product-v1.md`, README "How discovery works" (verification already documented; add the budget sentence).

Existing patterns to reuse:

- Prompt front matter `version:` and `renderPrompt` tests; preset argv pinned by `buildAdapterConfig` tests; real-CLI probe practice from SOW-0007.

Risk and blast radius:

- Prompt wording only affects what agents are asked; the schema and parsing are unchanged. Preset change is Claude-only. No DB or API change.

Sensitive data handling plan:

- No run log content is copied into durable artifacts; only tool counts, the error line and CLI flag behaviour.

Implementation plan:

1. RED: update `prompts.test.ts` (version 2, key sentences) and add a `buildAdapterConfig` test for the new Claude flags.
2. GREEN: rewrite the Rules section of `prompts/discover_jobs.md`, bump to version 2; add the flags in `presets.ts`.
3. Update skill, spec, README; `npm test`, typecheck, build.
4. Validation run: second server instance on a fresh data dir with the same profile, 30-minute timeout; record outcome.

Validation plan:

- Unit tests; full suite; real-CLI probe already recorded; real discovery run with the new build; same-failure search for other prompts lacking a budget (sync_mail is bounded by the application list; recorded, not changed).

Artifact impact plan:

- AGENTS.md: unaffected.
- Runtime project skills: `project-agent-adapter` (preset flags, bare/setting-sources findings, prompt v2).
- Specs: `product-v1.md` (prompt budget rule, Claude preset flags).
- End-user/operator docs: README discovery section (one sentence on the budget).
- End-user/operator skills: none exist.
- SOW lifecycle: complete and move to `done/` with the work in one commit.

Open-source reference evidence:

- None consulted.

Open decisions:

- Resolved below.

## Implications And Decisions

1. Baseline rerun with 30-minute timeout, no code: approved (user, 2026-11-06). Settings patched on the running server; run queued.
2. Prompt change with budget and no-verification rule: approved.
3. Claude preset hardening: approved as "`--bare` plus deny subagents". Deviation: `--bare` logs the agent out (probe evidence above), so the closest working form is `--setting-sources user --disallowedTools Agent,Task`. Applied under the approved intent (predictable session, no fan-out); flagged to the user in the report.
4. Raise default timeout: not approved at first; reopened and approved under decision 5.
5. Prompt quality vs speed, after the baseline/validation comparison (user, 2026-11-06):
   - A. Verified quality with a bounded budget: about 10 minutes, prefer employer/ATS, may open one page per job to confirm, no subagents, 10..30 jobs; default timeout 20 min. Selected.
   - B. Revert to v1 with hardened preset and 30 min default: rejected, no time guidance.
   - C. Keep the no-fetch v2: rejected, dead links and aggregators.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-06

- Probed `--bare`, `--setting-sources ""`, `--setting-sources user` with `--disallowedTools Agent,Task`; recorded above.
- Patched `run_timeout_ms` to 1800000 on the user's running server and queued baseline run `b7881023…` (prompt v1, old preset).
- RED/GREEN: prompt v2 (Budget section), Claude preset flags, tests; `npm test` 316/316, typecheck and build clean. Skill, spec and README updated.
- Validation run `d1a633ab…` on a fresh data dir (`.tmp/dev2`, same profile, new build), concurrent with the baseline. Both reached status `succeeded` (the queue's terminal word is `succeeded`, not `completed`; the monitor script matched the wrong word and stayed silent).
- Results (counts only; no run content copied):
  - Baseline, prompt v1 + old preset, 30 min timeout: 14 min 40 s, 50 searches, 178 fetches, 14 subagents; 12 jobs, all `ok`, all on employer/ATS hosts; list-price cost about 9.8 USD of usage.
  - Validation, prompt v2 + hardened preset: 1 min 40 s, 8 searches, 0 fetches, 0 subagents; 18 jobs: 0 `ok`, 3 `redirected`, 8 `unverified`, 7 `dead`; mostly aggregator hosts, several with unnamed employers; about 1.8 USD of usage.
- Conclusion: the budget prompt as written trades too much quality for speed. The preset hardening worked as intended (no subagents, no project skills in the session). Decision needed on the prompt; implementation paused pending the user.
- Decision 5 = A. Rewrote the Budget section (prompt stays v2: v2 never shipped in a commit), set `DEFAULT_SETTINGS.run_timeout_ms` to 1200000, updated `prompts.test.ts` and `settings-repo.test.ts`. Test and prompt edits were applied in one step, so RED was not observed separately for the reworded sentences; the earlier RED run covered the version bump and preset flags. `npm test` 316/316, typecheck and build clean.
- Second validation run `ce73caf0…` on `.tmp/dev3` (fresh db, same profile, default 20 min timeout) started 22:59 EET and succeeded at 23:02.
- Drafted SOW-0009 (Jobs page application state) in `pending/` for the user's second decision; not started here.


## Validation

Acceptance criteria evidence:

- Prompt v2 wording and version pinned by `test/server/tasks/prompts.test.ts`; Claude preset flags pinned by `test/server/agents/cli-adapter.test.ts`; default timeout pinned by `test/server/db/settings-repo.test.ts`.
- Real run with the final prompt, hardened preset and default timeout (`ce73caf0…`, fresh data dir): status `succeeded` after 3 min 22 s; 23 searches, 36 fetches, 0 subagents, 62 turns; stored 10 jobs: 6 `ok`, 1 `redirected`, 3 `unverified`, 0 `dead`; about 3.3 USD list-price usage. Six of the ten are aggregator or board hosts; one is the employer's own page. The agent's notes say most employer ATS links it found were closed, which it checked itself.
- Comparison for the record: no budget (v1, subagents allowed) 14 min 40 s, 12 jobs all `ok` on employer/ATS hosts; no-fetch v2 1 min 40 s, 18 jobs with 7 `dead`. The shipped wording sits between: no dead links, bounded time, fewer employer-direct hits than the unbounded run. The user chose this trade-off (decision 5A).

Tests or equivalent validation:

- `npm test`: Test Files 45 passed (45), Tests 316 passed (316), no warnings. `npm run typecheck` clean. `npm run build` ok.

Real-use evidence:

- Three real discovery runs on the build machine (baseline on the user's server, two validation runs on fresh data dirs). The user's own server holds the 12 baseline jobs.

Reviewer findings:

- No separate reviewer pass; prompt and flag changes were validated by real runs rather than review. The preset hardening was confirmed from the run's init event (no `Agent`/`Task`, no project skills).

Same-failure scan:

- `prompts/sync_mail.md` has no budget sentence; its work is bounded by the application list and Gmail queries, and no sync run has been observed yet. Left as is; the first real sync run will show whether a budget is needed (tracked with the smoke-run item in SOW-0005).
- `grep -rn "useState<Record<" src/ui/pages`: only `JobsPage.tsx` (SOW-0009 scope).

Sensitive data gate:

- SOW, skill, spec and README carry only counts, durations, cost estimates, flag names and the user-pasted error line. No run log content, mail, URLs or names from the user's data are copied. Company names seen in runs are not recorded.

Artifact maintenance gate:

- AGENTS.md: no update; workflow and guardrails unchanged.
- Runtime project skills: `project-agent-adapter` updated (preset flags and why, prompt budget rule, measured outcomes).
- Specs: `product-v1.md` updated (prompt budget, Claude preset flags, default timeout).
- End-user/operator docs: README updated (discovery section and security section).
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/` in the same commit as the work; SOW-0009 created in `pending/`; SOW-0005 gained the profile round-trip item.

Specs update:

- Done, see above.

Project skills update:

- Done, see above.

End-user/operator docs update:

- README updated.

End-user/operator skills update:

- None exist.

Lessons:

- Prompt budgets need a measured middle: "do not open anything" produced dead links, "no budget" produced a 15-minute run. Record the measurement with the rule (done in the skill).
- Check the real terminal status words before writing a watcher (`succeeded`, not `completed`).
- `--bare` logs the agent out; `--setting-sources ""` removes connectors. Only `user` is safe for this app.
- Probe CLIs with stdin from `/dev/null`.

Follow-up mapping:

- Jobs page application state: tracked in SOW-0009 (pending).
- Profile GET/PUT round-trip: tracked in SOW-0005.
- Sync prompt budget and first real sync run: tracked in SOW-0005 (existing smoke-run item).
- The user's server keeps `run_timeout_ms` at 1800000 from the approved experiment; the user may lower it in Settings. Not a code item.
- `.tmp/dev2`, `.tmp/dev3`, `.tmp/probe`: git-ignored scratch; deletion left to the user.

## Outcome

Discovery with Claude Code completes inside the default timeout on the user's real profile, with a bounded prompt, no subagent fan-out and no project settings leaking into the agent session. Quality sits between the unbounded run and the no-fetch run, as the user chose.

## Lessons Extracted

See Validation > Lessons; recorded in `project-agent-adapter`.

## Followup

- SOW-0009 (Jobs page application state) is next.
- Design-doc deviation recorded: default run timeout is 20 minutes, not the 10 minutes written in the design document line 95; the spec now records 20.

## Regression Log

None yet.
