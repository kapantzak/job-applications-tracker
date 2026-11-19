# SOW-0046 - Split date filters into "from" and "to"

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: implemented, reviewed, validated and committed with the work on 2026-11-18 on branch `Application-date-filter`.

## Requirements

### Purpose

Let users filter a list from a date until the present (or up to a date) without picking both ends of a range.

### User Request

"In the /applications path, I want to split "Applied" filter to "Applied from" and "Applied to", so that users would be able to pick only "Applied from" to view applications from date x until present for example."

The user then approved applying the same split to every date filter (decision 2B).

### Assistant Understanding

Facts:

- The filter model already supports open ends: `DateRange` has nullable `from` and `to` (`src/ui/table-view.ts:33-36`), the URL carries `<id>=YYYY-MM-DD..YYYY-MM-DD` with either end optional (`src/ui/table-view.ts:75-84,127-128`), and `test/ui/ApplicationsPage.test.tsx` ("filters the Applied date…") loads `?applied=2026-10-01..`.
- The UI cannot create an open end. `DateFilter` (`src/ui/components/TableView.tsx:160-191`) renders `<Calendar mode="range">`; react-day-picker 10.0.2 `addToRange` (`node_modules/react-day-picker/dist/esm/utils/addToRange.js`) turns the first click on an empty range into `{ from: day, to: day }`, a one-day filter. "From X onward" is reachable only by editing the URL; picking today as the end freezes the end date.
- `DateFilter` is shared by four columns: Applications Applied, Jobs Found, Runs Started and Runs Finished (`ApplicationsPage.tsx:64`, `JobsPage.tsx:174`, `RunsPage.tsx:48,53`).

Inferences:

- Users expect an open "to" end to mean "until now", which matches the current open-range semantics (no upper bound).

Unknowns:

- None.

### Acceptance Criteria

- Each date column shows two toolbar buttons, "<Label> from" and "<Label> to", each opening a single-day calendar. Page tests on Applications, Jobs and Runs.
- Picking only "from" keeps rows on or after that local day, with no upper bound; picking only "to" keeps rows on or before that day; both together form an inclusive range. Unit and page tests.
- The "from" calendar disables days after the "to" day and the "to" calendar disables days before the "from" day; the same day is allowed in both. Page test.
- Each button shows its own day when set and has its own Clear, which leaves the other end in place. Page test.
- The URL format is unchanged (`<id>=from..to`, either end optional); existing links keep working. Unit tests stay green.
- Spec, README and README screenshots that show the toolbar are updated.

## Analysis

Sources checked:

- `src/ui/table-view.ts`, `src/ui/components/TableView.tsx`, `src/ui/hooks/use-table-view.ts`.
- `src/ui/pages/ApplicationsPage.tsx`, `src/ui/pages/JobsPage.tsx`, `src/ui/pages/RunsPage.tsx`.
- `test/ui/table-view.test.ts`, `test/ui/ApplicationsPage.test.tsx`, `test/ui/JobsPage.test.tsx`, `test/ui/RunsPage.test.tsx`.
- `.agents/sow/specs/product-v1.md:158`, `README.md:297`, `docs/images/applications.png`, `docs/images/jobs.png`.
- `.agents/sow/done/SOW-0029-20261109-table-sort-search-filters.md` (original filter decisions 6 and 7, review fix 5 for "Until" ranges).
- `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md`: no overlap.
- react-day-picker 10.0.2 `addToRange`.

Current state:

- One "Applied" button with a range calendar; hint "Pick the first day, then the last."; badge from `dateRangeLabel` ("From X", "Until X", "X – Y").
- `DateFilter.onSelect` carries a special case that adds a start day to an "Until"-only range from the URL (SOW-0029 review fix 5).

Risks:

- The Runs toolbar grows from four to six filter buttons; it wraps (`flex-wrap`), so no overflow.
- Removing the range calendar removes `dateRangeLabel` and the "Until" special case; both become dead code and their tests are replaced.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The range calendar cannot express a one-sided range because react-day-picker's range mode sets both ends on the first click. The data model and URL already handle one-sided ranges; only the input is missing.

