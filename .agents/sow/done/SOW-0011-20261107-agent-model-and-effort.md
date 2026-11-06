# SOW-0011 - Agent model and effort: show and manage from the UI

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered and committed (2026-11-07).

## Requirements

### Purpose

Let the user see which model and effort level the selected agent CLI uses for discovery and mail sync, and change them from the UI, without editing CLI config files.

### User Request

"Can we indicate to the user the model and the effort, the selected agent uses currently? Can we allow to manage it from the UI?"

### Assistant Understanding

Facts:

- The presets pass no model or effort flag today (`src/server/agents/presets.ts`); the CLI resolves its own default from its config, environment and managed settings, invisible to the app.
- `Settings` (`src/server/domain/types.ts`) and the `runs` table (`src/server/db/migrations.ts`, migration 1) carry no model or effort.
- Probed on 2026-11-07, claude 2.1.319 and codex-cli 0.163.0:
  - Claude: `--model <alias|full id>` (help names aliases `fable`, `opus`, `sonnet`), `--effort low|medium|high|xhigh|max`. The stream-json `system/init` event carries the resolved `model`; no event carries the effort (only `per_turn_effort_active`). No model listing command.
  - Codex: `-m <model>`, `-c key=value` (value parsed as TOML; raw string fallback). `codex debug models` returns JSON `{ models: [{ slug, display_name, default_reasoning_level, supported_reasoning_levels: [{ effort, description }], visibility: list|hide }] }` in about 0.1 s. Levels seen: low, medium, high, xhigh, max, ultra; `ultra` is described as "Maximum reasoning with automatic task delegation". `--json` events carry neither model nor effort.

Inferences:

- `codex debug models` is a debug command with no stability promise; the UI must keep working (free text) when it fails or its shape changes.
- Higher effort lengthens runs; `ultra` delegates to subagents, which SOW-0008 blocks for Claude because fan-out blew the run budget.

Unknowns:

- Whether every Claude model accepts every effort level; an unsupported pair fails at run time and surfaces through the existing run error.

### Acceptance Criteria

- Settings → Agent shows, for the selected claude or codex agent, a model and an effort control per run kind (discover, sync), saved with the Agent section; custom shows "Set in your custom command". Verified by `test/ui/SettingsPage.test.tsx`.
- An empty value means "Agent default" and adds no flag; a value adds `--model`/`--effort` (claude) or `-m`/`-c model_reasoning_effort="<level>"` (codex). Verified by `test/server/agents/cli-adapter.test.ts` (`buildAdapterConfig`).
- Settings PATCH rejects a model that starts with `-` or contains characters outside the allow-list, and an effort that is not a lowercase word. Verified by `test/server/api/settings.test.ts`.
- `GET /api/setup/models` returns suggestions: a static Claude list and the Codex catalog (or an empty list with `available: false` when the probe fails). Verified by `test/server/api/setup.test.ts` and adapter tests.
- Each run records the requested model and effort at the start of the agent call and, for Claude, the model reported by the init event, also for failed runs. Verified by service, queue and e2e tests.
- Run page and Dashboard show model and effort read-only. Verified by UI tests.
- Choosing `xhigh`, `max` or `ultra` shows a warning; `ultra` names the subagent delegation risk. Verified by UI test.

## Analysis

Sources checked:

- `src/server/agents/{presets,types,cli-adapter,extract-json,index}.ts`
- `src/server/api/{settings,setup}.ts`, `src/server/db/{settings-repo,runs-repo,migrations,connection}.ts`
- `src/server/runs/queue.ts`, `src/server/services/{discovery,mail-sync}.ts`, `src/server/mail/{agent-source,types}.ts`, `src/server/index.ts`
- `src/ui/pages/{SettingsPage,DashboardPage,RunPage}.tsx`, `src/ui/components/{AdapterChooser,SettingsSection}.tsx`, `src/ui/api/client.ts`
- `test/fixtures/fake-agent.mjs`, `test/server/agents/cli-adapter.test.ts`
- `.agents/sow/specs/product-v1.md`, design doc, SOW-0005 backlog, SOW-0008
- `claude --help`, `codex exec --help`, `codex debug --help`, trivial real runs of both CLIs (outputs kept in the session scratchpad, not in the repo)

Current state:

- Runs record `adapter_id` only on success (`src/server/runs/queue.ts`, outcome on success).

Risks:

- argv injection: a model value read as a flag (`--dangerously-…`). Mitigated by the server allow-list (no leading `-`) and no-shell spawning.
- Stale suggestions: the Claude alias list is static; free text stays allowed.
- Run budget: high effort can exceed the 20 min timeout; `ultra` delegates to subagents. User chose warn-not-block (decision 5B).

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The user cannot see or choose model/effort because the presets never pass them and the app stores nothing about them. Evidence: `presets.ts` argv, `Settings` type, `runs` schema. The CLIs' own defaults cannot be reliably read (layered config, env, managed settings), so the app shows what it asks for and, where the CLI reports it, what ran.

