# SOW-0039 - Readable run and proposal labels

## Status

Status: open

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: tracked from SOW-0038 follow-up mapping; analysis and design decisions not started.

## Requirements

### Purpose

Make the UI easy to read (issue #8): screens should show readable words, not stored ids.

### User Request

SOW-0038 gave form controls readable labels (Status, Sync interval, agent choices). The user chose to track the remaining display text that still shows raw ids as its own SOW (SOW-0038 decision 12, 2026-11-09).

### Assistant Understanding

Facts:

- `src/ui/pages/ReviewPage.tsx:74` shows proposals as `{current status} → {proposed status}` with raw ids (for example `applied → screening`, `no_response`).
- `src/ui/pages/RunPage.tsx:139` shows the run kind raw in monospace (`discover_jobs`, `sync_mail`; `RUN_KINDS` in `src/server/domain/types.ts:14`); `:129` and `:143` show the run status raw (`queued`, `running`, `succeeded`, `failed`, `aborted`; `src/server/domain/types.ts:20`).
- `src/ui/pages/RunPage.tsx:155` shows the agent through `runAgentLabel(run)` in monospace, which returns the raw `adapter_id` (`claude`, `codex`, `custom`; `src/ui/agent-choices.ts:47-50`).
- `src/ui/pages/RunsPage.tsx:173` shows the run kind raw as the row link; `:177` shows the run status raw in a badge; the kind column's search text and filter values (`:33-34`) use the raw kind.
- `src/ui/labels.ts` already holds `STATUS_LABELS`, `ADAPTER_LABELS` and `SYNC_INTERVAL_LABELS` (SOW-0038).
- The README screenshots `docs/images/review.png`, `run.png` show these raw ids.

Inferences:

- Run kind ids are also searched and filtered on the Runs page; changing only the visible text without the filter values would make filter options disagree with the rows.

Unknowns:

- None that investigation cannot resolve; the design choices below need the user.

### Acceptance Criteria

- Review, Run and Runs show readable labels for application status, run kind, run status and agent; tests assert the labels.
- Runs search and kind filter agree with the visible labels.
- Affected README screenshots re-taken under the AGENTS.md screenshot procedure.

## Analysis

Sources checked:

- `src/ui/pages/ReviewPage.tsx`, `src/ui/pages/RunPage.tsx`, `src/ui/pages/RunsPage.tsx`, `src/ui/labels.ts` (2026-11-09).

Current state:

- See Facts.

Risks:

- Tests that query by raw kind or status text break and must be updated.
- The Run page header and the dashboard may show the same ids; a same-failure search is required before implementation.

## Pre-Implementation Gate

Status: needs-user-decision

Problem / root-cause model:

- Display code renders stored enum ids directly; SOW-0038 decision 5 covered only form controls.

Evidence reviewed:

- Files and lines listed under Facts; SOW-0038 Validation (same-failure scan).

Affected contracts and surfaces:

- UI text only (Review, Run, Runs, possibly Dashboard); stored values and API unchanged; UI tests; README screenshots.

Existing patterns to reuse:

- `src/ui/labels.ts` label maps; `STATUS_LABELS` use in `StatusSelect.tsx`.

Risk and blast radius:

- UI-only text change; no data, API or migration impact.

Sensitive data handling plan:

- No sensitive data involved; screenshots follow the AGENTS.md procedure (mock sandbox, never Settings → Agent or Data).

Implementation plan:

1. Same-failure search for every raw enum rendered as text in `src/ui`.
2. Add label maps (run kind, run status) to `src/ui/labels.ts`; apply them in the found places, including Runs search and filter values.
3. Update tests; re-take affected screenshots.

Validation plan:

- `npm test`, `npm run typecheck`; mock sandbox check of Review, Run, Runs; image privacy check.

Artifact impact plan:

- AGENTS.md: likely unaffected.
- Runtime project skills: likely unaffected.
- Specs: `.agents/sow/specs/product-v1.md` User interface readable-labels bullet extended.
- End-user/operator docs: README screenshots re-taken.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW.

Open-source reference evidence:

- None; the change is local UI text.

Open decisions:

1. Label wording for run kinds (for example "Find jobs", "Sync mail") and run statuses.
2. Whether the Run page keeps the raw id visible anywhere (for example as secondary monospace text) for debugging.

## Implications And Decisions

None yet.

## Plan

See Pre-Implementation Gate.

## Execution Log

### 2026-11-09

- Created from SOW-0038 follow-up mapping (decision 12: A).

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
