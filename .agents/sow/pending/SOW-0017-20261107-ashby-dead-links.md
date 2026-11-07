# SOW-0017 - Dead Ashby links from Max-effort discovery

## Status

Status: open

Sub-state: created at SOW-0016 close (user decision 22A, 2026-11-07); needs measurement before any fix is chosen.

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
- Whether WebFetch of a `jobs.ashbyhq.com` posting page (a client-rendered app) shows enough to confirm a posting is open.

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

None yet.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- Created from SOW-0016 decision 22A.

## Validation

Pending.

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
