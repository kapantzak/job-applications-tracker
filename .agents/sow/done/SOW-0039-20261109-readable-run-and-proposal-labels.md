# SOW-0039 - Readable run and proposal labels

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: implemented, validated and committed with the work on 2026-11-10 on branch `custom-prompt` (PR #32; user approved the commit and expanded the scope with decision 7).

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
- Same-failure sweep (2026-11-10, after SOW-0042/0043 on `custom-prompt`) also found `src/ui/pages/ApplicationDetailPage.tsx:188` (history `{from_status ?? 'none'} → {to_status}`, raw) and `:191` (history source `user`/`proposal`, raw). There are now three run kinds (`import_jobs` from SOW-0043). Already readable: Jobs verification badges, application statuses elsewhere (`STATUS_LABELS`), Dashboard cards, Settings.
- `README.md:106` says a cancelled run "shows as aborted".

Inferences:

- Run kind ids are also searched and filtered on the Runs page; changing only the visible text without the filter values would make filter options disagree with the rows.

Unknowns:

- None that investigation cannot resolve; the design choices below need the user.

### Acceptance Criteria

- Review, Run, Runs and the application page show readable labels for application status, run kind, run status, agent and status history; tests assert the labels.
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

Status: ready

Problem / root-cause model:

- Display code renders stored enum ids directly; SOW-0038 decision 5 covered only form controls.

Evidence reviewed:

- Files and lines listed under Facts; SOW-0038 Validation (same-failure scan).

Affected contracts and surfaces:

- UI text only: Review, Run, Runs, application page (history); `src/ui/labels.ts`; `runAgentLabel` in `src/ui/agent-choices.ts`. Stored values, API, URL filter keys and logs unchanged. UI tests; README text (line 106) and screenshots `review.png`, `run.png`; spec UI bullets.

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

- All resolved (see Implications And Decisions).

## Implications And Decisions

User decisions, 2026-11-10 (all recommended options except 6):

1. Run kinds read "Job search" (`discover_jobs`), "Gmail sync" (`sync_mail`), "Import" (`import_jobs`) (**A**), matching the Run page's own description.
2. Run statuses read Queued, Running, Succeeded, Failed and "Stopped" for `aborted` (**B**); README line 106 changes to match.
3. No raw ids in the UI (**A**); the log and "Show raw output" keep the stored lines for debugging.
4. Application history reads as sentences (**B**): the first entry "Added as <Status>", later ones "<Status> → <Status>"; the source "Changed by you" (`user`) or "Accepted from a Gmail sync proposal" (`proposal`). The Review line reads "<Status> → <Status> (<n>%)".
5. Runs search and Kind/Status filter options use the labels (**A**); stored values and URL filter keys stay ids, as on Jobs and Applications.
6. Implemented on the existing `custom-prompt` branch (**B**, user's choice), so PR #32 also covers issue #8's remaining labels.

7. Scope expansion (user, 2026-11-10, after the review): align the Dashboard's run wording with the kind labels. "Last discovery" becomes "Last job search", "Last sync" becomes "Last Gmail sync", and the Agent card titles "Discovery" / "Mail sync" become "Job search" / "Gmail sync". Settings → Agent keeps its own lowercase `label` wording, since it was not part of the request.

Derived:

- The agent reuses `ADAPTER_LABELS` (Claude Code, Codex, Custom command) without monospace; "Pending" and "Not recorded" stay.
- The Runs Kind column sorts by label.

## Plan

See Pre-Implementation Gate.

## Execution Log

### 2026-11-09

- Created from SOW-0038 follow-up mapping (decision 12: A).

### 2026-11-10

- Moved to `current/`; same-failure sweep repeated; decisions recorded.
- `src/ui/labels.ts`:
  - `RUN_KIND_LABELS`, `RUN_STATUS_LABELS`, `HISTORY_SOURCE_LABELS`, `historyChangeLabel`.
- `src/ui/agent-choices.ts`:
  - `runAgentLabel` and `selectionSummary` use `ADAPTER_LABELS`.
- Pages: `RunPage.tsx`, `RunsPage.tsx` (labels, search, sort, filter option labels), `ReviewPage.tsx`, `ApplicationDetailPage.tsx`.
- Intros (`src/ui/help-text.ts` `run`, `runs`, and the README Tour line):
  - now name imports. This was a SOW-0043 gap, found on the sandbox Runs page.
- README line 106 now says "Stopped".
- Screenshots `docs/images/run.png` and `review.png` re-taken.
- Decision 7:
  - `RUN_SUFFIXES` titles in `src/ui/agent-choices.ts`; the "Last successful runs" card in `DashboardPage.tsx`; spec line on that card.
  - `docs/images/dashboard.png` re-taken: Breakdown view, the default for this profile. The card's first line shows at the bottom edge.
- Deviation from the gate, found by review:
  - the Dashboard Agent card (`selectionSummary`) also showed raw adapter ids. My sweep searched JSX only, and this string is built in a helper. Fixed in this SOW, since the decision was "no raw ids in the UI".

## Validation

Acceptance criteria evidence:

- Labels on every screen:
  - `test/ui/RunPage.test.tsx`: Kind "Job search", Status and badge "Stopped", agent Claude Code / Codex / Custom command, intro.
  - `test/ui/RunsPage.test.tsx` ("names kinds and statuses in words, searchable by those words, while the URL keeps the ids", "sorts the Kind column by its label").
  - `test/ui/ReviewPage.test.tsx` ("Applied → Interview (85%)").
  - `test/ui/ApplicationDetailPage.test.tsx` ("describes each status change in words, saying who made it").
  - `test/ui/DashboardPage.test.tsx` (Agent card "Job search: Claude Code …", "Last job search: …", "Last Gmail sync: never").
- Search and filters agree with the labels:
  - the Runs tests check the exact Kind and Status option lists (no raw ids), search by "gmail sync" and "stopped", and `kind=import_jobs` in the URL.
- Screenshots re-taken under the AGENTS.md procedure:
  - `run.png` and `review.png`;
  - `dashboard.png` re-taken for decision 7 (the Agent card is below the fold, but the "Last job search" line shows at the bottom edge).

Tests or equivalent validation:

- `npm run typecheck`: no errors.
- `npm test`: "Test Files 77 passed (77)", "Tests 1178 passed (1178)", no warnings (after decision 7).
- `npm run build`: succeeds.

Real-use evidence:

- Built app on the mock sandbox, captured with Playwright at 1440×900, light, `en-GB`:
  - Run page: Gmail sync / Succeeded / Claude Code.
  - Review: "Applied → Screening (88%)".
  - Runs table: Gmail sync, Job search, Stopped, Failed, Succeeded.
  - An application's history: "Applied → Screening", "Changed by you".
- Every image was inspected: invented companies and `example.com` addresses only.

Reviewer findings:

- Independent reviewer (subagent, fresh context, given the diff and the SOW):
  1. Medium: the Dashboard Agent card showed raw adapter ids. Fixed; its test was updated.
  2. Low: the Dashboard's "Last discovery" / "Last sync" and the Agent card's "Discovery" / "Mail sync" use different words from the new run kind labels. Reported to the user; the user expanded the scope (decision 7), and it is implemented.
  3. Low: sorting the Kind column by label was untested. Test added.
  4. Low: weak filter-option assertion, no Status option check, and no Codex or Custom command agent test. Replaced with exact option lists; agent tests added.

Same-failure scan:

- JSX sweep: `grep -rnE "\{[a-zA-Z_.?]*\.(status|kind|state|source|remote|adapter_id|...)\}" src/ui`, plus label-map users.
- Second pass for strings built outside JSX (template literals using `adapter_id`, `kind`, `status`), which found `selectionSummary`.
- Remaining raw ids are only in run logs, kept by decision 3.

Sensitive data gate:

- Screenshots and tests use invented data only. No Settings → Agent or Data screens were captured, per AGENTS.md. No secrets or personal data are in the durable artifacts.

Artifact maintenance gate:

- AGENTS.md: no change. The screenshot procedure was followed as written.
- Runtime project skills: no change. No API, adapter or test-harness behaviour changed, and the new tests use existing patterns.
- Specs: `.agents/sow/specs/product-v1.md`, new "Readable display labels (SOW-0039)" bullet.
- End-user/operator docs:
  - `README.md` line 106 ("Stopped") and the Tour's Run line;
  - `docs/images/run.png`, `review.png`, `dashboard.png`.
- End-user/operator skills: none exist.
- SOW lifecycle: closes to `done/` as `completed` with the work in one commit on `custom-prompt` (PR #32).

Specs update:

- As listed above.

Project skills update:

- None needed; reason above.

End-user/operator docs update:

- As listed above.

End-user/operator skills update:

- None exist.

Lessons:

- A same-failure sweep for displayed ids must also search strings built in helpers, not only JSX expressions. The JSX-only grep missed `selectionSummary`.

Follow-up mapping:

- Dashboard wording: implemented (decision 7).

## Outcome

Run, Runs, Review, the application page and the Dashboard show readable words instead of stored ids, and the Dashboard names run kinds as the other screens do. Searches and filters use the same words, while URLs, the API and logs keep the ids.

## Lessons Extracted

- Recorded under Validation → Lessons.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
