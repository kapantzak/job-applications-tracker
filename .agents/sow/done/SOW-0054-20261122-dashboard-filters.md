# SOW-0054 - Dashboard filters shared with the Applications table

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered in PR #44; README video links point to the new upload.

## Requirements

### Purpose

Let users see the state (tiles, Journey, Needs attention) of a filtered subset of their applications on the Dashboard.

### User Request

"Since the dashboard shows applications, like the applications table, I want to show the same filters, so that users can visualize the state of the filtered applications. The filter selections should be persisted to localStorage."

### Assistant Understanding

Facts:

- The Dashboard summary is computed on the server from every application of the profile (`src/server/api/dashboard.ts:10`, `summarizeDashboard` in `src/server/domain/dashboard.ts:64`); the spec says the route takes no query (`.agents/sow/specs/product-v1.md:84`).
- The Applications table keeps search, filters and sort in the page URL (`src/ui/hooks/use-table-view.ts:29`); its columns are `COLUMNS` in `src/ui/pages/ApplicationsPage.tsx:36`; the toolbar is `TableToolbar` (`src/ui/components/TableView.tsx:236`).
- Filter semantics (`applyView`, local-day date ranges) live only in `src/ui/table-view.ts`.
- Status history reaches the UI only per application (`src/server/api/applications.ts:75`).
- The Dashboard tiles link to `applications?status=...` (`src/ui/pages/DashboardPage.tsx:124-180`); the application page back link restores the list query (`useListReturnHref`, `src/ui/pages/ApplicationDetailPage.tsx:26`).

Inferences:

- Shared filters (decision 4B) mean the Applications page must also read and write the stored filter set, which interacts with its URL state, the tile links and the back link.

Unknowns:

- None beyond the open decisions below.

### Acceptance Criteria

- The Dashboard shows the Applications filter bar; tiles, Journey and the quiet list reflect the filtered applications. Verified by UI tests.
- The filter set is stored per profile in `localStorage` and shared with the Applications page. Verified by UI tests.
- To review, the proposal lines, Last successful runs and Agent ignore the filters. Verified by UI tests.
- Filter semantics are identical on both pages (one `applyView`, one column set). Verified by shared code and tests.

## Analysis

Sources checked:

- `src/ui/pages/DashboardPage.tsx`, `src/ui/pages/ApplicationsPage.tsx`, `src/ui/hooks/use-table-view.ts`, `src/ui/table-view.ts`, `src/ui/components/TableView.tsx`, `src/ui/components/dashboard/AttentionCard.tsx`, `src/server/domain/dashboard.ts`, `src/server/api/dashboard.ts`, `src/server/api/applications.ts`, `.agents/sow/specs/product-v1.md`, `README.md`, `docs/images/`.

Current state:

- See Facts.

Risks:

- Persisted filters hide applications on later visits; mitigated by the always-visible toolbar badges and "Showing X of Y applications".
- Deleting a profile leaves its stored key; harmless.
- README `docs/images/dashboard.png` and the demo video show the Dashboard and must be redone; the video upload is the user's step.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The Dashboard has no filter input and its summary is computed server-side over all applications, so no subset can be shown.

Evidence reviewed:

- Files listed under Sources checked.

Affected contracts and surfaces:

- New route returning the profile's status history; Dashboard UI; Applications UI state source; tile links; spec Dashboard and Applications sections; README screenshot; demo video.

Existing patterns to reuse:

- `summarizeDashboard` (pure), `applyView`/`parseView`/`writeView`, `TableToolbar`, `NoMatches`, `theme.ts` guarded `localStorage` access.

Risk and blast radius:

- Applications page state handling changes (decision 4B); Jobs and Runs tables must keep their URL-only behaviour.

Sensitive data handling plan:

- Tests and fixtures use invented companies only; stored filters stay in the user's browser.

Implementation plan:

