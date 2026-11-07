# SOW-0017 - Dead Ashby links from Max-effort discovery

## Status

Status: completed

Sub-state: delivered 2026-11-07 and committed with this file's move to `done/`.

## Requirements

### Purpose

Reduce agent spend on Ashby postings that turn out to be closed, without lowering recall, and only on evidence.

### User Request

Decision 22A in SOW-0016: accept the dead Ashby links for now and test a fix in a follow-up SOW, with measurements.

### Assistant Understanding

Facts:

- SOW-0016 real Max run on Claude (2026-11-07): 13 Ashby links returned, 9 dead. Each dead URL answered 404 and its id was absent from that company's live board (`api.ashbyhq.com/posting-api/job-board/[BOARD]`). The Ashby worker made 12 WebSearch calls and 6 WebFetch calls.
- Prompt v3 (`prompts/discover_jobs.md`) tells the agent not to fetch Ashby's job list (4.3 MB for one board, measured 2026-11-07) and to use search results for Ashby postings.
- The verifier marks these jobs `dead` and the Jobs page hides them by default, so the cost is wasted tokens, not wrong results shown to the user.
- In the same session the Default runs returned 3 of 3 (Claude) and 3 of 3 (Codex) live Ashby links.

Inferences:

- Search indexes keep closed Ashby postings; a single run cannot separate stale results from invented ids.

Unknowns:

- The dead rate over several runs and profiles.
- Answered 2026-11-07 (see Execution Log): WebFetch of a posting page shows the posting title for a live posting and fails with "HTTP 404 Not Found" for a closed one.

### Acceptance Criteria

- Prompt v4: step 3 tells the agent to open each Ashby posting once before returning it and to drop any that fails to load; version bumped; prompt test pinned.
- After measurement: the same 8 runs (same profiles, scopes, adapter, link check) with v4. Success: fewer dead Ashby links than before (Ashby worker 5 of 48, Default 5 of 21) without a large fall in jobs returned or a large rise in reported cost. The numbers are reported to the user either way.

## Analysis

Sources checked:

- SOW-0016 Validation (real-use table and Max dead-link check).

Current state:

- See Facts.

Risks:

- Asking the agent to open every Ashby posting adds page fetches to every run and may not work if the page content is client-rendered.

## Pre-Implementation Gate

Status: ready (decision 2B, 2026-11-07)

Problem / root-cause model:

- Working theory: the Ashby worker returns postings from stale search results without opening them, as prompt v3 allows.

Evidence reviewed:

- SOW-0016 Validation.

Affected contracts and surfaces:

- Likely `prompts/discover_jobs.md` (version bump) and possibly the Max worker scope in `src/server/services/discovery.ts`.

Existing patterns to reuse:

- The SOW-0016 validation setup: built app, throwaway data dir under `.tmp/`, invented profile, per-host dead-link tabulation.

Risk and blast radius:

- Prompt changes affect every discovery run; measure Default and Max.

Sensitive data handling plan:

- Same as SOW-0016: run outputs stay in git-ignored `.tmp/`; board names written as `[BOARD]`; invented profiles only.

Implementation plan:

1. Done: probes and 8 before runs (Execution Log).
2. `prompts/discover_jobs.md` v4: replace the Ashby sentence in step 3.
3. `test/server/tasks/prompts.test.ts`: pin version 4 and the new sentence.
4. 8 after runs with `.tmp/sow17-probes/measure.ts`; compare.
5. Docs: `project-agent-adapter` skill and spec prompt description (v4, the Ashby rule and the measurements).

Validation plan:

- Before/after dead rate per host and per-run reported usage over the same profiles.

Artifact impact plan:

- AGENTS.md: likely unaffected.
- Runtime project skills: `project-agent-adapter` if the prompt changes.
- Specs: `product-v1.md` prompt description if the prompt changes.
- End-user/operator docs: README only if behaviour visible to users changes.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW.

Open-source reference evidence:

- None checked yet.

Open decisions:

- None; decisions 1A, 2B, 3B recorded.

## Implications And Decisions

User decisions (2026-11-07):

1. Measurement budget: A. Run the Max Ashby worker alone with the app's exact rendered prompt and flags; 2 invented profiles x 2 runs before the fix and the same after (8 runs, guessed at about $1 each).
2. Fix: A. Max Ashby worker only: its scope text tells it to open each Ashby posting once before returning it and drop any that fails to load. The shared prompt template is unchanged.
3. Delivery: B. Commit on the PR #11 branch (`multiple-levels-of-investigation-effort`).

