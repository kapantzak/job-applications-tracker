# SOW-0018 - Keep personal agent instructions out of app runs

## Status

Status: completed

Sub-state: delivered 2026-11-07 and committed with this file's move to `done/`.

## Requirements

### Purpose

App runs should behave the same for every user: the agent should get the app's prompt, not the user's personal instructions for their own coding sessions. Those instructions also cost tokens on every run.

### User Request

"also fix the loading of the personal CLAUDE.md" (2026-11-07, while starting SOW-0017).

### Assistant Understanding

Facts:

- The Claude presets pass `--setting-sources user` (`src/server/agents/presets.ts:106`), which also loads the user's `~/.claude/CLAUDE.md`, the auto-memory index (`MEMORY.md`) and user hooks (a SessionStart hook injected several thousand tokens of an unrelated skill).
- Codex loads `~/.codex/AGENTS.md` (here a link to a personal instructions file) on every run.

Inferences:

- Personal instructions can change how the agent answers (tone, language, refusals, extra steps), which the app's prompts do not expect.

Unknowns:

- None that block the decisions; see Analysis.

### Acceptance Criteria

- Both Claude presets (discovery and sync) pass `--settings` with `claudeMdExcludes: ["**/CLAUDE.md"]`, `disableAllHooks: true` and `autoMemoryEnabled: false`. Verified by argv tests.
- A canary probe with the discovery argv reports no personal CLAUDE.md, auto-memory or hook text; one with the sync argv does the same and still lists the claude.ai Gmail connector tools.
- A real Default discovery run with the new argv returns structured output.
- Codex unchanged; README and `project-agent-adapter` state that Codex runs read `~/.codex/AGENTS.md` and why it is not isolated.

## Analysis

Sources checked:

- `claude --help` (2.1.319): `--settings <file-or-json>`, `--safe-mode`, `--setting-sources`.
- Canary probes (one prompt asking whether personal memory, hook text and MCP tools are present), `claude -p --setting-sources user --disallowedTools Agent,Task --model sonnet`, run 2026-11-07:

  | Flags | Personal CLAUDE.md | Auto-memory | Hook text | MCP tools | Input tokens |
  |---|---|---|---|---|---|
  | Discovery today (`--tools WebFetch --strict-mcp-config`) | yes | yes | yes | 0 | 12,917 |
  | + `--safe-mode` | no | no | no | 0 | 3,636 |
  | + `--settings {"claudeMdExcludes":["**/CLAUDE.md"]}` | no | yes | yes | 0 | 5,878 |
  | + `--settings {"claudeMdExcludes":["**/CLAUDE.md"],"disableAllHooks":true,"autoMemoryEnabled":false}` | no | no | no | 0 | 3,636 |
  | Sync-like (no `--strict-mcp-config`) | not answered | - | - | - | 275,069 (stopped by the $0.30 cap after one turn, $1.14) |
  | Sync-like + `--safe-mode` | no | no | no | 0 (Gmail connector gone) | 3,636 |

- `--safe-mode` also removes MCP servers, so it cannot serve mail sync, which needs the claude.ai Gmail connector.
- Codex 0.163.0 canary (`codex exec --skip-git-repo-check --disable multi_agent --json`): the personal `AGENTS.md` is loaded by default (27,033 input tokens) and with `-c project_doc_max_bytes=0` (22,500); that setting only covers project files. With a separate `CODEX_HOME` holding a link to `auth.json` plus `project_doc_max_bytes=0`, the agent saw no instructions (19,641).
- Codex replaces `auth.json` through a temporary file and a rename when it refreshes sign-in. openai/codex mirror (no commit hash exposed), checked 2026-11-07: `codex-rs/login/src/auth/storage_file.rs:62` (`replacement`). In a separate home, a refresh would replace the link with a new file and leave the user's own Codex home on the old token.

Current state:

- See Facts.

Risks:

- `disableAllHooks` also turns off any user hook that guards tools. App runs only allow WebSearch and WebFetch (discovery) or Gmail read tools (sync), so Bash/Edit guards have nothing to guard there.
- Sync probes without `--strict-mcp-config` cost about $1.14 each because every user MCP server is loaded.

## Pre-Implementation Gate

