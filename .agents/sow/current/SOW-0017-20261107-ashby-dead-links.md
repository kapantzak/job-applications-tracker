# SOW-0017 - Dead Ashby links from Max-effort discovery

## Status

Status: in-progress

Sub-state: resumed 2026-11-07 after SOW-0018 landed; running the before measurements (decisions 1A, 2A as amended, 3B).

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

- To be set after measurement.

## Analysis

Sources checked:

- SOW-0016 Validation (real-use table and Max dead-link check).

Current state:

- See Facts.

Risks:

- Asking the agent to open every Ashby posting adds page fetches to every run and may not work if the page content is client-rendered.

## Pre-Implementation Gate

Status: blocked

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

1. Measure: several Max and Default runs on two invented profiles; record Ashby dead rate and fetch counts.
2. Probe what WebFetch returns for a live and a closed Ashby posting page.
3. Present options to the user with the numbers.

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

- The fix itself, after measurement.

## Implications And Decisions

User decisions (2026-11-07):

1. Measurement budget: A. Run the Max Ashby worker alone with the app's exact rendered prompt and flags; 2 invented profiles x 2 runs before the fix and the same after (8 runs, guessed at about $1 each).
2. Fix: A. Max Ashby worker only: its scope text tells it to open each Ashby posting once before returning it and drop any that fails to load. The shared prompt template is unchanged.
3. Delivery: B. Commit on the PR #11 branch (`multiple-levels-of-investigation-effort`).

Amendment (2026-11-07, user decision 2A after new evidence): keep the Max-worker-only fix, and add Default discovery runs to the before measurement (2 profiles x 2 runs, about $1 each) to see whether Default needs the fix too. If it does, the fix choice goes back to the user.

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
- Observation outside this SOW's scope: the probe agent addressed the user by name, which shows that `--setting-sources user` also loads the user's personal `~/.claude/CLAUDE.md` into every Claude run the app starts. Reported to the user.

## Validation

Pending until the work is done.

Sensitive data gate:

- Checked again at close. So far the SOW holds only placeholders (`[BOARD]`), section headings, flags and measured numbers: no personal data, names, credentials or private endpoints.

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