Amendment (2026-11-07, user decision 2A after new evidence): keep the Max-worker-only fix, and add Default discovery runs to the before measurement (2 profiles x 2 runs, about $1 each) to see whether Default needs the fix too. If it does, the fix choice goes back to the user.

Revision (2026-11-07, user decision 2B after the before measurements): the rule goes into the shared prompt as v4, so Default and every Max worker get it. `prompts/discover_jobs.md` step 3 replaces "Use search results for Ashby postings" with: open each Ashby posting once before returning it and drop any that fails to load. The Max Ashby worker's scope text is unchanged. After measurement: the same 8 runs with v4.

Ordering (assistant, within the approved plan): SOW-0018 runs first because it changes the Claude argv the measurements use.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- Created from SOW-0016 decision 22A.
- Started on user request. Probes against one public Ashby board (`[BOARD]`, 73 listed postings), with curl and a desktop browser User-Agent:
  - Board API `api.ashbyhq.com/posting-api/job-board/[BOARD]`: 200, 4.3 MB (each posting carries `descriptionHtml` and `descriptionPlain`).
  - Board page `jobs.ashbyhq.com/[BOARD]`: 200, 104 KB; all 73 posting ids, titles and locations sit in an inline script (`JobPostingBriefsWithIdsAndTeamId` objects).
  - Live posting page: 200, 137 KB; title and description are present outside scripts (1.9 KB of visible text).
  - Unknown posting id and unknown board: 404, 9 KB.
- WebFetch probes with the discovery flags (`claude` 2.1.319, `-p --tools WebFetch --setting-sources user --strict-mcp-config --disallowedTools Agent,Task --max-budget-usd 0.5 --model sonnet`), reported cost $0.057 and $0.047:
  - Board page: WebFetch succeeded but saw only the heading and 0 postings; the inline script data does not reach the agent. The board page is not a usable job list.
  - Unknown posting id: WebFetch failed with "The server returned HTTP 404 Not Found."
  - Live posting: WebFetch succeeded and returned the page title "<job title> @ [BOARD]", without location or description.
  - So one WebFetch per Ashby posting separates live (title returned) from closed (404 error) postings.
- New evidence from SOW-0018's real Default discovery run on Claude (2026-11-07): 5 Ashby links returned, 2 dead (404). This contradicts the Fact that Default runs returned only live Ashby links, which decision 2A relied on. Raised with the user before the measurement runs.
- Before measurements (decision 1A as amended): 8 runs, `.tmp/sow17-probes/measure.ts`, which renders the app's prompt v3 with the app's scope text and known URLs `(none)`, runs the app's Claude adapter (claude 2.1.319, default model, SOW-0018 flags) and checks each link with the app's `verifyLink`. Two invented profiles (`frontend`, `backend`), 4 runs at a time. Claude's estimate for all 8: $5.25.

  | Run | Time | Jobs | Dead | Ashby links (dead) | Ashby pages opened | Estimate |
  |---|---|---|---|---|---|---|
  | Ashby worker, frontend 1 | 1.8 min | 12 | 0 | 12 (0) | 22 | $0.55 |
  | Ashby worker, frontend 2 | 1.8 min | 10 | 0 | 10 (0) | 18 | $0.53 |
  | Ashby worker, backend 1 | 1.9 min | 12 | 0 | 12 (0) | 18 | $0.55 |
  | Ashby worker, backend 2 | 1.5 min | 14 | 5 | 14 (5) | 4 | $0.44 |
  | Default, frontend 1 | 2.1 min | 9 | 3 | 9 (3) | 2 | $0.80 |
  | Default, frontend 2 | 2.2 min | 6 | 1 | 4 (1) | 8 | $0.64 |
  | Default, backend 1 | 2.9 min | 8 | 2 (Lever) | 0 | 0 | $0.98 |
  | Default, backend 2 | 2.7 min | 11 | 1 | 8 (1) | 6 | $0.77 |

  - Ashby worker: 5 of 48 Ashby links dead (10%), all in the one run that opened 4 pages for 14 jobs.
  - Default: 5 of 21 Ashby links dead (24%) in 3 of 4 runs, plus 2 of 4 Lever links dead in one run that fetched no Lever job list.
  - Working theory: dead links come from postings returned without being opened. Prompt v3 step 3 says "Use search results for Ashby postings", and the agent opens a varying share of them (4 to 22 pages per run).
