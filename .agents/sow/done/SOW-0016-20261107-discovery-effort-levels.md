# SOW-0016 - Discovery effort levels (Default and Max effort)

## Status

Status: completed

Sub-state: delivered and committed with this file's move to `done/` (2026-11-07).

## Requirements

### Purpose

Give the user two discovery modes (GitHub issue #6, "Multiple levels of investigation effort"):

1. Default job search: balance result quality and token consumption, no sub-agents.
2. Max-effort job search: use whatever achieves a great result, with a warning that it may exhaust the user's agent quota.

### User Request

Issue #6: "Introduce a high-effort investigation run, that probably spawns subagents and has a big timeout window. Users should be warned that this kind of investigation may exhaust their tokens. Maybe use different skills."

The user asked (2026-11-07) for web research on how others search job openings: efficient steps, quality guards, guards against large token consumption, reusable skills or instructions. The answers were to shape the two modes.

### Assistant Understanding

Facts:

- Discovery is one agent run per click of "Find jobs" (`src/ui/pages/JobsPage.tsx:95`, `POST /api/profiles/:pid/runs/discover`, `src/server/api/runs.ts:72`); the scheduler does not start discovery.
- The Claude preset already removes the sub-agent tool (`--disallowedTools Agent,Task`, `src/server/agents/presets.ts`); the Codex preset has no equivalent, and Codex `multi_agent` is "stable, true" in `codex features list` (codex-cli 0.163.0).
- `verifyLink` (`src/server/verify/links.ts`) marks a 2xx after redirects `redirected` and only 404/410/DNS failure `dead`; discovery stores the final URL of a redirected link (`src/server/services/discovery.ts`).
- `runs.kind` is constrained to `discover_jobs` and `sync_mail` (`src/server/db/migrations.ts`).
- Prompt `prompts/discover_jobs.md` is v2 with a Budget section (SOW-0008).

Inferences:

- Max effort is mostly a recall problem (more companies, more title variants, more ATS families), not a precision problem (research report, JobFinderOS benchmark).

Unknowns:

- See Open decisions; no further unknowns that investigation can resolve without user input.

### Acceptance Criteria

- Default discovery: Claude argv carries `--tools`, `--strict-mcp-config` (when no `mcp__` tool) and `--max-budget-usd` (when set); Codex argv carries `--disable multi_agent` and `web_search="live"`. Verified by preset tests and real CLI probes.
- Prompt v3 with `{{scope}}` and the `checks` output field; schema stays strict. Verified by prompt and schema tests plus real `--json-schema`/`--output-schema` probes.
- Max discovery runs five partitioned workers (at most 3 at once), merges, dedupes, survives partial failure, honours cancel. Verified by service tests with the fake agent and one real Max run.
- Greenhouse `?error=true` redirects verify as `dead`. Verified by verifier tests.
- Usage (Claude cost estimate and tokens, Codex tokens) stored per run and summed over workers; shown on the Run page and in the Max warning. Verified by repo, service and UI tests.
- Max button opens a warning dialog; nothing starts until confirmed. Verified by UI tests.
- Fit badges render from `fit_checks`; older rows render without them. Verified by UI tests.
- `npm test`, `npm run typecheck`, `npm run build` pass; spec, README and skill updated.

## Analysis

Sources checked:

- Research report and notes (git-ignored, `.tmp/research/`), summarised below with public citations.
- Code: `src/server/agents/presets.ts`, `src/server/services/discovery.ts`, `src/server/verify/links.ts`, `src/server/db/settings-repo.ts`, `src/server/db/migrations.ts`, `src/server/api/runs.ts`, `src/ui/pages/JobsPage.tsx`, `prompts/discover_jobs.md`.
- Spec `.agents/sow/specs/product-v1.md` (discovery prompt v2 budget, verification statuses, run model).
- Prior SOWs: SOW-0008 (discovery run budget: unbounded run spent 15 min in 14 sub-agents), SOW-0011 (model and effort), SOW-0012 (cancel), SOW-0005 (pending hardening backlog; its verifier item is about private hosts and shared deadlines, not soft 404s, so no overlap).

External evidence (public sources):

- JobFinderOS benchmark: LLM-only board crawling 0.118-0.137 recall at 8-12x cost per true positive vs ATS polling plus LLM scoring 0.706-0.926 recall. `matthewprice/JobFinderOS @ 23d5b031e6bd` `docs/discovery-benchmark.md`.
- career-ops discovery levels, ATS endpoints, liveness rules (Greenhouse `?error=true` means closed), nested-agent warning. `career-ops-hq/career-ops @ 829ddc07fdca` `modes/scan.md`, `modes/_shared.md`, `templates/portals.example.yml`.
- Anthropic, "How we built our multi-agent research system" (2025): multi-agent ~15x chat tokens vs ~4x single agent; token use explained 80% of variance; briefs need objective, output format, sources, boundaries.
- Claude Code docs: `--max-budget-usd` (print mode only, estimate-based, can overshoot), `--tools` restricts available tools, `--allowedTools` only skips prompts.
- Codex config reference: `web_search` defaults to `cached` (no live web access); `features.multi_agent` on by default.

Local probes (2026-11-07, claude 2.1.319, codex-cli 0.163.0, invented prompt with no profile data):

- Claude `-p` with the current discover flags plus `--tools WebSearch` loaded 275,136 context tokens before any work (cache creation, $1.10 at list price on sonnet); with `--strict-mcp-config` added it loaded 12,857 (first run $0.046, cached $0.0014). The difference is the user-level MCP servers loaded by `--setting-sources user`. Size depends on each user's MCP setup.
- Claude WebSearch does not enforce `site:`: a `site:jobs.lever.co` query returned 10 of 19 URLs on Lever hosts (most were Lever demo boards) and 9 aggregators; `site:jobs.ashbyhq.com OR site:jobs.lever.co` returned no Ashby-hosted URL. The result event's `webSearchRequests` stayed 0 although searches ran.
- Greenhouse: an invented job id on `job-boards.greenhouse.io/[BOARD]/jobs/<id>` and on `boards.greenhouse.io/...` answers 302 to `/[BOARD]?error=true`, then 200. `verifyLink` would return `redirected` and discovery would store the board URL. The board API `boards-api.greenhouse.io/v1/boards/[BOARD]/jobs/<id>` returns 404. Lever and Ashby invented ids return 404 directly.
- Codex `exec --json --sandbox read-only --disable multi_agent -c web_search="live" -c model_reasoning_effort="low"`: both flags accepted; live search honoured `site:` (11 of 11 results on `jobs.lever.co`; the `OR` query returned 11 on `jobs.ashbyhq.com` and 1 on `jobs.lever.co`). After the two searches the process emitted no final message and no `turn.completed` for about an hour and was stopped by hand; stderr showed `failed to refresh available models: request timed out`. Cause unknown; the app's wall-clock timeout would have ended it. The cached-vs-live staleness test was not run because decision 4 already adopts `live`.

Risks:

- Max mode multiplies agent spend roughly by worker count; the app cannot see billing.
- `--max-budget-usd` ends a run with `error_max_budget_usd` and no structured output, so a low cap loses the whole run's work.
- `--strict-mcp-config` would break a user who added an MCP tool to `allowed_tools_discover`.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Single bounded run trades recall for cost; there is no higher-effort path. Separately, the verifier misclassifies Greenhouse soft 404s, and the Codex preset neither disables sub-agents nor asks for live web search.

Evidence reviewed:

- See Analysis.

Affected contracts and surfaces:

- CLI argv for both presets (discover; Codex sync per decision 20); prompt template `discover_jobs.md` v2 -> v3; agent output schema (`checks`).
- HTTP: `POST /api/profiles/:pid/runs/discover` optional body; `GET` runs and jobs responses gain columns; `PATCH /api/settings` new key.
- SQLite migration 5 (runs, jobs columns).
- Verifier status for Greenhouse soft 404s (`redirected` -> `dead`); dead jobs are hidden by default on the Jobs page.
- UI: Jobs page, Run page, Settings, readable log.
- Spec, README, `project-agent-adapter` skill.

Existing patterns to reuse:

- `mapLimit` and the dedupe flow in `src/server/services/discovery.ts`; `renderPrompt` versioned templates; `selectionFor` argv validation in `presets.ts`; run queue cancel and `beginSaving()` (SOW-0012); shadcn `AlertDialog` confirmation pattern (SOW-0010).

Risk and blast radius:

- Spend: a Max run is about five agent processes; the app cannot see billing. Mitigated by the confirm dialog, per-worker timeout, Claude per-worker cap, recorded usage.
- `--max-budget-usd` ends a run with `error_max_budget_usd` and no output; the default 5 USD is a safety net, and a capped worker in Max loses only that worker (decision 12).
- `--strict-mcp-config` is skipped when the user lists an `mcp__` discovery tool, so custom MCP search setups keep working.
- `--tools` hides built-in tools not listed in `allowed_tools_discover`; with the default `WebSearch,WebFetch` that is the intent.
- Codex `web_search="live"` may be slower than `cached`; the stall seen in the probe is bounded by the run timeout.
- Claude WebSearch ignores `site:` (probe), so Max workers on Claude overlap; dedupe removes duplicates, overlap costs tokens.
- Migration 5 only adds nullable or defaulted columns; no table rebuild; older rows stay valid.
- Greenhouse rule could mark a live posting dead only if Greenhouse redirected a live job to `?error=true`, which no source reports.
- Parallel workers raise concurrent rate-limit pressure on the user's plan (limit 3).
- Prompt v3 changes agent behaviour for every discovery run; measured only by the real-use runs below.

Sensitive data handling plan:

- Probes used an invented prompt with no profile; probe outputs stay in git-ignored `.tmp/probes/` and are not pasted here. Board names in this SOW are replaced by `[BOARD]`. Tests will use invented companies and URLs only.

Implementation plan:

1. See `## Plan` chunks 1-9, in order; each chunk test-first per `project-testing`.

Validation plan:

- Unit and integration tests per chunk (fake agent only); `npm test`, `npm run typecheck`, `npm run build` pristine.
- Real CLI probes after flag changes: trivial-prompt `claude -p` and `codex exec` with the new argv and the v3 schema.
- Real-use runs, invented profile, sandbox data dir: one Default and one Max discovery on Claude, one Default on Codex; record duration, jobs found, dead/unverified counts, recorded usage (decision 21).
- Independent review of the diff before close; same-failure scans: `grep -rn "shell: true\|exec(" src/server`, other soft-404 redirect patterns in `links.ts` callers.

Artifact impact plan:

- AGENTS.md: likely unaffected.
- Runtime project skills: `project-agent-adapter` (new preset flags, MCP finding, prompt version), `project-testing` if new fixture modes are added.
- Specs: `product-v1.md` discovery, verification statuses, settings, run model.
- End-user/operator docs: README discovery section.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW; issue #6 closes with it.

Open-source reference evidence:

- `matthewprice/JobFinderOS @ 23d5b031e6bd` `docs/discovery-benchmark.md`, `scripts/jfgraph/prompts/web_sweep.md`, `.claude/agents/scout.md` (MIT).
- `career-ops-hq/career-ops @ 829ddc07fdca` `modes/scan.md`, `modes/_shared.md`, `modes/batch.md`, `templates/portals.example.yml` (MIT).
- `selfishprimate/seekter @ 087596ab4c25` `.claude/skills/seekter-run/SKILL.md` (MIT).
- Ideas only are reused; prompt text is written fresh.

Open decisions:

- None. Decisions 1-21 are recorded under Implications And Decisions.

## Implications And Decisions

Recorded 2026-11-07 (user answer "1.B, 2.A, 3.B, 4.B, 5.B, 6.A"):

1. Greenhouse soft-404 verifier fix: B, folded into this SOW.
2. Local CLI tests before designing Max: A, run by the assistant. Tests 3 (Codex sub-agents under `codex exec`) and 4 (Claude waiting for sub-agents) were dropped because decision 3 removes CLI sub-agents from the design.
3. Max-mode architecture: B, the app spawns N independent agent processes (one per partition, each with sub-agents disabled) and merges and dedupes their JSON server-side.
4. Default hardening in presets: B, Codex `--disable multi_agent` and `-c web_search="live"`; Claude `--tools` restriction and a `--max-budget-usd` setting (value to be decided).
5. Default prompt: B, rewrite around ATS-first steps (v3) and add a per-must-have verdict to the output schema.
6. Max warning: A, confirm dialog before each Max run with scope and quota warning; after a run show the agent's estimated cost (Claude) or token counts (Codex).

Recorded 2026-11-07 (user answer "7.B ... 18.A", every option A unless noted):

7. MCP trimming for Claude discovery: B, add `--strict-mcp-config` unless `allowed_tools_discover` lists an `mcp__` tool. Sync unchanged (it needs the Gmail connector).
8. Claude spend cap: A, setting `claude_max_budget_usd_discover`, default `5` (USD estimate per agent process; each Max worker gets its own cap), `''` = no cap.
9. Max partitions: A, five workers by source family: (1) Greenhouse, (2) Lever, (3) Ashby, (4) other ATS (Workday, SmartRecruiters, Workable and similar) plus company careers pages, (5) remote and niche job boards.
10. Worker concurrency: A, at most 3 workers at a time.
11. Timeouts: A, each worker gets `run_timeout_ms`; no new setting.
12. Partial failure: A, keep jobs from successful workers, log failed workers; the run fails only when every worker fails.
13. Custom adapter: A, Max allowed; the same command runs once per worker prompt; the warning says no spend cap applies.
14. Per-must-have verdicts: A, stored and shown as badges; never hide jobs.
15. Greenhouse rule: A, on Greenhouse hosts a redirect hop carrying `error=true` marks the link `dead`.
16. Usage: A, new run columns for usage (Claude estimated cost and tokens, Codex tokens), summed over workers, shown on the Run page and quoted in the next Max warning.
17. UI entry: A, a "Max-effort search" button next to "Find jobs", opening the confirm dialog.
18. Storage: A, `runs.effort_mode` column (`default` | `max`); kind stays `discover_jobs`.

Recorded 2026-11-07 (user answer "all recommended"; plan approved):

19. Max requested while a discovery run of the profile is queued or running: A, return the active run when its mode matches, otherwise 409 "A discovery run is already active".
20. Codex `--disable multi_agent`: A, discover and sync (matches the Claude preset).
21. Real-use validation: A, the assistant runs one Default and one Max discovery on Claude and one Default on Codex, invented profile, sandbox data dir.

Recorded 2026-11-07 after validation (user answer "All recommended"):

22. Dead Ashby links in Max (9 of 13 in the real run): A, accept for now; measure and test a fix in SOW-0017.
23. Commit: A, one commit with the work and this SOW's close; `package-lock.json` (an unrelated one-line change) left out.

## Plan

1. Verifier (decision 15). `src/server/verify/links.ts`: when a redirect `Location` is on `greenhouse.io` or a subdomain and has `error=true`, return `dead` with that URL. Tests in `test/server/verify/`.
2. Presets and settings (decisions 4, 7, 8, 20). `src/server/agents/presets.ts`:
   - Claude, discover only: `--tools <built-in names from allowed_tools_discover>` (entries not starting `mcp__`; omitted when none), `--strict-mcp-config` when no entry starts `mcp__`, `--max-budget-usd <v>` when the setting is non-empty.
   - Codex: `--disable multi_agent` (scope per decision 20); discover only `-c web_search="live"`.
   - New setting `claude_max_budget_usd_discover` (default `'5'`, `''` = off; API pattern `^\d{1,4}(\.\d{1,2})?$`, value > 0, re-checked in the preset because it reaches argv) in `domain/types.ts`, `db/settings-repo.ts`, `api/settings.ts`, Settings UI (Agent section, discovery row).
   - Re-verify flag spellings with `--help` on the build machine; record versions.
3. Usage capture (decision 16). `AgentResult.usage?: { costUsd?, inputTokens?, outputTokens? }`, read on success and failure like `reportedModel`: Claude from the last `result` event (`total_cost_usd`, `modelUsage` token sums including cache reads/writes); Codex from the last `turn.completed.usage` (a running total; see Execution Log); custom none. Fake agent `claude`/`codex` modes emit usage.
4. Migration 5 (decisions 14, 16, 18): `runs.effort_mode TEXT NOT NULL DEFAULT 'default' CHECK (effort_mode IN ('default','max'))`, `runs.usage_cost_usd REAL`, `runs.usage_input_tokens INTEGER`, `runs.usage_output_tokens INTEGER`, `jobs.fit_checks TEXT` (JSON, NULL for older rows). Repos, `Run`/`Job` types, `RunContext.recordUsage` (never throws; written even when the run fails).
5. Output schema and prompt v3 (decision 5). `DiscoveredJob.checks: { location, remote, seniority }`, each `pass | fail | unknown` (default `unknown`; strict agent schema stays valid). `prompts/discover_jobs.md` v3, written fresh from the researched patterns: short title-variant searches, ATS hosts first, fetch a company's public job list once instead of single postings when the agent can fetch, never LinkedIn/aggregator pages for confirmation, fewer jobs is fine and never pad, a field the profile leaves empty or `any` is `pass`. New `{{scope}}` variable: Default renders "all sources, ATS first"; each Max worker renders its source family and the families it must leave to others. Budget section kept (decision of SOW-0008). Version bump and prompt tests.
6. Discovery service (decisions 3, 9-13). `src/server/services/discovery.ts`: Default = one worker with the full scope (behaviour as today plus the above). Max = five worker tasks run through `mapLimit` with limit 3; each worker gets its own cwd `runs/<run-id>/worker-<n>/` (Codex writes `-o output.json` per cwd), its own timeout, the shared abort signal, and a log prefix `[worker <n>] `. Results merge into the existing canonicalise, verify, dedupe and insert path; usage is summed; failed workers are logged by name; all-failed throws the first worker's error. `beginSaving()` after all workers settle.
7. Queue and API (decisions 18, 19). `enqueue(kind, profileId, { effortMode })`; `POST /api/profiles/:pid/runs/discover` accepts an optional JSON body `{ "mode": "default" | "max" }` (zod strict; no body = default). Active-run rule per decision 19. UI client `startDiscovery(profileId, mode)`.
8. UI (decisions 6, 14, 16, 17).
   - Jobs page: "Max-effort search" button next to "Find jobs" opens an `AlertDialog`: five workers by source, up to 3 at a time, each up to the run timeout, runs on the user's own agent plan, may use several times the tokens of a normal search and can exhaust plan limits; Claude shows the per-worker cap (or "no cap"), Codex and custom say no spend cap applies; quotes the last Max run's recorded usage when one exists. No up-front dollar estimate.
   - Jobs table: a Fit column with Location / Remote / Seniority badges (pass, fail, unknown styles); empty for older rows.
   - Run page: mode and recorded usage for discovery runs (Claude cost labelled "estimated"; the README explains it is list price, not the bill).
   - `src/ui/log-format.ts`: strip a `[worker <n>] ` prefix, format the inner line, prefix the readable row with "Worker <n>"; tests.
9. Artifacts: `.agents/sow/specs/product-v1.md` (discovery modes, prompt v3, verifier rule, settings, run columns, usage), README discovery section, `project-agent-adapter` skill (new flags, MCP context finding, `site:` behaviour per agent, prompt v3, Codex post-search stall observation), `project-testing` skill if fixture modes change.

## Execution Log Plan Notes

- Load `project-testing` and `project-local-api` skills before chunks 1, 6 and 7.

## Execution Log

### 2026-11-07

- Research (four parallel web researchers plus synthesis), local CLI probes, SOW drafted.
- Chunk 1: `src/server/verify/links.ts` Greenhouse `error=true` redirect -> `dead`; tests via injected fetch, including a look-alike host.
- Chunk 2: `presets.ts` Claude discovery `--tools`, `--strict-mcp-config`, `--max-budget-usd`; Codex `--disable multi_agent` (both kinds) and discovery `web_search="live"`; setting `claude_max_budget_usd_discover` (types, defaults, API, Settings → Runs field). Flags confirmed with `claude --help` 2.1.319 and `codex exec --help` 0.163.0.
- Chunk 3: `src/server/agents/usage.ts`, `AgentResult.usage`, `usageFrom` on presets; fake agent `claude-budget` mode and usage in `claude`/`codex` modes. Evidence for taking Codex's last `turn.completed`: `openai/codex` mirror, `codex-rs/exec/src/event_processor_with_jsonl_output.rs:119-137` (`usage_from_last_total`); the mirror exposes no commit hash, checked 2026-11-07.
- Chunk 4: migration 5; runs repo `effort_mode` on create and usage columns; jobs repo `fit_checks` JSON with tolerant parse; `RunContext.recordUsage`; `ActiveRunConflictError` in `enqueue`.
- Chunk 5: output schema `checks`; prompt v3. Deviation from the plan text, within the approved design: the prompt names only the Greenhouse and Lever job lists. Measured 2026-11-07: Greenhouse list 175 KB, Lever 84 KB, Ashby 4.3 MB for one board, beyond what WebFetch keeps (about 100k characters), so Ashby postings come from search results.
- Chunk 6: `services/discovery.ts` Default/Max workers; `MAX_EFFORT_SOURCES` and `MAX_EFFORT_CONCURRENCY` moved to `domain/types.ts` so the UI warning names the same sources.
- Chunk 7: `POST .../runs/discover` optional strict body, 409 on mode conflict; UI client `startDiscovery(profileId, mode)`.
- Chunk 8: `MaxSearchDialog`, Jobs Fit column, Run page Mode and Usage, `formatUsage`, log formatter worker prefix with per-worker Codex step pairing (Codex item ids restart in every process).
- Chunk 9: spec, README, `project-agent-adapter`, `project-local-api` and `project-testing` skills updated.

## Validation

Acceptance criteria evidence:

- Default hardening flags: preset tests in `test/server/agents/cli-adapter.test.ts`; the real Default Claude run below ran with `--tools WebSearch,WebFetch --strict-mcp-config --max-budget-usd 5 --json-schema …` and returned structured output; the real Codex run ran with `--disable multi_agent -c web_search="live"`.
- Prompt v3 and `checks`: `test/server/tasks/prompts.test.ts`, `schemas.test.ts`; both real agents accepted the v3 strict schema and filled `checks` for every job.
- Max: `test/server/services/discovery.test.ts` (five scoped workers, peak concurrency 3, own directories, merge and dedupe, partial and total failure, cancel before and after workers found jobs, a worker that throws outside the agent); one real Max run below.
- Greenhouse soft 404: `test/server/verify/links.test.ts` (redirect hop, old host, direct `error=true` URL, ordinary redirect, other host, look-alike host).
- Usage: `test/server/agents/usage.test.ts`, adapter tests with fake `claude`, `claude-budget`, `codex` modes, queue and discovery tests; real runs recorded usage (below).
- Max warning dialog and Fit badges: `test/ui/JobsPage.test.tsx`; Run page Mode/Usage: `test/ui/RunPage.test.tsx`.

Tests or equivalent validation:

- `npm test`: `Test Files  54 passed (54)`, `Tests  627 passed (627)`, no warnings.
- `npm run typecheck`: clean. `npm run build`: succeeds; Vite warns that `dist/ui/assets/index-*.js` (506,881 bytes) is over its 500 kB chunk warning. Not established whether the warning predates this SOW; this SOW adds one dialog component.

Real-use evidence (2026-11-07, built app, data dir `.tmp/sow16-validation/`, invented profile: Platform Engineer / Site Reliability Engineer, Europe, remote, senior; claude 2.1.319 default model reported `claude-opus-5-5`, codex-cli 0.163.0 default model):

| Run | Duration | Result | Links | Reported usage |
|---|---|---|---|---|
| Default, Claude | 2 min 27 s | 12 new | 11 ok, 1 unverified, 0 dead; 11 of 12 on Greenhouse/Lever/Ashby | $0.82 est., 661k in / 36k out; 13 WebSearch, 17 WebFetch |
| Max, Claude | 5 min 32 s | 30 new, all 5 workers succeeded | 20 ok, 1 redirected, 9 dead (all 9 on Ashby) | $4.90 est. (workers $0.60-$1.37), 4.6M in / 202k out |
| Default, Codex | 1 min 53 s | 5 new | 4 ok, 1 dead | 710k in / 3k out, no cost; 10 searches, 2 page opens |

- Baseline from SOW-0008 (prompt v2): about 15 min with 14 sub-agents; the "do not open" variant had 7 of 18 links dead.
- Max dead links: each of the 9 Ashby URLs answered 404 and its id was absent from that company's live Ashby board (`api.ashbyhq.com/posting-api/job-board/[BOARD]`), so the verifier was right and the jobs are hidden by default. The Ashby worker opened 6 pages for 13 returned jobs; prompt v3 tells it to take Ashby postings from search results. See decision 22.
- The earlier probes (Analysis) cover `site:` behaviour and the MCP context cost.
- UI was exercised through component tests only; no browser session was recorded.

Reviewer findings:

- Independent read-only reviewer (subagent, 2026-11-07), eight findings:
  1. Max worker throwing outside the agent left other agents running: fixed (worker callback never rejects; test).
  2. No Max cancel test: fixed (two tests; workers waiting for a slot no longer start after a cancel).
  3. Killed workers report no usage: limitation documented in the dialog, spec and README ("reports nothing, so the real use can be higher").
  4. Custom agent wording ("your own your custom agent plan"): fixed; test.
  5. Real `--json-schema` probe with the new Claude argv missing: settled by the real Default Claude run; Codex v3 schema settled by the real Codex run.
  6. A direct Greenhouse `error=true` URL passed as `ok`: fixed; test.
  7. Run page "Usage: Not reported" on sync runs: Mode and Usage now show for discovery only; test.
  8. Plan text drift (cost label, Codex usage): Plan updated.

Same-failure scan:

- `grep -rn "shell: true\|exec(" src/server`: no matches.
- `grep -rn "0.0.0.0" src bin`: no matches.
- Other `Promise.all` fan-outs in handlers: `mapLimit` is also used for link checks, whose callback (`verifyLink`) never rejects.
- Other soft-404 patterns: Lever and Ashby answer real 404s (probed); Workday, SmartRecruiters and iCIMS not probed.

Sensitive data gate:

- Durable artifacts contain no secrets, credentials, personal data or customer data. Probe and run outputs stay in git-ignored `.tmp/`; board names are written as `[BOARD]`; test data uses invented companies (`Acme`, `example.com`). Real company names seen in validation runs were not copied into durable artifacts.

Artifact maintenance gate:

- AGENTS.md: no update; workflow and guardrails unchanged.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` (Claude/Codex discovery flags, MCP context cost, `site:` behaviour, Codex stall, usage extraction, Max fan-out, fixture modes, prompt v3), `.agents/skills/project-local-api/SKILL.md` (discover body, 409), `.agents/skills/project-testing/SKILL.md` (host-specific verifier tests, `fetch` spy).
- Specs: `.agents/sow/specs/product-v1.md` (prompt v3, presets, verifier, `fit_checks`, run columns, new "Discovery effort levels" section, UI).
- End-user/operator docs: `README.md` (How discovery works, new Max-effort search section, Dead link badge, Security).
- End-user/operator skills: none exist (`AGENTS.md` lists none).
- SOW lifecycle: `Status: completed`, moved to `done/` and committed together with the work; follow-up SOW-0017 created in `pending/`.

Specs update:

- `.agents/sow/specs/product-v1.md` updated as listed above.

Project skills update:

- Three runtime skills updated as listed above.

End-user/operator docs update:

- `README.md` updated as listed above.

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- User-level MCP servers dominate the cost of a headless Claude run; measure context size (`cacheCreationInputTokens`) before tuning prompts.
- `site:` support differs per agent; correctness must stay app-side.
- Codex `turn.completed.usage` is a running total; read the source before summing event fields.
- Parallel fan-out callbacks must settle, never reject, or sibling agents outlive the run.

Follow-up mapping:

- Ashby dead links in Max: tracked in `.agents/sow/pending/SOW-0017-20261107-ashby-dead-links.md` (decision 22A).
- `fetch` reassignment in older client tests: tracked in SOW-0005 (existing item).
- Usage for mail sync runs: not required by issue #6; recorded as an opportunity for the user, not implemented.
- Vite chunk-size warning: origin not established; reported to the user.

## Outcome

- Default discovery is bounded harder (Claude: built-in tools only, MCP servers skipped, $5 per-agent spend cap; Codex: sub-agents off, live search) and uses prompt v3. Real Claude run: 12 jobs in 2 min 27 s, 0 dead.
- Max-effort discovery runs five partitioned agent processes (three at a time) behind a warning dialog. Real Claude run: 30 jobs in 5 min 32 s, about 6x the Default reported cost, 9 dead Ashby links hidden by the verifier (SOW-0017).
- Greenhouse soft 404s are dead; usage and fit verdicts are recorded and shown.

## Lessons Extracted

- See Validation → Lessons; the MCP context cost, `site:` behaviour, Codex usage semantics and the fan-out rule are recorded in `project-agent-adapter`.

## Followup

- SOW-0017 (Ashby dead links, pending).
- SOW-0005 (existing): older client tests reassigning `fetch`.
- Opportunities outside the approved outcome, reported to the user (not required for issue #6): usage for mail sync runs, Greenhouse id lookup through its API, Vite chunk-size warning origin.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