Evidence reviewed:

- Code and tests listed under Analysis; react-day-picker 10.0.2 `addToRange` source in `node_modules`.
- SOW-0029 decisions 6 and 7 (date filters on a shadcn Calendar).

Affected contracts and surfaces:

- UI: toolbar on Jobs, Applications and Runs (button names "Filter by <label> from|to", popover names the same).
- Shared modules: `src/ui/components/TableView.tsx`, `src/ui/table-view.ts`.
- URL query: unchanged format.
- Tests: `test/ui/table-view.test.ts`, `test/ui/ApplicationsPage.test.tsx`, `test/ui/JobsPage.test.tsx`, `test/ui/RunsPage.test.tsx`.
- Docs: `.agents/sow/specs/product-v1.md`, `README.md`, `docs/images/applications.png`, `docs/images/jobs.png`.
- Server, API, agent, prompts, sandbox seed: unaffected (client-side filtering only, URL format unchanged).

Existing patterns to reuse:

- `ColumnFilter` popover trigger with badge, `Calendar` from `src/ui/components/ui/calendar.tsx`, `fromIsoDay`/`toIsoDay`, `view.setFilter`.
- Page tests pin today with `vi.useFakeTimers({ toFake: ['Date'] })` and click days by accessible name (project-testing skill).

Risk and blast radius:

- UI-only, client-side; no data, migration or security impact. Regression risk is limited to the three list pages' date filters, covered by page tests.

Sensitive data handling plan:

- Tests and screenshots use invented data only (`npm run sandbox:mock`). Screenshots exclude Settings → Agent and Settings → Data and are checked for personal data before commit.

Implementation plan:

1. Tests first: replace range-calendar tests with from/to tests (unit + three pages).
2. `TableView.tsx`: render two bound filters per date column, single-day calendar, disabled days, per-bound Clear and badge; drop the range calendar and the "Until" special case.
3. `table-view.ts`: replace `dateRangeLabel` with a per-day label helper; keep parse/write/apply unchanged.
4. Docs: spec line 158, README line 297; re-take `applications.png` and `jobs.png`.

Validation plan:

- `npx vitest run` on the touched files, then `npm test`, `npm run typecheck`, `npm run build`.
- Real use: `npm run sandbox:mock -- --no-open --port 0` in Chrome: pick only "Applied from", only "Applied to", both; check disabled days and URL.
- Independent reviewer subagent on the diff.
- Same-failure search: every `kind: 'date'` column and every `mode="range"` use.

Artifact impact plan:

- AGENTS.md: likely unaffected (no new command, package or workflow).
- Runtime project skills: `project-testing` table-toolbar note names "Filter by <column>"; update if the from/to naming needs a testing note.
- Specs: `.agents/sow/specs/product-v1.md` table filter paragraph.
- End-user/operator docs: `README.md` table bullet and the two screenshots.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW; close with the work in one commit.

Open-source reference evidence:

- None: react-day-picker behaviour was read from the installed package (10.0.2) in `node_modules`, not from a mirrored repository.

Open decisions:

- None; see Implications And Decisions.

## Implications And Decisions

User decisions, 2026-11-18 ("All recommended"):

1. UI shape: **A**, two toolbar buttons "<Label> from" and "<Label> to", each with a single-day calendar.
2. Scope: **B**, all four date columns (Applications Applied, Jobs Found, Runs Started and Finished). Long-term-best: one filter style.
3. URL format: **A**, keep one key `<id>=from..to`; each button writes its own end.
4. Reversed ends: **A**, the "from" calendar disables days after "to" and the "to" calendar disables days before "from".

User decisions after review, 2026-11-18 ("All recommended"):

5. Re-clicking the selected day: **A**, keep clearing that end (same as the replaced range calendar; Clear also offered).
6. Jobs "Found from" / "Found to" labels: **A**, keep the "<Label> from/to" pattern on every table.

## Plan

1. Tests first (unit and page).
2. Component and helper change.
3. Docs, spec, screenshots.
4. Validation, review, close.