Evidence reviewed:

- Code and probes listed under Analysis. No external open-source repositories were consulted; the CLIs' own `--help` and output are the authority.

Affected contracts and surfaces:

- Settings keys (8 new), `PATCH /api/settings` validation, new `GET /api/setup/models`, `runs` table (migration 2: `agent_model`, `agent_effort`, `agent_model_reported`), `Run` type, `RunContext`, `MailSyncContext`, `AgentAdapter`/`AgentResult`/`CliAdapterConfig`, preset argv, UI Settings/Run/Dashboard pages, `src/ui/api/client.ts`, spec `product-v1.md`, skill `project-agent-adapter`, README.

Existing patterns to reuse:

- Per-kind settings pattern (`permission_mode_discover`/`_sync`), `SettingsSection` patching, `probe()` in `cli-adapter.ts` (never rejects), `vars` placeholders are not needed (flags appended only when set), fake-agent `echo-argv` and `claude` modes, migration array in `migrations.ts`, `runsRepo.update` allow-list.

Risk and blast radius:

- Migration 2 is additive (nullable columns); existing rows read as NULL ("not recorded"). No data loss.
- Default settings are empty strings, so current behaviour (no flags) is unchanged until the user picks a value.
- Recording run metadata must never fail a run: write errors are logged and swallowed.

Sensitive data handling plan:

- No secrets involved. Probe outputs from the real CLIs stay in the session scratchpad; the SOW and tests use invented model ids (`model-a`) where not a public alias. Model ids named in this SOW come from public CLI help/catalog only.

Implementation plan:

1. Server settings: 8 keys in `Settings`/`DEFAULT_SETTINGS`, zod allow-list in `api/settings.ts`.
2. Presets: append model/effort flags; expose requested `model`/`effort` on the adapter; `modelsArgv` for codex; static claude catalog; `listModels()` on the adapter (never rejects); `reportedModel` on `AgentResult` from the Claude init event.
3. Runs: migration 2, `Run` type, `runsRepo` PATCHABLE, `RunContext.recordAgent`, queue implementation; discovery and agent mail source record before and after the agent call.
4. API: `GET /api/setup/models`.
5. UI: client functions, `AgentModelFields` component in Settings → Agent, warnings, Run page and Dashboard read-only display.
6. Docs: spec, skill, README.

Validation plan:

- RED/GREEN vitest per chunk; `npm test`, `npm run typecheck`, `npm run build`.
- Real-use: sandbox app, set a Claude model/effort, run a trivial probe of the built argv against the real CLIs (`claude -p --model … --effort …`, `codex exec -m … -c model_reasoning_effort=…` plain mode banner), and check `GET /api/setup/models` against the real codex.
- Independent reviewer pass on the diff.
- Same-failure scan: `grep -rn "shell: true\|exec(" src/server`; grep for other places that build agent argv.

Artifact impact plan:

- AGENTS.md: no change expected (no workflow or guardrail change).
- Runtime project skills: `project-agent-adapter` (new flags, catalog probe, reported model, versions verified).
- Specs: `product-v1.md` (settings, run record, setup models endpoint, UI).
- End-user/operator docs: README settings section.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW; close to `done/` in the same commit as the work.

Open-source reference evidence:

- None checked; the behaviour depends only on the installed CLIs, verified by direct probes.

Open decisions:

- All resolved, see below.

## Implications And Decisions

User decisions (2026-11-07):

1. Display source → **A**: show what the app passes, or "Agent default" when nothing is set; do not read CLI config files.
2. Per-run record → **C**: record requested model and effort; also record the model Claude reports in its init event.
3. Granularity → **B**: per agent and per run kind (8 keys).
4. Controls → **A**: model is free text with suggestions (Codex from `codex debug models`, Claude a static alias list); effort is a select with "Agent default" plus levels (Codex: levels the chosen model supports when known).
5. Effort guardrail → **B**: allow every level, show a warning.
6. Placement → **A**: controls in Settings → Agent; read-only on the Run page and the Dashboard; Setup unchanged.

Implementation details derived from the decisions (reported to the user with the result):