- Prompt v4 (step 3 Ashby sentence) and its test: written first (2 failed), then passed.
- After measurements: the same 8 runs with v4 (same script, profiles, scopes, adapter and link check), 4 at a time.

  | Run | Time | Jobs | Dead | Ashby links (dead) | Ashby pages opened | Estimate |
  |---|---|---|---|---|---|---|
  | Ashby worker, frontend 1 | 1.8 min | 11 | 0 | 11 (0) | 15 | $0.50 |
  | Ashby worker, frontend 2 | 1.9 min | 14 | 0 | 14 (0) | 18 | $0.57 |
  | Ashby worker, backend 1 | 1.9 min | 13 | 0 | 13 (0) | 21 | $0.61 |
  | Ashby worker, backend 2 | 1.7 min | 11 | 0 | 11 (0) | 16 | $0.50 |
  | Default, frontend 1 | 3.3 min | 5 | 0 | 5 (0) | 13 | $1.05 |
  | Default, frontend 2 | 3.8 min | 9 | 0 | 9 (0) | 17 | $1.11 |
  | Default, backend 1 | 3.5 min | 13 | 0 | 3 (0) | 4 | $0.93 |
  | Default, backend 2 | 4.1 min | 11 | 1 (an employer careers page) | 3 (0) | 11 | $1.15 |

  Totals, before -> after:

  | | Jobs | Dead | Live | Dead Ashby | Estimate | Average time |
  |---|---|---|---|---|---|---|
  | Ashby worker (4 runs) | 48 -> 49 | 5 -> 0 | 43 -> 49 | 5 of 48 -> 0 of 49 | $2.06 -> $2.17 | 1.8 -> 1.8 min |
  | Default (4 runs) | 34 -> 38 | 7 -> 1 | 27 -> 37 | 5 of 21 -> 0 of 20 | $3.19 -> $4.24 | 2.5 -> 3.7 min |

  Default cost per live job: $0.118 -> $0.115. Four runs per side is a small sample; the direction is consistent across all 8 after runs.
 the probe agent addressed the user by name, which shows that `--setting-sources user` also loads the user's personal `~/.claude/CLAUDE.md` into every Claude run the app starts. Reported to the user.

## Validation

Acceptance criteria evidence:

- Prompt v4: `prompts/discover_jobs.md` step 3; `test/server/tasks/prompts.test.ts` pins version 4, the new sentence and the absence of "Use search results for Ashby postings".
- After measurement: dead Ashby links 5 of 48 -> 0 of 49 (Ashby worker) and 5 of 21 -> 0 of 20 (Default); live jobs did not fall (43 -> 49, 27 -> 37); reported cost +5% (Ashby worker) and +33% (Default, with 37% more live jobs). See Execution Log.

Tests:

- `npm test`: `Test Files  54 passed (54)`, `Tests  636 passed (636)`. `npm run typecheck` clean. `npm run build` passes (same chunk-size warning as before).

Real-use evidence:

- The 16 measurement runs used the real Claude agent with the app's prompt rendering, adapter (SOW-0018 flags) and link checker. No full Max run through the app UI: the Max Ashby worker was measured alone (decision 1A).

Reviewer findings:

- No separate reviewer pass: a one-sentence prompt change with a version bump, validated by 16 real runs.

Same-failure search:

- The only other "use search results" instruction for a source was the Ashby one; Greenhouse and Lever postings come from fetched job lists. One dead Lever pair in a before run came from a run that fetched no Lever list; no Lever dead links in the after runs. Codex was not measured (decision 1A covered Claude runs only).

Sensitive data gate:

- The SOW names the probed board only as `[BOARD]`, uses invented profiles, and records hosts, counts, flags and costs only. Run logs stay in git-ignored `.tmp/sow17-probes/`.

Artifact maintenance gate:

- `AGENTS.md`: unaffected (no workflow change).
- Runtime project skills: `project-agent-adapter` updated (v4, Ashby behaviour and measurements).
- Specs: `product-v1.md` prompt description updated to v4.
- End-user/operator docs: README unaffected; it does not describe the prompt's steps, and the visible behaviour (dead links hidden by default) is unchanged.
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/`.

Spec update: see above.

Project skill update: see above.

## Outcome

- Prompt v4 tells the agent to open each Ashby posting once before returning it and drop any that fails to load. Over 8 measured runs per side, dead Ashby links fell from 10 of 69 to 0 of 69, live jobs rose from 70 to 86, and the reported estimate rose from $5.25 to $6.41.

## Lessons Extracted

- A prompt line that allows returning unopened postings ("use search results") produces dead links whenever the search index is stale; the agent's own choice to open pages varies run to run (4 to 22 pages for the same scope). Recorded in `project-agent-adapter`.
- Measure one worker alone with the app's own prompt, adapter and verifier: 8 runs cost about the same as one full Max run.

## Followup

- Codex behaviour with v4: not measured; rejected as a follow-up because decision 1A limited measurement to Claude and the rule is agent-neutral text. Reported to the user.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