Status: ready (decisions recorded 2026-11-07).

Problem / root-cause model:

- `--setting-sources user` keeps credentials and connectors but also loads every personal customization; Codex has no switch for its global instructions.

Evidence reviewed:

- Probes above; `src/server/agents/presets.ts`; `project-agent-adapter` skill (SOW-0008 notes on `--bare` and `--setting-sources ""`).

Affected contracts and surfaces:

- `src/server/agents/presets.ts` (Claude argv for both run kinds), `test/server/agents/cli-adapter.test.ts`, `project-agent-adapter` skill, spec `product-v1.md` (agent invocation), README if user-visible behaviour is described.

Existing patterns to reuse:

- `claudeDiscoverFlags` in `presets.ts`; preset argv tests with the fake agent's `echo-argv` mode.

Risk and blast radius:

- Every Claude run. A wrong settings key is ignored silently, so the canary probe is the check; a real Default discovery run and one sync-style probe validate the change.

Sensitive data handling plan:

- Probe outputs stay in git-ignored `.tmp/`. The SOW names section headings only, never the content of the user's personal instructions or the user's name.

Implementation plan:

1. `presets.ts`: a shared `CLAUDE_ISOLATION_SETTINGS` JSON string passed as `--settings` right after `--setting-sources user` for both kinds; comment says why.
2. `test/server/agents/cli-adapter.test.ts`: argv tests for both kinds (parse the JSON, assert the three keys).
3. Canary probes (discovery argv, sync argv) and one real Default discovery run on a throwaway data dir.
4. Docs: `project-agent-adapter` skill (Mandatory Knowledge line on `--setting-sources user` and the Codex limitation), spec agent-invocation text, README agent section.

Validation plan:

- Argv tests; canary probes per run kind; one real Default discovery run.

Artifact impact plan:

- `project-agent-adapter` skill and spec updated; README if behaviour visible to users changes; AGENTS.md unaffected.

Open-source reference evidence:

- openai/codex mirror (no commit hash exposed), `codex-rs/login/src/auth/storage_file.rs:62`, `codex-rs/codex-home/src/instructions/mod.rs:41-84`, `codex-rs/core/src/agents_md.rs:65` (`project_doc_max_bytes` only gates project files).

Open decisions:

- None; see Implications And Decisions.

## Implications And Decisions

User decisions (2026-11-07):