1. Server: `GET /api/profiles/:pid/applications/history` (registered before `/:id`) returns the profile's `HistoryRow`s in `historyForProfile` order; client `listApplicationHistory`; tests.
2. Shared view module `src/ui/application-view.ts`: `APPLICATION_COLUMNS` (moved from the Applications page), the storage key, guarded read/write of the stored query, tile link builder.
3. `use-table-view.ts`: split the URL hook into a store-agnostic core; add a stored hook for the Dashboard and an Applications hook that mirrors the URL to the store (decisions 7A, 8B, 9A); list link state carries the one-time flag so the back link keeps it.
4. Dashboard page: load applications and history, filter with the shared view, compute `summarizeDashboard` in the browser, toolbar above the tiles, tile links per decision 3A/8B, `NoMatches` when nothing matches.
5. Applications page and application page back link use the new hooks.
6. Tests, spec, README screenshot, demo video.

Validation plan:

- `npm run typecheck`, `npm test`, a manual check with `npm run sandbox:mock`, independent review.

Artifact impact plan:

- AGENTS.md: likely unaffected (no new command or workflow).
- Runtime project skills: `project-local-api` checked for the new route; update only if a new rule appears.
- Specs: `product-v1.md` Dashboard and Applications sections, new route.
- End-user/operator docs: `docs/images/dashboard.png` re-taken; demo video re-recorded (user uploads the attachment).
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW.

Open-source reference evidence:

- None checked; the work reuses local code only.

Open decisions:

- 7, 8, 9 below.

## Implications And Decisions

