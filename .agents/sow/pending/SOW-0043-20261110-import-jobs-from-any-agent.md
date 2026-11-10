# SOW-0043 - Import jobs found by any agent client

## Status

Status: open

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: tracked from SOW-0042 (issue #29 part B); analysis and design decisions not started.

## Requirements

### Purpose

Let the user run a job search prompt in any agent client they already use (a chat app or their own CLI session) and bring the results into the app (issue #29, part B).

### User Request

Issue #29: "Allow users to run a prompt on their agent client and send data to the app." The user chose to deliver it after part A, as its own SOW (SOW-0042 decision 1C). The recommended shape was: the app offers a ready-to-copy prompt, the user pastes the JSON result back, and the app validates, checks links, dedupes and saves it as a search round; a documented local endpoint for agents with a shell can follow on the same backend.

### Assistant Understanding

Facts:

- `jobs.run_id` is `NOT NULL REFERENCES runs(id)` (`src/server/db/migrations.ts`), so imported jobs need a run row or a schema change.
- Link checks, dedupe and found-again rules live in `src/server/services/discovery.ts` after the agent result.
- Requests without an `Origin` header pass the request guard (`src/server/api/guard.ts`), so a local non-browser client can already call the API.

Unknowns (need user decisions):

- How an imported round appears (run kind, adapter id, label).
- Paste format (JSON only, or tolerant extraction like the agent path).
- Whether the copied prompt includes the custom text from SOW-0042.
- Whether to document the endpoint for agents in this SOW.

### Acceptance Criteria

To be written with the design decisions.

## Analysis

Not started.

## Pre-Implementation Gate

Status: blocked

Open decisions:

- Listed under Unknowns; analysis must be completed and decisions taken before implementation.

## Implications And Decisions

None yet.

## Plan

Not started.

## Execution Log

None yet.

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