1. Claude scope: B. Stop loading the personal CLAUDE.md, auto-memory and hooks with one `--settings` JSON (`claudeMdExcludes`, `disableAllHooks`, `autoMemoryEnabled`).
2. Run kinds: A. Discovery and mail sync; one sync-style probe (about $1.15) confirms the Gmail connector stays.
3. Codex: A. Unchanged; document that Codex runs read `~/.codex/AGENTS.md` because a separate `CODEX_HOME` risks the user's sign-in.
4. Mail sync loads every user MCP server (about 275k tokens per run): A. Tracked as SOW-0019, after SOW-0018 and SOW-0017.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- Created on user request; probes as in Analysis. Probe spend: about $2.36 reported by Claude (two sync-like probes at $1.14 each) plus small Codex runs.
- Decisions 1B, 2A, 3A, 4A recorded; SOW-0019 created in `pending/`.
- `presets.ts`: `CLAUDE_ISOLATION_SETTINGS` passed as `--settings` after `--setting-sources user` for both kinds. Tests first (RED: 2 failed), then GREEN.
- Canary with the exact app argv (taken from `buildAdapterConfig`, only `--json-schema`/stream-json swapped for plain JSON output), run from a directory outside any repository like the app's run directory:
  - Discovery: memory NO, hooks NO, 0 MCP tools, 3,665 input tokens, $0.008.
  - Sync: memory NO, hooks NO, 76 MCP tools (35 Gmail), 26,747 input tokens, $0.07.
  - Sync with the old argv (no `--settings`), for comparison: memory YES, hooks YES (superpowers and a plugin's session context), about 283 MCP tools including Gmail, 47,042 input tokens, $0.15.
- Correction to the Analysis table: the 275k-token "sync-like" probes used `--tools WebFetch` and no `--allowedTools`, not the app's sync argv. The app's real sync argv started at 47k tokens before this SOW and 27k after. Which flag makes the difference is not established. The MCP tool count also fell from about 283 to 76 with the new settings; the Gmail tools sync needs are present in both, and the cause of the drop is not established.
- Docs: README security paragraph, spec Claude preset text, `project-agent-adapter` skill (setting-sources line and the measured sync context).
- Real runs on the built app, throwaway data dir `.tmp/sow16-validation/data`, invented profile. The first run used that data dir's saved adapter (Codex, from SOW-0016), so it validated nothing here: succeeded, 4 new, 0 dead, 3 min 6 s. Switched the instance to Claude and ran again (below). The instance was started and stopped by PID.

## Validation

Acceptance criteria evidence:

- Argv: `test/server/agents/cli-adapter.test.ts` "claude preset keeps personal CLAUDE.md, auto-memory and hooks out of %s runs" (both kinds; one `--settings`, right after `--setting-sources user`, JSON with the three keys) and "codex preset gets no personal-instruction flags". Written first: 2 failed, then passed.
- Canaries with the exact app argv: discovery and sync both report no personal memory and no hook text; sync still lists the Gmail connector tools (35 Gmail tools). See Execution Log.
- Real Default discovery on Claude (claude 2.1.319, model `claude-opus-5-5` per the init event): succeeded in 4 min 9 s, 6 new jobs, 2 dead (both `jobs.ashbyhq.com`, reported to SOW-0017), reported estimate $1.31, 1.48M input tokens including cache reads, 61 turns. The init event listed only `StructuredOutput`, `WebFetch`, `WebSearch` and 0 MCP servers. The run is not a cost comparison with SOW-0016: the profile already holds earlier jobs, which the prompt excludes.
- Codex: unchanged; README and skill state why.

Tests:

- `npm test`: `Test Files  54 passed (54)`, `Tests  636 passed (636)`. `npm run typecheck` clean. `npm run build` passes (same chunk-size warning as before).

Real-use evidence:

- Above. No real sync run: the sync canary covered the argv change, and a real sync reads the user's mail.

Reviewer findings:

- No separate reviewer pass: a one-constant argv change covered by tests, canaries and a real run.

Same-failure search:

- `grep -rn "setting-sources" src/` lists only the Claude preset; the custom adapter passes the user's own command untouched by design.

Sensitive data gate:

- The SOW, skill, spec and README name section headings, flags, token counts and costs only. No personal instruction text, names, credentials or private endpoints. Probe outputs, which contain the agent's answers, stay in git-ignored `.tmp/sow18-probes/`.

Artifact maintenance gate:

- `AGENTS.md`: unaffected (no workflow change).
- Runtime project skills: `project-agent-adapter` updated.
- Specs: `product-v1.md` Claude preset text updated.
- End-user/operator docs: README security paragraph updated (what the app leaves out, and the Codex limitation).
- End-user/operator skills: none exist.
- SOW lifecycle: this SOW completed and moved to `done/`; SOW-0017 paused in `current/`; SOW-0019 open in `pending/`.

Spec update: see above.

Project skill update: see above.

Lessons:

- Personal agent configuration leaks into headless runs through `--setting-sources user`; check with a canary prompt, because wrong settings keys fail silently.
- Measure token cost with the exact app argv. A probe with different flags (`--tools` without `--allowedTools`) loaded 275k tokens where the app's sync argv loads 47k.

Follow-up mapping:

- SOW-0019 (sync MCP context): open in `pending/`. Its premise came from the 275k probe; the app's sync argv now starts at 27k tokens. Raised with the user to decide whether to keep or close it.
- SOW-0017: the Default Claude run above returned 2 dead Ashby links of 5, which weakens the evidence behind its decision 2A (Max worker only). Raised with the user.

## Outcome

- Claude runs of both kinds no longer load the user's personal CLAUDE.md, auto-memory or hooks. Discovery starts at about 3.7k tokens instead of 12.9k; sync at about 27k instead of 47k on the test machine. Codex is unchanged and documented.

## Lessons Extracted

- See Validation → Lessons; both are recorded in `project-agent-adapter`.

## Followup

- SOW-0019 (pending; premise to be confirmed by the user).
- SOW-0017 (paused; decision 2A to be revisited by the user).

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