- Keys: `claude_model_discover`, `claude_model_sync`, `claude_effort_discover`, `claude_effort_sync`, `codex_model_discover`, `codex_model_sync`, `codex_effort_discover`, `codex_effort_sync`; default `''` = agent default.
- Validation: model `^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,99}$` or empty; effort `^[a-z]{1,20}$` or empty. Effort is a pattern, not an enum, so new Codex levels need no release.
- Codex effort flag: `-c model_reasoning_effort="<level>"` (quoted TOML string; quotes are literal argv characters, no shell).
- Static Claude suggestions: `fable`, `opus`, `sonnet` (the aliases `claude --help` names); efforts low, medium, high, xhigh, max.
- Run columns: `agent_model`, `agent_effort` (`''` = agent default, NULL = not recorded: older runs, custom agent, run that never reached the agent) and `agent_model_reported` (Claude only).
- Warning levels: `xhigh`, `max`, `ultra` ("slower runs; may hit the run timeout"); `ultra` adds "delegates to subagents, which the discovery budget avoids".
- Dashboard: a new "Agent" card listing, per run kind, the selected agent, model and effort ("Agent default" when unset; "model and effort set in your custom command" for custom), with a link to Settings.
- Run page: Agent, Model (plus "ran as <reported>" when Claude reported one) and Effort. Values not yet recorded read "Pending" while the run is queued or running and "Not recorded" afterwards; the page re-fetches the run once when the "Using adapter" log line arrives. Custom runs read "Set in your custom command".
- Effort select: when the catalog knows the chosen model and it does not list the saved level, the level stays selected and a hint says "<model> does not list <level>; the run may fail."

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- SOW created with decisions recorded.
- Server: 8 settings keys and zod patterns (`api/settings.ts`); preset flags and `selectionFor` re-validation (`presets.ts`); `listModels()`, `reportedModel` (`cli-adapter.ts`, `extract-json.ts`, new `model-catalog.ts`); migration 2; `RunContext.recordAgent` (`queue.ts`), `requestedAgent`/`reportedAgent` (new `runs/agent-record.ts`) used by `discovery.ts` and `mail/agent-source.ts`; `GET /api/setup/models` (`api/setup.ts`).
- `ModelCatalog`/`ModelOption` live in `domain/types.ts` (re-exported from `agents/types.ts`) because the UI imports them and `agents/types.ts` pulls Node-only types through `resolve-command.ts`.
- UI: `AgentModelFields` in Settings → Agent; `agent-choices.ts` helpers; Run page and Dashboard display.
- Process note: server chunks were RED-then-GREEN; the first batch of UI tests and the setup-models tests were written before the implementation but not run separately before it, so their RED step was not observed. The review-fix tests below were observed RED first.
- Independent review (general-purpose subagent, read-only) and fixes, see Validation.

## Validation

Acceptance criteria evidence:

- Settings controls per kind, save with Agent section, custom message: `test/ui/SettingsPage.test.tsx` (`SettingsPage model and effort` block, 9 tests).
- Flags only when set; claude/codex spellings; refusal of flag-like stored values: `test/server/agents/cli-adapter.test.ts` (`buildAdapterConfig`).
- PATCH validation (leading `-`, space, quote, length, uppercase effort, quoted effort): `test/server/api/settings.test.ts`.
- `GET /api/setup/models` shape, isolation when one adapter throws: `test/server/api/setup.test.ts`; catalog parse, hidden-model skip, pattern filtering, unavailable paths: `cli-adapter.test.ts` (`createCliAdapter listModels`).
- Run recording before/after the agent call, also on failure, and never failing the run: `test/server/runs/queue.test.ts`, `test/server/services/discovery.test.ts`, `test/server/mail/agent-source.test.ts`, `test/server/services/mail-sync.test.ts`; custom command records NULLs end to end: `test/e2e/discovery-flow.test.ts`.
- Run page and Dashboard display, live-run "Pending" and refresh: `test/ui/RunPage.test.tsx`, `test/ui/DashboardPage.test.tsx`.
- Warnings for `xhigh`/`max`/`ultra` and unsupported level hint: `test/ui/SettingsPage.test.tsx`.

Tests or equivalent validation:

- `npm test`: `Test Files  47 passed (47)`, `Tests  386 passed (386)`; no stderr, act or React warnings.
- `npm run typecheck`: clean (server and UI).
- `npm run build`: clean.
- Migration upgrade from a version-1 database with an existing run: `test/server/db/migrations.test.ts`.

Real-use evidence (2026-11-07, claude 2.1.319, codex-cli 0.163.0, throwaway data dir `.tmp/sow11`):