## Execution Log

### 2026-11-18

- SOW created with decisions 1A, 2B, 3A, 4A.
- Tests first: `test/ui/table-view.test.ts` (`dayLabel`, `withDateBound`), `test/ui/ApplicationsPage.test.tsx` (URL probe added; from only, to only, disabled days, clear one end), `test/ui/JobsPage.test.tsx` (from then to, clear "to"), `test/ui/RunsPage.test.tsx` (button names, "Finished to" only). All 10 failed for the expected reason (missing buttons and helpers) before the change.
- `src/ui/table-view.ts`: `dateRangeLabel` replaced by exported `dayLabel`, `DateBound` and `withDateBound`; parse, write and apply unchanged.
- `src/ui/components/TableView.tsx`: the toolbar renders two `ColumnFilter`s per date column with a `bound`; `DateFilter` uses `Calendar mode="single"` with a `disabled` matcher from the other end (`{ after }` / `{ before }`, so the other end's own day stays enabled), per-end Clear and hint "This day and later." / "This day and earlier."; the range-calendar "Until" special case (SOW-0029 review fix 5) is gone because a one-ended range is now a normal state.
- Docs: spec table paragraph, README table bullet, `project-testing` toolbar note; `docs/images/applications.png` and `docs/images/jobs.png` re-taken (toolbar changed).
- No deviation from the decided design.
- Independent reviewer (fresh subagent, diff only): no significant findings; low-severity items handled under Validation → Reviewer findings.

## Validation

Acceptance criteria evidence:

- Two buttons per date column: Applications "renders…"/date tests, Jobs "filters the Found date with a "from" day, then a "to" day…", Runs "filters the Finished date up to a picked "Finished to" day…" (asserts "Filter by started from/to" too). Real use listed the toolbars: Applications `Applied from`, `Applied to`; Jobs `Found from`, `Found to`; Runs `Started from`, `Started to`, `Finished from`, `Finished to`.
- From only / to only / both: Applications "keeps every application on or after a picked "Applied from" day, with no end" (`?applied=2026-11-03..`), "keeps every application up to a picked "Applied to" day" (`?applied=..2026-11-03`); Jobs test picks both (`?found=2026-11-04..2026-11-04`); unit tests in `test/ui/table-view.test.ts` ("includes both ends…", `withDateBound`).
- Disabled days: Applications "disables days on the wrong side of the other end" (URL-loaded range); Jobs test checks the "to" calendar disables Nov 3 after "from" = Nov 4 was picked in the UI. Same day stays enabled (react-day-picker 10.0.2 `{ after }`/`{ before }` are strict, confirmed by the reviewer in `dist/esm/utils/dateMatchModifiers.js`).
- Own day and own Clear: Applications "clears one end and keeps the other" (`?applied=2026-10-01..`); Jobs test checks both badges ("Filter by found from: <day>", "Filter by found to: <day>") and clears "to" only.
- URL format unchanged: existing `parseView`/`writeView` unit tests pass untouched; Runs "filters the Started date" (`?started=2026-11-02..2026-11-06`) unchanged and green.
- Docs: spec, README and both screenshots updated (see Artifact maintenance gate).

Tests or equivalent validation:

- `npm test`: `Test Files  81 passed (81)`, `Tests  1293 passed (1293)`; no warnings or `act(...)` output (grep count 0).
- `npm run typecheck`: clean.
- `npm run build`: succeeds; the existing >500 kB chunk warning remains (main UI chunk 679.08 kB, gzip 205.87 kB).
- The 10 new or rewritten tests failed before the change for the expected reason (missing buttons and helpers).

Real-use evidence:

- `npm run sandbox:mock -- --no-open --port 0`, driven by `playwright-core@1.58` from `.tmp/shots` at 1440×900, light, on the invented "Frontend Platform" profile (9 applications): Applied from 1 Nov 2026 → 3 rows, URL `?applied=2026-11-01..`; adding Applied to 9 Nov 2026 → 2 rows, URL `?applied=2026-11-01..2026-11-09`, badges "1 Nov 2026" and "9 Nov 2026"; in the "from" calendar 10 Nov disabled and 9 Nov enabled; in the "to" calendar 1 Nov enabled; Clear on "from" → 7 rows, URL `?applied=..2026-11-09`; reload kept the view; Reset → 9 rows. No console errors. Sandbox server stopped by its own PID afterwards.

Reviewer findings:

- Independent subagent review: no correctness bugs, no stale docs; it also ran the four test files under `TZ=Pacific/Kiritimati` and `TZ=Pacific/Pago_Pago` (pass). Low-severity items:
  1. Re-clicking the selected day clears that end (react-day-picker single mode without `required`). Kept: the replaced range calendar behaved the same way (`addToRange` returns `undefined` for a one-day range re-clicked when not `required`), and Clear is also offered. Reported to the user as an optional change.
  2. "Found from" next to "Found in" on Jobs may read ambiguously. Follows decision 1A naming; reported to the user as an optional label tweak.
  3. Test gaps (no "to" badge check; disabled days only from a URL-loaded range): fixed in `test/ui/JobsPage.test.tsx`.
  4. Skill note made Escape sound mandatory: reworded to say why it is used.

Same-failure scan:

- `grep -rn 'mode="range"\|DayRange\|dateRangeLabel' src test`: no matches.
- `grep -rn "kind: 'date'" src`: the four columns (Applications Applied, Jobs Found, Runs Started, Runs Finished), all rendered through the shared `ColumnFilter`/`DateFilter`.
- `grep -rn "first day, then the last\|date range on a calendar" src README.md .agents/sow/specs`: no matches.

Sensitive data gate:

- Tests use invented companies (Acme, Globex, Initech) and dates. Screenshots come from the mock sandbox (invented companies) and show only Applications and Jobs, not Settings → Agent or Settings → Data. This SOW cites no personal data, paths outside the repo, or run logs.

Artifact maintenance gate:

- AGENTS.md: no update; no new command, package, workflow or guardrail (react-day-picker was already a devDependency; `calendar.tsx` unchanged).
- Runtime project skills: `.agents/skills/project-testing/SKILL.md` table-toolbar note gains the from/to filter names, the `($|:)` trigger match and the Escape tip.
- Specs: `.agents/sow/specs/product-v1.md` table paragraph describes the from/to filters.
- End-user/operator docs: `README.md` table bullet; `docs/images/applications.png` and `docs/images/jobs.png` re-taken because their toolbars changed. Other images do not show a date filter (`run.png` is the single Run page, not the Runs list).
- End-user/operator skills: none exist in this repository.
- SOW lifecycle: single SOW; `Status: completed` and the move to `.agents/sow/done/` are committed with the work in one commit.

Specs update:

- `.agents/sow/specs/product-v1.md` (table sorting, search and filters paragraph).

Project skills update:

- `.agents/skills/project-testing/SKILL.md` (table toolbars bullet).

End-user/operator docs update:

- `README.md` and two README screenshots, as above.

End-user/operator skills update:

- None exist; the AGENTS.md index lists "Output/reference skills: none".

Lessons:

- See Lessons Extracted.

Follow-up mapping:

- Re-click clears an end, and the "Found from" label: rejected; the user confirmed keeping both as they are (decisions 5A and 6A below).
- "Today" shortcut in the "to" calendar: rejected as unrequested scope; an open "to" end already means "until now".
- Pre-close search for `defer|later|follow-up|future|TODO|pending`: only the "later" in the "from" hint wording and this mapping; nothing left untracked.

## Outcome

Every date filter on the Jobs, Applications and Runs pages is now two buttons, "<Label> from" and "<Label> to", so a user can pick only "Applied from" to see applications from that day until today. The URL format and filtering logic are unchanged.

## Lessons Extracted

- react-day-picker range mode cannot express a one-sided range from the UI (first click sets both ends); one-sided filters need separate single-day inputs. Recorded here; the testing-relevant part is in the project-testing skill.

## Followup

None. See Follow-up mapping.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
