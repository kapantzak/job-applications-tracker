# SOW-0057 - Clickable Journey branches

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered; closed with the work in one commit.

## Requirements

### Purpose

From the Dashboard Journey graph, the user goes straight to the applications behind a branch, so a number such as "4 waiting" becomes a way into that exact set.

### User Request

"On the dashboard, when user sees each branch with the number of applications and the state (for example "4 waiting"), he should be able to click this label and view the specific set of applications."

### Assistant Understanding

Facts:

- A Journey branch counts the sent applications whose furthest step (from status history) is the stage and whose current status is the branch (`waiting` = any status other than rejected, no response, withdrawn). Evidence: `src/server/domain/dashboard.ts:109-121`, spec `product-v1.md` line 99.
- The Applications page filters on current status only (`src/ui/application-view.ts:21-31`) and does not load history (`src/ui/pages/ApplicationsPage.tsx:84`), so a status-only link cannot reproduce a branch count.
- The Dashboard loads applications and history and runs `summarizeDashboard` in the browser over the rows the shared filters keep (`src/ui/pages/DashboardPage.tsx:143-153`).
- Tiles link to Applications with the shared view, status narrowed, as a one-time view (`tileQuery` in `src/ui/application-view.ts:44`, `ONE_TIME_VIEW` in `src/ui/view-storage.ts`).
- The graph is `<svg role="img">` with hover-only tooltips outside the tab order (`src/ui/components/dashboard/JourneyCard.tsx:196-205`; SOW-0034 Decision 7, SOW-0037). Links inside `role="img"` are presentational to assistive tech.
- The demo video script selects the graph by `svg[role="img"]` (`scripts/demo-video/record.mjs:472`), and shows the Applications toolbar and the Dashboard.
- README screenshots `docs/images/applications.png` and `docs/images/dashboard.png` show the Applications toolbar.

Inferences:

- Because the Dashboard toolbar and the Applications toolbar share `APPLICATION_COLUMNS`, the new filter appears in both toolbars and the Journey also follows it.

Unknowns:

- None; decisions 1-8 are recorded.

### Acceptance Criteria

- Each Journey branch (ribbon and label) is one link; following it opens Applications as a one-time view with the saved search and filters, status narrowed to the branch's statuses, and Furthest step set to the branch's stage; the visible rows equal the branch number. Verified by UI tests (Dashboard to Applications with the same fixtures) and a real browser check.
- Applications has a "Furthest step" filter (filter only, no column) computed from history with the same rule as the Dashboard (one shared function). Verified by unit tests on the shared function and Applications page tests.
- Branch links are keyboard reachable with an accessible name such as "3 rejected after the interview"; the graph keeps its whole-journey label as a group. Verified by UI tests.
- Status change and merge on Applications keep the Furthest step filter correct. Verified by UI tests.

## Analysis

Sources checked:

- `src/server/domain/dashboard.ts`, `src/ui/components/dashboard/JourneyCard.tsx`, `src/ui/components/dashboard/steps.ts`, `src/ui/pages/DashboardPage.tsx`, `src/ui/pages/ApplicationsPage.tsx`, `src/ui/application-view.ts`, `src/ui/view-storage.ts`, `src/ui/table-view.ts`, `src/ui/hooks/use-table-view.ts`, `src/ui/api/client.ts`, `scripts/demo-video/record.mjs`, `README.md`, `.agents/sow/specs/product-v1.md` (Dashboard, Journey, table views), SOW-0034, SOW-0037, SOW-0052, SOW-0054.

Current state:

- Branches are drawn and hoverable, not clickable; no way to list the applications behind them.

Risks:

- The furthest-step rule duplicated in two places would let the link and the count drift; it must be one exported function.
- Changing the graph role from `img` to `group` changes what screen readers announce and breaks the demo video selector.
- New toolbar button changes README screenshots and the demo video frames (re-take; re-record needs the user's upload).

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Branch counts depend on furthest step plus current status; the Applications list can only express current status. A furthest-step filter on Applications closes that gap, and links from the graph set it.

Evidence reviewed:

- See Analysis. No external open-source references: the change is local UI logic with existing project patterns.

Affected contracts and surfaces:

- UI: Journey card (links, role, focus), Applications page (history load, new filter), Dashboard toolbar (new filter button), shared filter storage `application-filters:<profileId>` (new `reached` key).
- URL contract of Applications: new query key `reached` (values `applied`, `screening`, `interview`, `offer`, empty for not sent).
- Pure domain: `src/server/domain/dashboard.ts` gains an exported furthest-step helper used by `summarizeDashboard` and the UI.
- No API change: `GET /api/profiles/:pid/applications/history` already exists.
- Spec `product-v1.md`, README screenshots, demo video.

Existing patterns to reuse:

- `tileQuery` and `ONE_TIME_VIEW` for the link; `ColumnDef` values filter with `order`, `optionLabel`, `emptyLabel`; `exitTip` text for link names; `Promise.allSettled` loading on the Dashboard; tests in `test/ui/DashboardPage.test.tsx`, `test/ui/ApplicationsPage.test.tsx`, `test/ui/application-view.test.ts`, `test/server/domain/dashboard*.test.ts`.

Risk and blast radius:

- Applications page now depends on the history route (decision 5). Saved filter sets gain a key; older saved sets parse unchanged. No data migration, no server behaviour change.

Sensitive data handling plan:

- Tests and media use invented companies only (mock sandbox data). No run logs or real mail.

Implementation plan:

1. Export the furthest-step helper from `dashboard.ts`; `summarizeDashboard` uses it. Unit tests.
2. Application rows carry their furthest step (`Application & { reached }`), built from applications plus history; `APPLICATION_COLUMNS` gains the filter-only `reached` column; a `branchQuery` helper beside `tileQuery`.
3. Applications page loads history, keeps rows' furthest step correct after status change, create and merge.
4. Dashboard builds the same rows; JourneyCard wraps each branch in an SVG link, graph becomes `role="group"`.
5. Spec, README screenshots, demo video selector and re-recording (per decision 8).

Validation plan:

- Unit tests for the helper and `branchQuery`; UI tests for Journey links (names, hrefs, one-time state), Applications filter and history failure; full `npm test`, `npm run typecheck`, `npm run build`; real browser check on `npm run sandbox:mock` that each branch opens a list of the same size; independent reviewer.

Artifact impact plan:

- AGENTS.md: demo video note only if the re-recording procedure changes; expected unaffected.
- Runtime project skills: `project-testing` if a new testing hazard appears (SVG links, history mocks on Applications page tests).
- Specs: `product-v1.md` Journey, Dashboard and table-view paragraphs.
- End-user/operator docs: README screenshots (applications, dashboard) and demo video.
- End-user/operator skills: none exist (AGENTS.md lists none).
- SOW lifecycle: single SOW; close with the work in one commit.

Open-source reference evidence:

- None checked; the work reuses this repository's own patterns.

Open decisions:

- None; decisions 1-8 resolved (see Implications And Decisions).

## Implications And Decisions

1. Where the set appears: **A** - Applications page with a new "Furthest step" filter; the branch opens it as a one-time view with the saved filters, status narrowed, furthest step set. (User, 2026-11-28.)
2. What is clickable: **A** - branch labels and their ribbons (one link per branch); stage bars and moved-on ribbons stay hover-only. (User, 2026-11-28.)
3. Accessibility: **A** - branch links are real links in the tab order; the graph changes from `role="img"` to `role="group"` keeping its whole-journey label; this supersedes SOW-0034 Decision 7 for branches. (User, 2026-11-28.)
4. Furthest step on Applications: **A** - filter only, no table column. (User, 2026-11-28.)
5. History failure on Applications: **A** - the applications and their history are one load; when either fails the page shows the error alert and no table, like the Dashboard (spec, SOW-0054 decision 11A). (User, 2026-11-28.)
6. Filter wording: **A** - button "Furthest step", options "Applied", "Screening", "Interview", "Offer" and "Not sent" (furthest step none: saved, or withdrawn before applying); URL key `reached` (empty value for not sent). (User, 2026-11-28.)
7. Visual cue: **A** - pointer cursor, label underlined on hover and keyboard focus, focus ring on keyboard focus, ribbon keeps its hover fade; nothing changes at rest. (User, 2026-11-28.)
8. Media: **A** - re-take `docs/images/applications.png` and `docs/images/dashboard.png`, fix the demo video selector, re-record with the same storyboard; the user uploads the new `demo.mp4` and the README attachment links are replaced. (User, 2026-11-28.)
9. Merge undercount in `furthestStep` (reviewer finding 1, pre-existing): **A** - count every history row's `from_status`, not only the first row's, so merged histories keep the furthest step; unmerged histories give the same result. (User, 2026-11-28.)
10. Offer link name (reviewer finding 2, WCAG 2.5.3): **A** - the offer branch link is named like its visible label ("1 offer", "2 offers"); its tooltip stays "N with an offer". (User, 2026-11-28.)
11. Graph read twice under `role="group"` (reviewer finding 3): **A** - stage names and counts are `aria-hidden`; the group label and branch links stay. (User, 2026-11-28.)
12. A branch or tile opened in a new tab saves its view (reviewer finding 4): **B** - tracked in SOW-0058 for tiles and branches together. (User, 2026-11-28.)

## Plan

See Implementation plan.

## Execution Log

### 2026-11-28

- SOW opened; decisions 1-4 recorded, then 5-8; gate ready; moved to current.
- Implemented: `furthestStep`, `historyByApplication`, `exitStatuses`, `STOP_STATUSES` in `src/server/domain/dashboard.ts` (`summarizeDashboard` uses them); `ApplicationRow`, `applicationRows`, the filter-only `reached` column and `branchQuery` in `src/ui/application-view.ts`; Applications loads history with the list and keeps it current after status change and merge; Dashboard builds the same rows and passes `branchLink`; JourneyCard wraps each branch in a router `Link` (SVG `<a>`), graph `role="group"`.
- Deviation inside decision 7A: Chromium paints no outline on an SVG link (seen in a real-browser screenshot), so the keyboard focus ring is a `--ring` stroke around the ribbon; checked in light and dark.
- Tests: new unit, Journey, Applications and Dashboard tests; the two history-sync tests were proven to fail with their code removed (the status-change test first passed without it, so it was rewritten around a backward move).
- Real use on `npm run sandbox:mock`: every branch of every mock profile clicked in headless Chromium; 10 of 10 opened a list of the branch's size.
- Media: `docs/images/dashboard.png` and `applications.png` re-taken (1440x900, light, en-GB); demo video re-recorded with `npm run demo:video` (89.6 s, same storyboard), frames and poster checked (invented data only).
- Spec, README, `project-testing` skill and AGENTS.md (screenshot locale) updated.
- Independent review: no count/rows mismatch found. Findings: (1) pre-existing `furthestStep` undercount after a merge, (2) offer link name "1 with an offer" does not contain the visible "1 offer" (WCAG 2.5.3), (3) graph text read twice under `role="group"`, (4) a branch opened in a new tab saves its view (as tiles already do), (5) test gaps, fixed (every branch checked against its rows; realistic merge fixture). Findings 1-4 go to the user as decisions 9-12.
- Decisions 9-12 recorded. 9A: `furthestStep` counts every row's `from_status` (test proven to fail under the old rule). 10A: offer link named "1 offer" / "2 offers". 11A: stage names and counts `aria-hidden`. 12B: SOW-0058 opened in `pending/`.
- Re-check after 9-11: full suite, typecheck, build, and the click-every-branch check on a fresh `sandbox:mock` (10 of 10). Media unaffected by 9-11 (no visual change; the demo data has no merges).
- The user posted the new video as an issue comment attachment; fetched without a login it answers 200 `video/mp4` and its SHA-256 matches `docs/video/demo.mp4`; both README attachment links (lines 7 and 12) replaced. SOW completed and moved to `done/`.

## Validation

Acceptance criteria evidence:

- Branch link opens the exact set: `test/ui/DashboardPage.test.tsx` "opens every branch on Applications with as many rows as the branch says" clicks every branch into the real Applications page and compares rows; "links each Journey branch ..." checks hrefs, the one-time state and that storage is untouched. Real browser: 10 of 10 branches on the mock profiles opened lists of the branch's size.
- Furthest step filter: `test/ui/application-view.test.ts` (rows, filter, `branchQuery`), `test/server/domain/dashboard.test.ts` (`furthestStep` including the merged history, `exitStatuses`), `test/ui/ApplicationsPage.test.tsx` "ApplicationsPage Furthest step (SOW-0057)".
- Keyboard and names: `test/ui/dashboard-cards.test.tsx` "branch links (SOW-0057)" (names, tab order, no-link case, tooltip, `aria-hidden` stage text); focus ring and hover checked in screenshots in light and dark.
- Status change and merge: the backward-move and merge tests, each proven to fail with its code removed.

Tests or equivalent validation:

- `npm test`: `Test Files  88 passed (88)`, `Tests  1533 passed (1533)`; no `act(...)` warnings.
- `npm run typecheck`: clean. `npm run build`: only the existing chunk-size warning recorded in earlier SOWs (SOW-0016, 0023, 0026, 0029, 0046).

Real-use evidence:

- `npm run sandbox:mock` with a scratch `playwright-core` under `.tmp/demo-video`: every branch of every mock profile clicked through its label, rows counted on Applications (twice: before and after decisions 9-11).
- `npm run demo:video` re-recorded (89.6 s), frames and poster viewed.

Reviewer findings:

- Independent reviewer: no count/rows mismatch. Finding 1 (merge undercount, pre-existing) fixed per decision 9A; finding 2 (offer link name) fixed per 10A; finding 3 (graph read twice) fixed per 11A; finding 4 (new-tab open saves the view, pre-existing for tiles) tracked in SOW-0058 per 12B; finding 5 (test gaps) fixed (every branch checked; realistic merge fixture and option counts).

Same-failure scan:

- `rg "role=\"img\"|getByRole\('img'"` over `src`, `test`, `scripts`: no remaining queries of the old graph role (the demo script selector was updated).
- Other readers of a single `from_status`: `rg "from_status" src` shows only `furthestStep` derives reach; the merge preselection uses `stageOf` on current statuses (`src/server/domain/stage.ts`), unaffected. One stale comment (`src/server/services/application-proposals.ts:26`, "first row's from_status") corrected.
- Other SVG links: none besides the Journey branches.

Sensitive data gate:

- Tests, screenshots and the video use invented companies and ids from the test fixtures, the mock seed and the demo data. No run logs, mail or workstation paths in durable artifacts; the AGENTS.md note names no person.

Artifact maintenance gate:

- AGENTS.md: README screenshot rule gains the `en-GB` locale (a default capture changed every date).
- Runtime project skills: `.agents/skills/project-testing/SKILL.md` gains the Applications history mock, the backward-move test rule, and SVG link testing in jsdom and Playwright.
- Specs: `.agents/sow/specs/product-v1.md` (funnel reach rule, `furthestStep` and `exitStatuses`, branch links, toolbar, Furthest step filter and Applications load).
- End-user/operator docs: README Dashboard and table paragraphs; `docs/images/dashboard.png`, `docs/images/applications.png`; `docs/video/demo.mp4`, `demo-poster.png`; both README attachment links replaced with the user's new upload (checked anonymously, hash matches).
- End-user/operator skills: none exist (AGENTS.md lists none).
- SOW lifecycle: single SOW; decision 12 tracked in `.agents/sow/pending/SOW-0058-20261128-one-time-view-in-new-tab.md`; close, move to `done/` and the work in one commit.

Specs update:

- See Artifact maintenance gate.

Project skills update:

- `project-testing`, as above. `project-local-api` and `project-agent-adapter` are unaffected: no route, guard, server or agent change.

End-user/operator docs update:

- As above.

End-user/operator skills update:

- None exist.

Lessons:

- A forward status move hides a missing history update; test furthest-step bookkeeping with a backward move.
- Chromium draws no outline on SVG links; verify focus indicators in a real browser, not only in jsdom.
- A tooltip wording used as a link name can drop the visible label (WCAG 2.5.3); name links starting with what they show.

Follow-up mapping:

- New-tab one-time views: tracked, SOW-0058.
- Pre-search for `defer|later|follow-up|future|TODO|pending` done at close: the only open item is the new-tab one-time view, tracked in SOW-0058; nothing else deferred.

## Outcome

Each Journey branch (ribbon and label) is a link, named for assistive tech and reachable by keyboard, that opens Applications as a one-time view with the saved filters, status narrowed to the branch's statuses and the new "Furthest step" filter set to the branch's stage, so the list holds exactly the applications the branch counts. Applications gained the filter-only "Furthest step" (also on the Dashboard toolbar), computed from status history by one shared rule, `furthestStep`, which now also keeps the furthest step of merged applications. Spec, README, screenshots, demo video, the testing skill and AGENTS.md are updated. 1533 tests pass, the typecheck is clean, and 10 of 10 branches matched their lists in a real browser.

## Lessons Extracted

- A forward status move hides a missing history update; furthest-step bookkeeping is tested with a backward move (recorded in `project-testing`).
- Chromium draws no outline on SVG links, and Playwright clicks a curved link's empty box centre; check SVG links in a real browser and click their text (recorded in `project-testing`).
- README screenshots must be captured with locale `en-GB` (recorded in AGENTS.md).
- A tooltip wording reused as a link name can drop the visible label (WCAG 2.5.3); link names start with what the link shows.

## Followup

- SOW-0058 (`.agents/sow/pending/SOW-0058-20261128-one-time-view-in-new-tab.md`): a tile or branch opened in a new tab saves its view.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