- Built app (`node bin/jobtrack.js --no-open --port 0 --data-dir .tmp/sow11/data`): `GET /api/setup/models` returned the static Claude list and the real Codex catalog (8 listed models, efforts low..ultra); PATCH with `claude_model_discover: "--bare"` returned 400 `Invalid model id`; a valid PATCH stored all keys; `PRAGMA table_info(runs)` showed the three new nullable columns.
- Real adapter runs through `createAdapter` with a trivial strict schema: Claude with `--model sonnet --effort low` returned structured output and `reportedModel` `claude-sonnet-5-5` (the user's configured default is a different model, so the override took effect). Codex with `-m <listed model> -c model_reasoning_effort="low"` returned structured output; the same override in codex plain mode printed `reasoning effort: low` while the user's config sets a different level.
- Browser (Chrome): Settings → Agent showed saved claude values, switching to codex showed codex's own saved values and datalist suggestions, choosing `ultra` showed the subagent warning in the warning colour; no console errors. The Dashboard Agent card was not seen live because a fresh data dir without a profile redirects to Profile (existing behaviour); it is covered by UI tests.
- A full discovery or sync run with a non-default model was not run (cost and duration); argv and reported-model paths are proven by the trivial runs above.

Reviewer findings (independent read-only subagent review of the full diff):

1. Run page showed "Not recorded" during a live run: fixed ("Pending" while queued/running, one re-fetch on the "Using adapter" line); test added.
2. Saved effort unsupported by the newly chosen model gave no hint: fixed (hint text); test added.
3. Catalog entries could fail the settings patterns and be unsaveable: fixed (filtered in `parseCodexModelCatalog`); test added.
4. A bad stored value (only via direct DB edits) makes that agent's status and catalog unavailable: rejected; the API cannot store such a value, and the 422/"Invalid model setting" message names the problem.
5. Without a catalog the codex effort select offers only low..max: accepted as a known limit of decision 4A (select, not free text); the catalog loads in about 0.1 s on a normal install.
6. Init-model scan read all of stdout when no init event exists: fixed (first 20 lines); test added.
7. Wording differed from the SOW: SOW and UI aligned ("Agent default", "Set in your custom command").
8. Skill cited Validation evidence not yet recorded: recorded here.
9. Tests: setup test now proves the other catalog survives; added queue test for a failing `recordAgent` write; added migration upgrade test. End-to-end preset wiring is not covered by e2e because preset argv0 is fixed to the real CLI; covered by unit tests per hop plus the real-use runs above.

Same-failure scan:

- `grep -rn "shell: true\|exec(" src/server`: only regex `.exec` and SQLite `db.exec`; no shell spawning.
- `grep -rn "0.0.0.0" src bin`: nothing.
- Other argv builders: none outside `src/server/agents/` (reviewer confirmed). Other `Run`/`Settings`/`RunContext`/`AgentAdapter` constructions: all updated (typecheck).

Sensitive data gate:

- No secrets, accounts or personal data in durable artifacts. Probe outputs stayed in the session scratchpad. Tests use invented ids (`model-a`, `model-b`, `msg-001`, `example.com`). Model ids named in docs come from public CLI help and the public catalog command.

Artifact maintenance gate:

- AGENTS.md: no update; no workflow, guardrail or command changed.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` updated (flags, re-validation, reported model, catalog probe, recording order, fixture modes). `project-local-api`: no update; the new route is a GET under the existing guard (its update rule covers state-changing routes). `project-testing`: no update; no new harness pattern beyond the `catalogFor` field, which follows the existing `healthFor` pattern.
- Specs: `.agents/sow/specs/product-v1.md` updated (Agent integration, Runs, User interface).
- End-user/operator docs: `README.md` new "Model and effort" section.
- End-user/operator skills: none exist in this project.
- SOW lifecycle: single SOW; set `completed` and moved to `done/` in the same commit as the work.

Specs update:

- `product-v1.md`: settings keys and patterns, flags, catalog endpoint, run columns and recording, UI placement.

Project skills update:

- `project-agent-adapter` as above.

End-user/operator docs update:

- `README.md` "Model and effort".

End-user/operator skills update:

- None exist (`AGENTS.md` lists no output/reference skills).

Lessons:

- Claude reports the resolved model but not the effort; Codex `--json` reports neither. Anything the UI claims about "what ran" must come from agent output, not from settings.
- A live run's metadata appears after the first fetch; UI labels for missing values must distinguish "not yet" from "never".

Follow-up mapping:

- Reviewer item 4: rejected with reason above.
- Reviewer item 5: accepted known limit of decision 4A; no tracking needed unless the user wants free-text effort.
- Full discovery/sync run with a non-default model: not a deferred task of this SOW; the adapter skill already tracks that no full real run has been recorded.

## Outcome

Users can choose model and effort per agent and run kind in Settings → Agent, see the choice on the Dashboard, and see per run what was asked for and (Claude) which model ran. Defaults are unchanged: with every field on "Agent default" no flag is passed.

## Lessons Extracted

- Recorded in Validation → Lessons; the durable parts (what each CLI reports, recording order) are in `project-agent-adapter`.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
