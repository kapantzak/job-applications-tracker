# SOW-0029 - Sort, search and filter the Jobs, Applications and Runs tables

## Status

Status: completed

Sub-state: delivered, reviewed, validated.

## Requirements

### Purpose

Let the user find rows in the three list tables quickly as the lists grow: sort by any column, search, and filter by every column, including dates (GitHub issue #20).

### User Request

Issue #20 "Tables": "Tables should be sorted by any column and be searchable. Also add filters." The user added: "Add filters for all available columns, also add date filter."

### Assistant Understanding

Facts:

- Three tables exist: Jobs (`src/ui/pages/JobsPage.tsx`), Applications (`src/ui/pages/ApplicationsPage.tsx`) and Runs (`src/ui/pages/RunsPage.tsx`). None sorts, searches or filters on the client; each shows the server order (newest first).
- Jobs columns: Company, Title, Location, Source, Fit, Status (link verification), Actions (which also shows the application status badge). "Show dead links" and "Show dismissed" are server-side filters (`listJobs` options). Rows carry `created_at` and `posted_at`, neither shown.
- Applications columns: Company, Role, Status (editable select), Applied (`applied_at`, null for saved applications), Actions.
- Runs columns: Kind, Status, Started, Finished, Result, Actions. The page calls `listRuns(profileId)`; the server default is 50 rows, maximum 200 (`src/server/api/runs.ts:13,65`).
- Jobs and Applications endpoints return every row of the profile.

Inferences:

- Lists are local SQLite data of at most a few hundred rows, so filtering in the browser is fast enough.

Unknowns:

- None blocking. react-day-picker's current major (10) is newer than the shadcn calendar source was written for (registry pins `@latest`); the build decides whether v10 compiles with it, else v9.14.0 is used (implementation detail, recorded in the execution log).

### Acceptance Criteria

- Every column except Actions sorts by clicking its header: ascending, descending, then back to the default newest-first order; one column at a time; `aria-sort` set; empty values last; statuses in lifecycle (enum) order; Fit by number of passes. Verified by unit tests of the sort function and page tests.
- Each table has a search box matching its visible text columns, case-insensitive, combined (AND) with filters. Page tests.
- Every column has a filter in a toolbar above the table (popover per column): value checklists with counts, text "contains" or a date range picked on a calendar. Active filters show on their button; Reset clears search and filters. Page tests.
- Jobs gains a "Found" column (`created_at`) with a date filter; Applications filters on Applied; Runs on Started and Finished. A set range excludes rows without a date; days are local and both ends inclusive. Unit and page tests.
- Search, filters and sort live in the URL query and survive leaving to a detail page and coming back. Page test via route change.
- "Showing N of M" is shown; with no match the table is replaced by "No rows match your filters" and a Clear filters button. Page tests.
- The Runs page loads the newest 200 runs and says so when the limit is reached. Page test.
- A row that stops matching after an edit leaves the list at once. Page test (Applications status change).
- `npm run typecheck`, `npm test`, `npm run build` pass; manual check in `npm run sandbox:mock`.

## Analysis

Sources checked:

- `src/ui/pages/{Jobs,Applications,Runs}Page.tsx`, `src/server/domain/types.ts`, `src/server/api/runs.ts`, `src/server/db/{jobs,applications,runs}-repo.ts`, `src/ui/{format,labels}.ts`, `src/ui/components/{VerificationBadge,StatusSelect}.tsx`, `src/ui/components/ui/*`, `components.json`.
- `test/ui/{Jobs,Applications,Runs}Page.test.tsx`, `test/ui/setup.ts`.
- `.agents/sow/specs/product-v1.md` (User interface section), `README.md`, `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` (no overlap; its focus-after-dismiss item is unrelated).
- shadcn registry items `calendar` and `popover` read with `npx shadcn@4.23.0 view calendar popover`.

Current state:

- See Facts. No shared table helper exists; each page renders shadcn `Table` directly.

Risks:

- The Runs list re-reads every second after a cancel and the Jobs list reloads after a dismiss; view state must not reset on reload. State lives in the URL, independent of the rows.
- Radix Popover renders in a portal; tests must scope queries to the dialog.
- Agent-supplied dates can be unparseable; such rows never match a date range and sort last.
- New packages: `react-day-picker` (pulls `date-fns`, `@date-fns/tz`) as devDependencies, bundled by Vite into `dist/ui`.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The tables render server rows as they arrive with no client-side view logic, so the user cannot reorder or narrow them. Evidence: the page files above contain no sort, search or filter code.

Evidence reviewed:

- Code, tests, spec and README listed under Sources checked; issue #20.

Affected contracts and surfaces:

- UI: the three pages, new shared view module, hook and toolbar components, new shadcn `popover.tsx` and `calendar.tsx` under `src/ui/components/ui/`.
- Page URLs gain query parameters (`q`, `sort`, one key per filtered column). No API, schema or server change; the Runs page passes `limit=200`, already accepted by the API.
- `package.json` / `package-lock.json`: `react-day-picker` devDependency.
- Tests: `test/ui/{Jobs,Applications,Runs}Page.test.tsx`, new `test/ui/table-view.test.ts`.
- Docs: `.agents/sow/specs/product-v1.md`, `README.md`.

Existing patterns to reuse:

- shadcn components from `src/ui/components/ui/` (Button, Input, Checkbox, Badge, Table, Label); badge and status labels from `src/ui/labels.ts` and `VerificationBadge`; `formatTime`; enum arrays from `domain/types.ts`; `useSearchParams` from react-router; shadcn add hazard handling from AGENTS.md (`view` + import fix).

Risk and blast radius:

- UI-only. Regression risk in the existing page behaviours (save, mark applied, dismiss, status change, cancel polling); covered by the existing page tests, which must stay green.
- No data, migration or security impact; URL parameters are parsed defensively (unknown keys and bad values ignored).

Sensitive data handling plan:

- Tests and docs use invented companies (Acme, Globex) and example domains only. No real logs or mail.

Implementation plan:

1. Pure view module `src/ui/table-view.ts`: column definitions, URL parse/write, search, filters (values, text, date), sort, facet counts. Unit tests first.
2. Hook `src/ui/hooks/use-table-view.ts` over `useSearchParams` (writes with `replace`).
3. shadcn `popover` and `calendar` sources with the `@/lib/utils` import fix; install `react-day-picker` as a devDependency.
4. Components `src/ui/components/table-view/`: toolbar (search, filter buttons, Reset), values/text/date filter popovers, sortable header, result count and no-match state.
5. Wire Jobs (add Found column), Applications, Runs (limit 200 and note). Extend page tests.
6. Spec, README, SOW validation; build, sandbox manual check.

Validation plan:

- `npx vitest run test/ui/table-view.test.ts` and the three page tests during work; then `npm run typecheck`, `npm test`, `npm run build`.
- Manual: `npm run sandbox:mock`, exercise sort, search, every filter type, URL survival and Reset in a browser.
- Independent review of the diff before close; same-pattern search for other tables (`grep -rln "<Table" src/ui`).

Artifact impact plan:

- AGENTS.md: likely add react-day-picker to the UI-only devDependency list and note the new owned shadcn files.
- Runtime project skills: `project-testing` gains a note on testing popovers and calendar dates if a non-obvious technique is needed.
- Specs: `product-v1.md` User interface section describes sorting, search, filters, URL state, Runs limit and the Jobs Found column.
- End-user/operator docs: README gets a short note on sorting and filtering.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: single SOW; completed and moved to `done/` in the same commit as the work.

Open-source reference evidence:

- No mirrored repositories checked; shadcn registry sources were read through the shadcn CLI (`shadcn@4.23.0 view`), the same method as SOW-0010/0020/0023.

Open decisions:

- All resolved; see Implications And Decisions.

## Implications And Decisions

User decisions, 2026-11-09 (answers "1.A … 10.A", 7.B):

1. Sorting and filtering run in the browser over loaded rows (A).
2. The Runs page requests the newest 200 runs and says "Showing the newest 200 runs" when the limit is reached (A).
3. A small own module (pure functions, one hook, toolbar components) instead of TanStack Table (A).
4. A toolbar above each table: search box, one filter button per column opening a popover, active filters visible on their button, Reset (A).
5. Value checklists with counts for Jobs Company, Location, Source, Fit (has a mismatch / not stated / all match / no verdict), Status, Application (Not tracked, statuses); Applications Company, Status; Runs Kind, Status. Text "contains" for Title, Role, Result (A).
6. Date filters: Jobs gets a new "Found" column (`created_at`); Applications Applied; Runs Started and Finished. A set range drops rows without a date; local days, inclusive (A).
7. Date input is the shadcn Calendar range picker in a popover (B); adds `react-day-picker` (with `date-fns`) as devDependencies.
8. Header click cycles ascending, descending, default order; one column; Actions not sortable; statuses by lifecycle order; Fit by passes; empties last; `aria-sort` (A).
9. View state in the URL query (A).
10. A row that stops matching after an edit leaves the list at once (A).

Defaults stated to the user and not objected to: search covers visible text columns only; search AND filters; "Showing N of M"; "No rows match your filters" with Clear filters; Jobs "Show dead links" and "Show dismissed" stay server-side.

## Plan

See Implementation plan in the gate.

## Execution Log

### 2026-11-09

- SOW created from issue #20 with the user's decisions.
- Pure view module `src/ui/table-view.ts` with unit tests `test/ui/table-view.test.ts` written first; hook `src/ui/hooks/use-table-view.ts`; components `src/ui/components/TableView.tsx` (toolbar, sortable header, values/text/date filters, no-match state).
- shadcn `popover.tsx` and `calendar.tsx` written from `npx shadcn@4.23.0 view calendar popover` with the `cn` and button imports fixed (no `npx shadcn add`, so no `cn` package). `react-day-picker@10.0.2` added as a devDependency (brings `date-fns`, `@date-fns/tz`). v10 compiles with the registry calendar, so v9 was not needed.
- Jobs: new Found column (`created_at`); Application filter for the status shown in the Actions column. `VerificationBadge` now exports its labels for the Status filter.
- Runs: `listRuns(profileId, 200)` on all three calls, note "Only the newest 200 runs are loaded" when 200 arrive (wording adjusted from "Showing the newest 200 runs" so it does not repeat the "Showing N of M" line).
- Within the approved outcome of decision 9 (view survives Details and back): the Applications Details link and the Runs list link pass the list query in router state, and the back links on `ApplicationDetailPage` and `RunPage` use it (`useListLinkState`, `useListReturnHref`). Browser Back already worked; the in-page back links would otherwise drop the view.
- Review fixes (see Validation): draft-backed text inputs, distinct filter-button names, "Until" range extension, reversed range swap, whitespace-only text never written.

## Validation

Acceptance criteria evidence:

- Sort cycle, `aria-sort`, empties last, lifecycle order, Fit by passes: `test/ui/table-view.test.ts` (applyView, nextSort), `JobsPage.test.tsx` "sorts by a column…" and "sorts Fit…", `ApplicationsPage.test.tsx` "sorts statuses in lifecycle order…", `RunsPage.test.tsx` "sorts by Finished…".
- Search (case-insensitive, AND with filters): unit "searches the search columns…", "combines search and filters"; page "searches the text columns and counts what is shown", Runs "…searches the result".
- Value checklists with counts, text, date range on the calendar: Jobs "filters by checked values…", "filters by an empty value, the fit summary and the application status", "filters the title by text", "filters the Found date with a range picked on the calendar"; Applications "filters the Applied date…", "adds a start day to an 'until' range…", "filters by role text and by company"; Runs "filters by kind and status", "filters the Started date".
- URL state and survival: Jobs "reads the view from the URL and keeps it when the list reloads after a dismiss"; Applications "returns from Details to the same filtered view" and the plain-list case; RunPage "links back to the Runs list with the view it was opened from" and the direct case.
- Showing N of M and no-match state: Jobs "searches the text columns…", "says when nothing matches and clears search and filters, keeping the sort".
- Runs limit: "asks for the newest 200 runs and says so…", "does not mention the limit below it".
- Row leaves after an edit: Applications "drops a row from a status filter as soon as its status changes".

Tests or equivalent validation:

- `npm run typecheck`: exit 0.
- `npm test`: `Test Files  68 passed (68)`, `Tests  917 passed (917)`; no `act(...)` warnings in the output.
- `npm run build`: succeeds. Vite's existing >500 kB chunk warning remains; the main UI chunk grew from 538.65 kB (committed HEAD, built from a `git archive` copy under `.tmp/`) to 630.71 kB, gzip 163.97 → 191.19 kB, almost all from `react-day-picker`/`date-fns` (decision 7.B). Acceptable for a local app; lazy-loading the calendar is an opportunity, not required.

Real-use evidence:

- `npm run sandbox:mock -- --no-open --port 0`, Chrome: Jobs toolbar and Found column rendered; Found range picked on the calendar (19–20 Oct 2026, invented sandbox data) narrowed 11 to 7 rows and wrote `?found=2026-10-19..2026-10-20`; a single day with no jobs showed "No rows match your filters"; Status checklist showed counts over all loaded rows. Applications opened with `?sort=-applied&status=applied&status=interview` (3 of 9, Applied ↓), Details, then the page's back link returned to the same query. Runs toolbar and sortable headers rendered (6 runs). No console errors.
- After the review fixes, in the rebuilt sandbox: typed a search quickly, moved the caret 8 places left and typed two letters; they landed in place (`engineeXYr`) and the URL followed; Reset emptied the box and the URL.

Reviewer findings:

- Independent reviewer (fresh subagent, read-only, given the diff and the approved design):
  1. Medium, fixed: the search and "contains" boxes were controlled by URL state, which `BrowserRouter` updates inside `startTransition` (verified in `node_modules/react-router/dist/development/chunk-6KYCQHYJ.mjs` and `src/ui/main.tsx`), a known cause of caret jumps and lost keys. `DraftInput` in `TableView.tsx` keeps a local draft and follows the URL only on outside changes; tests "…a leading space stays in the box", Reset empties the box; manual check above.
  2. Medium, tracked: hand-entered Applied dates are stored as UTC midnight while the table and the new filter use local days; pre-existing model mismatch needing a user decision, `.agents/sow/pending/SOW-0030-20261109-applied-date-time-zone.md`.
  3. Low, fixed: a leading space was dropped and whitespace-only `q` stayed in the URL; `canonicalText` in `table-view.ts`, unit test "writes no whitespace-only search or text filter".
  4. Low, fixed: filter buttons and header sort buttons shared names; filter triggers are now named "Filter by <column>" plus the active choice; tests updated.
  5. Low, fixed: an "Until" range from the URL cleared on the first calendar click; `DateFilter` now adds the clicked day as the start; reversed hand-edited ranges are swapped. Tests added (unit and Applications).
  6. Low, tracked: focus falls to `body` when an edited row leaves a filtered list; added to `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` next to the existing focus-after-dismiss item.

Same-failure scan:

- `grep -rln "<Table" src/ui`: only the three pages, all covered. No other list view needs the toolbar.
- Other inputs controlled straight from URL state: none (`grep -rn "useSearchParams" src/ui` lists only `use-table-view.ts`).

Sensitive data gate:

- Tests, SOWs and docs use invented companies (Acme, Globex, Initech) and example domains; the sandbox data is the invented seed. No logs, mail or personal data copied.

Artifact maintenance gate:

- AGENTS.md: updated (UI-only devDependency list gains `react-day-picker`/`date-fns`; note on the owned `calendar.tsx`/`popover.tsx` sources).
- Runtime project skills: `.agents/skills/project-testing/SKILL.md` gains the toolbar/popover/calendar testing note.
- Specs: `.agents/sow/specs/product-v1.md` User interface section describes sorting, search, filters, URL format, back links and the Runs limit.
- End-user/operator docs: `README.md` Interface section describes sorting, search, filters and the Runs limit.
- End-user/operator skills: none exist (AGENTS.md lists "Output/reference skills: none").
- SOW lifecycle: status `completed`, moved to `.agents/sow/done/` in the same commit as the work; follow-ups mapped below.

Specs update:

- `.agents/sow/specs/product-v1.md` (User interface).

Project skills update:

- `.agents/skills/project-testing/SKILL.md`.

End-user/operator docs update:

- `README.md` (Interface).

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- jsdom tests cannot see input bugs caused by router transitions: `user.type` waits between keys. Inputs bound to URL state need a draft or a real-browser check.
- An open react-day-picker calendar adds grid rows; table assertions must scope to the table.

Follow-up mapping:

- Applied date time zone: tracked in SOW-0030 (needs user decision).
- Focus after a row leaves a filtered list: tracked in SOW-0005.
- Calendar lazy-loading to shrink the main chunk: rejected for now; the app is local and the bundle loads once from disk.
- The calendar opens on the current month (or the selected range); jumping to the newest row's month was not requested: rejected as unrequested scope.

## Outcome

The Jobs, Applications and Runs tables sort by any column, search, and filter by every column, with date ranges on a calendar. The view lives in the URL and survives detail pages. Issue #20 is addressed.

## Lessons Extracted

See Lessons above; recorded in `project-testing` where reusable.

## Followup

- SOW-0030 (Applied date time zone), SOW-0005 item (focus after a row leaves a filtered list).

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