1. Where filtered numbers are computed: **B** (user, 2026-11-22). A new route returns the profile's status history; the Dashboard loads applications, filters them with the shared `applyView` and runs `summarizeDashboard` in the browser. The existing Dashboard route stays and still provides the To review counts.
2. What follows the filters: **A** (user). Tiles In progress, Interviews, Offers, Rejected; Journey; the quiet list in Needs attention. To review, proposal lines, Last successful runs and Agent stay unfiltered.
3. Tile links: **A** (user). The link carries the filters with status set to the tile's statuses intersected with the status filter; an empty intersection shows a plain 0 without a link (assistant's call). How this combines with decision 4B is decision 8.
4. Dashboard and Applications filters: **B** (user). One shared filter set.
5. Storage: **A** (user). Per profile, stored in the URL query format and read through `parseView`, so stale or broken values are dropped. With 4B the key names the shared set: `application-filters:<profileId>` (assistant's call, replaces the earlier `dashboard-filters:` name).
6. Controls: **A** (user). The full Applications toolbar (Search, Company, Role, Status, Applied from/to, Reset, "Showing X of Y applications"); a filter that matches nothing replaces the cards with `NoMatches`.
7. Source of truth on the Applications page: **A** (user). The URL wins and is saved: opening Applications without view parameters (sidebar) loads the stored set into the URL; opening it with parameters adopts and saves them; every change is saved; Reset clears both.
8. Tile click: **B** (user). A one-time view: Applications opens with the shared filters plus the tile's status and does not save it; the first filter change on Applications saves what is shown; the back link from an application page keeps the one-time view.
9. Sort: **A** (user). The Applications sort is stored with the shared set; the Dashboard ignores it. Jobs and Runs stay URL-only.

10. No match: **A** (user, review finding 1). Only the Journey card is replaced by `NoMatches`; Needs attention stays with its unfiltered proposal lines and an empty quiet list. Supersedes the "replaces the cards" wording of 6A.
11. Dashboard route failure: **A** (user, review finding 2). Needs attention shows "Waiting proposals could not be loaded." in place of the proposal lines and keeps the quiet list; it never says "Nothing needs you right now." while the counts are unknown.
12. Browser Back: **A** (user, review finding 4). Accepted as the meaning of 7A: going Back to an older Applications URL shows and saves that view. Recorded in the spec.
13. Demo video opening frame: **A** (user). The recording script scrolls so the opening still and the Journey scene start cleanly (no cut-off toolbar line); captions unchanged.

## Plan

See the Pre-Implementation Gate implementation plan.

## Execution Log

### 2026-11-22

- Analysis and decisions 1-6 recorded.
- Decisions 7A, 8B, 9A recorded; SOW moved to current.
- Work committed and PR #44 opened at the user's request before the video upload (the user asked for the PR, so the closing commit is separate); CI `Test (Node 22)` and `Test (Node lts/*)` passed on it.
- The user posted the new video as an attachment in an issue comment; the link answers 200 `video/mp4` without a login and its SHA-256 matches `docs/video/demo.mp4`; both README attachment links (lines 7 and 12) replaced; SOW closed.
- Decisions 10A-13A recorded and implemented: `NoMatches` replaces only the Journey card; `AttentionCard` takes nullable counts and says "Waiting proposals could not be loaded."; spec records Back/Forward saving; `scripts/demo-video/record.mjs` scrolls the Journey scene to the tiles (graph centred only when it still does not fit); video re-recorded (90.4 s).
- Implemented: `GET /api/profiles/:pid/applications/history` (`src/server/api/applications.ts`), `listApplicationHistory` (`src/ui/api/client.ts`), `src/ui/application-view.ts` (columns, key, `tileQuery`), `src/ui/view-storage.ts` (guarded storage, one-time marker), `viewQuery`/`hasView` in `src/ui/table-view.ts`, `useSharedTableView`/`useStoredTableView`/`useListReturnState` in `src/ui/hooks/use-table-view.ts`, Dashboard, Applications and application page changes; `test/ui/setup.ts` clears `localStorage` after every UI test (three existing Applications tests leaked saved filters into later ones without it).
- Real use: `npm run sandbox:mock` checked with a scripted headless Chromium (company filter changes tiles and Journey, saved under the profile key, sidebar Applications loads it, a tile opens a one-time view without saving, Reset removes the key, no console errors). `docs/images/dashboard.png` re-taken from it; demo video re-recorded with `npm run demo:video` (89.7 s).
- Independent review (fresh subagent, code only): no bugs in the URL/storage sync, the history route, or Jobs/Runs. Findings: (1) with no match, `NoMatches` hides the unfiltered proposal lines of Needs attention, a conflict between decisions 2A and 6A; (2) a failed dashboard route makes Needs attention say "Nothing needs you right now."; (3) the quiet list's ties followed the saved sort, against 9A: fixed (summary built from unsorted filtered rows, test added); (4) browser Back to an older Applications URL saves that older view, a consequence of 7A; (5) video not yet re-recorded at review time: done since. Test gaps: unknown-profile history route test added; tests for 1 and 2 follow the user's decisions.

## Validation

Acceptance criteria evidence:

- Filter bar on the Dashboard; tiles, Journey and quiet list follow it: `test/ui/DashboardPage.test.tsx` ("DashboardPage filters": toolbar position and controls, company filter changes tiles 2/1/0/1 and Journey counts, quiet list drops Globex).
- Stored per profile and shared with Applications: Dashboard "saves the filters for the profile and loads them on the next visit", "keeps filters per profile"; `test/ui/ApplicationsPage.test.tsx` "ApplicationsPage shared view" (load on empty URL, save URL view, save changes and sort, Reset, one-time view, back link).
- Unfiltered parts: To review stays 5 under filters; proposal lines stay with no match (10A); route failure message (11A); Last successful runs and Agent untouched by the code path.
- Same semantics on both pages: one `APPLICATION_COLUMNS`, one `applyView`, the same `summarizeDashboard`; history route returns the same order as the dashboard route (`test/server/api/applications.test.ts`).

Tests or equivalent validation:

- `npm run typecheck`: exit 0.
- `npm test`: `Test Files  85 passed (85)`, `Tests  1442 passed (1442)`; no stderr, warnings or act() lines in the output.
- One run during the background video recording failed `test/server/index.test.ts` ("falls back to the next port") because the recorder's server held port p+1; the file passes alone (11/11) and in the final full run.

Real-use evidence:

- `npm run sandbox:mock`, profile `frontend-platform`, scripted headless Chromium at 1440x900: tiles 4/1/1/1/6 unfiltered; company "Acme Robotics" gave 1/0/0/0/6, "Showing 1 of 9 applications", stored `company=Acme+Robotics`; sidebar Applications opened `?company=Acme+Robotics`; the In progress tile opened `?company=Acme+Robotics&status=applied&status=screening&status=interview` and the stored value stayed unchanged; Dashboard Reset removed the key; no page or console errors.
- `npm run demo:video` twice; frames checked (contact sheet and opening frame): every scene renders, the opening still starts at the tiles, only invented data.

Reviewer findings:

- Independent subagent review (code only, decisions as contract). Findings 1 (no-match hid proposal lines) and 2 (route failure said "Nothing needs you") went to the user: decisions 10A and 11A, implemented with tests. Finding 3 (quiet ties followed the saved sort) fixed: the summary uses unsorted filtered rows, test added. Finding 4 (Back saves an older view) accepted as 12A and recorded in the spec. Finding 5 (video) done. Test gaps: unknown-profile history test added; no-match and route-failure tests now assert the Needs attention lines. The tile-click test asserts only the Dashboard side; the Applications side is covered by the shared-view tests.

Same-failure scan:

- Other `localStorage` users (`src/ui/theme.ts`, `src/ui/components/UpdateBanner.tsx`) already guard with try/catch; the new `src/ui/view-storage.ts` does the same. Jobs and Runs keep `useTableView` (URL only), checked by their unchanged passing tests. `RunPage` uses only `useListReturnHref`, unchanged. `grep -rn "0.0.0.0" src bin` finds only a number-format line in `src/ui/format.ts`.

Sensitive data gate:

- Tests use invented companies (Acme, Globex, Initech, Zeta Labs) and ids; screenshots and the video show only the mock sandbox and demo data (checked frame by frame on the contact sheets); no run logs, tokens or personal data in any durable artifact. Settings → Agent and Settings → Data were not captured.

Artifact maintenance gate:

- AGENTS.md: no update; no new command, workflow or guardrail (the video re-record and upload flow is unchanged).
- Runtime project skills: `.agents/skills/project-testing/SKILL.md` records the `localStorage` reset in `test/ui/setup.ts`, seeding saved views and one-time router state. `project-local-api` unchanged: the new route is read-only under the applications router, which the skill already covers.
- Specs: `.agents/sow/specs/product-v1.md` (API list, Dashboard section, failure states, table view sharing, decisions 10A-12A).
- End-user/operator docs: `README.md` (Dashboard tour text and alt text, Dashboard reference line, table view line), `docs/images/dashboard.png`, `docs/video/demo.mp4`, `docs/video/demo-poster.png`; README attachment links replaced with the new upload (checked anonymously, identical to `docs/video/demo.mp4`).
- End-user/operator skills: none exist in this repository.
- SOW lifecycle: single SOW; `completed` and moved to `done/` in the commit that replaces the attachment links. The work itself was committed earlier because the user asked to open the PR before the upload; the PR is squash-merged, so `main` gets one commit.

Specs update:

- `.agents/sow/specs/product-v1.md` updated as above.

Project skills update:

- `.agents/skills/project-testing/SKILL.md` updated as above.

End-user/operator docs update:

- README, dashboard screenshot, demo video and both README attachment links updated.

End-user/operator skills update:

- None exist; the Project Skills Index lists no output/reference skills.

Lessons:

- jsdom keeps `localStorage` for a whole test file, so persisted UI state leaks between tests; the reset now lives in the shared setup.
- A page that stores a view must save on the user's change, not only in an effect that mirrors the URL: a Reset to an empty URL would otherwise load the old view back.
- Decisions that each sound right (2A unfiltered proposals, 6A replace the cards) can conflict in one branch; the independent review caught it.

Follow-up mapping:

- README attachment links: implemented (new upload linked).
- Leftover `application-filters:<id>` keys after a profile is deleted: rejected as harmless (a few bytes, never read for another profile); the user was told during analysis.

## Outcome

The Dashboard has the Applications filters; tiles, Journey and the quiet list follow them, the pending items do not, and the filter set is saved per profile and shared with the Applications page, with tiles opening one-time views. Delivered in PR #44 with spec, README, screenshot, video and testing skill updated.

## Lessons Extracted

See Validation → Lessons; recorded in `.agents/skills/project-testing/SKILL.md`.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
