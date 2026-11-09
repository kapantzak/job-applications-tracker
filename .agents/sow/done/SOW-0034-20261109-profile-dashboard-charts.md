# SOW-0034 - Profile dashboard with status tiles, status bar, funnel and needs-attention list

## Status

Status: completed

Sub-state: delivered, reviewed, validated.

## Requirements

### Purpose

Let the user see at a glance where a profile's job search stands, how far its applications get, and what needs action, without opening each table (GitHub issue #22).

### User Request

Issue #22 "Dashboard": "Show some graphs, or tiles, representing the state of applications." The user added: "I want to show some beautiful graphs or something that inform users regarding the current state of each profile." From five directions (status tiles, pipeline funnel, activity over time, needs-attention list, combined) the user chose the combined one, then layout E1 ("overview first") from three browser mockups, and accepted every assistant guess and every recommended option.

### Assistant Understanding

Facts:

- The Dashboard is per profile: route `/profiles/:profileSlug` renders `src/ui/pages/DashboardPage.tsx` (`src/ui/App.tsx:87`).
- Today it shows three count tiles (open applications, pending proposals, jobs), the last successful discovery and sync times, and the Agent card (`DashboardPage.tsx:144-192`). It loads them with five client calls (`DashboardPage.tsx:80-101`). It has no charts.
- Application statuses, in lifecycle order: `saved`, `applied`, `screening`, `interview`, `offer`, `rejected`, `withdrawn`, `no_response` (`src/server/domain/types.ts:4`).
- Every status change after creation writes a `status_history` row with `from_status`, `to_status`, `changed_at` and `source` (`setStatus`, `src/server/db/applications-repo.ts:178-201`). Creation writes no history row (`create`, `applications-repo.ts:92-115`), and an application can be created with any status (`src/ui/components/AddApplicationForm.tsx:23,80`; `src/server/api/applications.ts:26`). Status changes only through `setStatus`, so an application's starting status is the `from_status` of its earliest history row, or its current status when it has no history. History is exposed only per application (`src/server/api/applications.ts:75`). (Corrected after the builder check; the first draft wrongly said creation writes a row.)
- `applied_at` can be backdated at creation (`AddApplicationForm.tsx:41`) and edited later; editing it does not touch `status_changed_at`, which creation sets to the creation time (`applications-repo.ts:109`). Mail sync already treats `applied_at ?? created_at` as the application's start (`src/server/services/mail-sync.ts:40-41`).
- The existing "open application" rule is `applied`, `screening`, `interview`, `no_response`, plus offers changed in the last 30 days (`applications-repo.ts:38-39,124-143`). Mail sync uses it to pick what to check.
- The Applications table reads filters from the URL; the status filter is `?status=<value>` repeated (`src/ui/pages/ApplicationsPage.tsx:50-58`, `src/ui/table-view.ts:86-103`, SOW-0029).
- No chart library is installed. shadcn `tooltip.tsx`, `card.tsx` and `empty.tsx` exist in `src/ui/components/ui/`. `src/ui/styles.css` defines no chart color tokens.
- The mock sandbox seeds applications with status steps through `applicationsRepo.setStatus`, so it has history for the funnel (`scripts/sandbox-mock/seed.ts:404-428`).

Inferences:

- A profile holds tens of applications, rarely hundreds. Percentages on small counts mislead, so counts lead and percentages are secondary.
- Computing the summary in one SQL read per request is cheap at this scale.

Unknowns:

- None blocking.

### Acceptance Criteria

- `GET /api/profiles/:pid/dashboard` returns the summary defined in "Design" for that profile only; an unknown profile is 404; another profile's data never appears. Verified by API tests through the harness with two profiles.
- The summary rules (status counts, funnel reach, quiet applications) match "Design" on invented histories, including skipped steps, direct-to-closed creation, saved-then-withdrawn, and the 14-day boundary. Verified by unit tests of the pure function.
- The Dashboard shows, top to bottom: header actions (unchanged), four tiles, the status bar with its legend, the funnel and needs-attention cards side by side (stacked on narrow screens), the last-runs card with the jobs count, and the Agent card (unchanged). Verified by page tests and a manual check in `npm run sandbox:mock` at desktop and narrow width, in light and dark theme.
- Every number that links opens a list whose rows match the number: tiles and legend entries link to Applications with `?status=` filters; To review links to Review; each quiet application links to its detail page. Verified by page tests asserting `href`s and a manual click-through in the sandbox.
- A profile with no applications shows the tiles at 0 and an empty-state card instead of the bar, funnel and attention cards. Page test.
- A failed dashboard fetch shows an error alert while the runs, jobs and agent parts still render (same pattern as today). Page test.
- Chart colors pass the dataviz validator checks for both themes (recorded output), and identity is never color-only (legend with counts, visible funnel numbers). Validator output in Validation.
- `npm run typecheck` and `npm test` pass; CI green on the PR.

## Design

This section is the design document for the feature. A builder must be able to plan from it without asking the user.

### Intent

Answer three questions on one screen, in this order: where do my applications stand right now; how far do they get; what needs me today. Make it look polished and calm, not alarming: a rejection is a normal outcome, not an error.

### Goals

- Four headline tiles, a status bar, a funnel and a needs-attention list, per profile.
- Every number is honest and checkable: clicking it shows the rows behind it.
- Works with zero, a few, and a few hundred applications.

### Non-goals

- Activity over time (weekly applications and replies). Left out by the user's choice of E1; add later with its own SOW if wanted.
- Comparing profiles on the Profiles screen.
- Changing the "open application" rule that mail sync uses.
- Any new setting (the 14-day quiet threshold is a constant).

### Anti-goals

- Eight competing hues or alarm red for rejections.
- Percentages without the counts behind them.
- A dashboard number that disagrees with the list its link opens.
- Charts that look broken or empty for a new profile.

### Layout (E1, top to bottom)

1. **Header**: unchanged (`PageHeader` with Find jobs, Sync from Gmail, `SyncScopeNote`).
2. **Tiles row**: four cards, `grid-cols-2` on narrow screens and `sm:grid-cols-4`. Same `StatCard` look as today (label, icon, large tabular number that is a link).
   - **In progress**: count of `applied` + `screening` + `interview`. Links to `applications?status=applied&status=screening&status=interview`. (Decision 1: plain statuses; deliberately not the sync "open" rule and not named "Open".)
   - **Interviews**: count of `interview`. Links to `applications?status=interview`.
   - **Offers**: count of `offer`. Links to `applications?status=offer`.
   - **To review**: pending proposals. Links to `review`.
3. **Status bar card**: title "Where your N applications stand" (N = all applications of the profile, singular "application" when N is 1). One horizontal bar split into one segment per non-zero status, in lifecycle order (`APPLICATION_STATUSES`), widths proportional to counts, 2px gaps between segments, 4px rounded outer ends. Each segment has a hover/focus tooltip "Applied: 12 (35%)". Under the bar a legend of all eight statuses in the same order, each with swatch, label (`STATUS_LABELS`) and count, including zeros so the legend never shifts. Each legend entry with a non-zero count links to `applications?status=<value>`.
4. **Bottom row**: two cards, `sm:grid-cols-5` with the funnel spanning 3 and attention spanning 2; stacked on narrow screens.
   - **Funnel card** "How far applications get": four rows, Applied, Screening, Interview, Offer. Each row: label, a track with a filled bar whose width is the step count divided by the Applied count, and the count. Rows after Applied also show the percentage of the step above, rounded to a whole number, in muted text; the percentage is hidden when the step above is 0. Each row has a tooltip "6 of 14 that reached screening". A muted footnote: "% = share of the step above".
   - **Needs attention card**: first item "N status proposals waiting" with a link to Review, shown only when N > 0. Then quiet applications, oldest first: "Company · Role", with a muted line "Applied D days ago, no reply" or "<status label>, no change in D days"; each links to the application's detail page. Show at most 5; when there are more, a link-styled shadcn `Button` "Show M more" expands the list in place (no navigation, so no number points at a list that disagrees with it). When there is nothing, the card says "Nothing needs you right now."
5. **Last successful runs card**: as today, with the jobs count appended to the discovery line: "Last discovery: <time> · <n> jobs" (Decision 3). The count uses the same `listJobs(profileId)` length the current Jobs tile uses.
6. **Agent card**: unchanged.

**Empty state**: when the profile has no applications, the tiles show 0, and the status bar, funnel and attention cards are replaced by one card using `src/ui/components/ui/empty.tsx`: "No applications yet", with a short line pointing to Jobs (link) to save or mark jobs as applied. Pending proposals cannot exist without applications, so nothing is lost.

### Color

- Active stages use one blue ramp, light to dark as an application moves forward: `saved` lightest, then `applied`, `screening`, `interview`, `offer` darkest (sequential encoding of an ordered stage).
- Closed outcomes use three neutral grays: `rejected` darkest gray, `withdrawn` and `no_response` lighter.
- The funnel fills use the `interview`-step blue on a muted track.
- Colors are CSS custom properties added to `src/ui/styles.css` under `:root` and `.dark` (the app's existing theme mechanism), for example `--status-saved` ... `--status-no-response`, and exposed to Tailwind through the existing `@theme inline` block. Dark values are their own steps chosen for the dark card surface, not an automatic flip. In both themes emphasis grows with progress (Decision 8): on the light card the ramp goes light to dark; on the dark card it goes faint to strong, so `saved` sits closest to the card colour and `offer` contrasts most, and `rejected` is the most visible gray.
- Validate light and dark steps with the dataviz skill's validator (contrast and lightness ordering) and record the output. Light steps below 3:1 against the card are acceptable only because the legend shows every count as text (relief rule).

### Data: `GET /api/profiles/:pid/dashboard` (Decision 2)

Profile-scoped, read-only, mounted from `src/server/api/profiles.ts` like the other scoped routers. No query parameters. Response:

```ts
interface DashboardSummary {
  total: number;                                       // all applications of the profile
  status_counts: Record<ApplicationStatus, number>;    // all eight keys, zero-filled
  funnel: { applied: number; screening: number; interview: number; offer: number };
  pending_proposals: number;
  quiet: Array<{
    id: string; company: string; role: string;
    status: 'applied' | 'screening' | 'interview';
    since: string;                                     // ISO start of the quiet clock (see Quiet rule)
    days: number;                                      // whole days since `since`
  }>;                                                  // all quiet applications, oldest first
  quiet_days: number;                                  // the threshold used, 14
}
```

Rules:

- **Funnel reach.** Stage rank: `applied` 1, `screening` 2, `interview` 3, `offer` 4. The statuses an application has held are its starting status (the `from_status` of its earliest history row, or its current status when it has no history), every `to_status` in its history, and its current status. Its reach is the highest rank among them. Example: created as `interview`, later `rejected` (one row interview → rejected) reaches Interview. `rejected` and `no_response` imply at least rank 1 (you cannot be rejected or ignored without applying). `saved` and `withdrawn` imply nothing, so a saved job that was withdrawn is not counted as applied. `funnel.X` is the number of applications whose reach is at least X's rank. Skipped steps count as passed (applied straight to interview counts for screening).
- **Quiet** (Decision 5). Status is `applied`, `screening` or `interview`, and the quiet clock started at least 14 whole days before now. The clock starts at `applied_at` (falling back to `status_changed_at` when null) for an application with no history rows whose status is `applied`, so backdated entries count from the date the user sent them; otherwise it starts at `status_changed_at`, so any real status change resets it. `days = floor((now - since) / 86_400_000)`, computed on UTC instants so the result does not depend on the time zone. The response carries `since` (the clock start, ISO) instead of `status_changed_at`. UI wording: "Applied D days ago, no reply" for `applied`, "<status label>, no change in D days" otherwise.
- **Pending proposals**: proposals in state `pending` whose application belongs to the profile (same query the Review list uses).
- Computation is a pure function `summarizeDashboard(applications, history, pendingCount, now)` in `src/server/domain/dashboard.ts`, fed by one new repository read of the profile's history rows (joined on `applications.profile_id`). `now` is injected for tests.

The UI client gains `getDashboard(profileId)`. The Dashboard page then calls `getDashboard`, `listJobs`, `listRuns` and `getSettings` with `Promise.allSettled`, replacing the `listApplications` and `listProposals` calls it no longer needs.

### Drawing (Decision 4)

Plain HTML and Tailwind (flex segments and widths), the existing shadcn `Tooltip` for hover and keyboard focus, and the existing `Card` and `Empty` components. No chart library. Raw `button`/`table` elements stay out of the page per AGENTS.md; links use `react-router` `Link`.

Accessibility (Decision 7): the bar has `role="img"` with an `aria-label` that lists every non-zero status and count; the legend carries the same data as visible text and its entries are the keyboard path. Bar segments and funnel tracks are not focusable; their tooltips show on pointer hover only. Funnel rows are a list with visible numbers.

### Assistant calls (not user decisions; the user may override)

- Legend shows all eight statuses including zeros; zero entries are not links.
- Quiet list capped at 5 visible rows with a "Show M more" in-place toggle (builder check found a link would contradict the "numbers match their list" rule).
- Funnel reads the starting status from the earliest history row's `from_status` instead of changing `create()` to write a history row (builder check; keeps the change read-only and works for existing data).
- Quiet excludes `offer` and `no_response`.
- Funnel percentages rounded to whole numbers; hidden when the step above is 0.
- New test ids: `count-in-progress`, `count-interviews`, `count-offers`, `count-proposals` (kept); `count-applications` and `count-jobs` are removed with the old tiles.

### Left to the builder

- Exact Tailwind classes, icon choice per tile (lucide), and spacing, within the existing card style.
- Exact color steps, as long as they pass the validator as described.
- Internal naming of the repository read and component split (for example `StatusBar`, `FunnelCard`, `AttentionCard` under `src/ui/components/dashboard/`).

## Analysis

Sources checked:

- Issue #22 (`gh issue view 22`): title "Dashboard", one-line body, no comments.
- `src/ui/pages/DashboardPage.tsx`, `src/ui/App.tsx`, `src/ui/pages/ApplicationsPage.tsx`, `src/ui/table-view.ts`, `src/ui/api/client.ts`.
- `src/server/db/migrations.ts`, `src/server/db/applications-repo.ts`, `src/server/db/proposals-repo.ts`, `src/server/api/applications.ts`, `src/server/api/profiles.ts`, `src/server/domain/types.ts`.
- `src/ui/styles.css`, `src/ui/components/ui/` listing, `package.json`.
- `scripts/sandbox-mock/seed.ts`, `test/ui/DashboardPage.test.tsx`.
- `.agents/sow/specs/product-v1.md`, `README.md`, `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` (no dashboard overlap), `.agents/skills/project-local-api/SKILL.md`, `.agents/skills/project-testing/SKILL.md`.

Current state:

- See Facts above.

Risks:

- Two meanings of "active/open": the tile says "In progress" (plain statuses) while sync keeps its own "open" rule. Mitigated by the different name and by links that show exactly the counted rows.
- Funnel accuracy depends on recovering the starting status, because creation writes no history row. The rule reads the earliest row's `from_status`, which is exact because status changes only through `setStatus`. A future code path that changes `status` without `setStatus` would break this; the unit tests pin the rule, and the change to creation itself (writing a history row) is out of scope.
- Tooltip content is the only place exact segment percentages appear; the legend counts keep the data available without hover.

## Pre-Implementation Gate

Status: ready (approved by the user on 2026-11-09)

Problem / root-cause model:

- The dashboard shows only counts and gives no picture of progress or outcomes, because no view aggregates statuses and history across a profile's applications. Evidence: `DashboardPage.tsx:144-192`; history is per application only (`applications.ts:75`).

Evidence reviewed:

- Code, specs, README, tests and SOWs listed under Analysis. No external open-source repositories were checked: the feature uses only local code and installed components.

Affected contracts and surfaces:

- New API route `GET /api/profiles/:pid/dashboard` and its response type.
- New repository read (profile history), new pure module `src/server/domain/dashboard.ts`.
- UI client `getDashboard`; `DashboardPage.tsx`; new dashboard components; color tokens in `src/ui/styles.css`.
- Tests: `test/server/api/` (new dashboard test), `test/server/domain/` or `test/server/db/` (summary rules), `test/ui/DashboardPage.test.tsx` (rewritten tile tests, new chart tests), client test if one covers routes.
- Spec `.agents/sow/specs/product-v1.md` dashboard lines; `README.md` dashboard description.

Existing patterns to reuse:

- Scoped router mount and profile middleware in `src/server/api/profiles.ts`; route tests via `test/server/api/harness.ts` with a second profile for the 404/isolation case.
- `Promise.allSettled` loading and `ErrorAlert` per failed call in `DashboardPage.tsx`.
- `StatCard`, `Card`, `Empty`, `Tooltip`; `STATUS_LABELS` from `src/ui/labels.ts`; `useProfileHref` for links.
- URL filter format from SOW-0029 (`?status=` repeated).

Risk and blast radius:

- UI: the Dashboard page only. Sidebar Review count, Applications, Review and sync are untouched.
- API: one new read-only GET under the existing guard; no state change, no migration, no schema change.
- Performance: one history read per dashboard load; at most a few thousand rows.
- Security: read-only, profile-scoped with the same middleware; returns only data the Applications list already exposes.

Sensitive data handling plan:

- The feature displays the user's own application data locally; nothing new leaves the machine. Tests, the SOW and docs use invented companies (`Acme`, `Globex`) and invented ids only. No run logs are copied.

Implementation plan:

1. Server summary: pure `summarizeDashboard` in `src/server/domain/dashboard.ts` plus the `DashboardSummary` type; repository read of the profile's history; unit tests of every rule (test first).
2. Route: `src/server/api/dashboard.ts` mounted in `profiles.ts`; API tests (shape, two-profile isolation, unknown profile 404).
3. Client: `getDashboard` in `src/ui/api/client.ts`.
4. Colors: tokens in `src/ui/styles.css` (light and dark) and Tailwind exposure; run the validator and record the output.
5. UI: components for tiles, status bar, funnel, attention, empty state; rewrite `DashboardPage.tsx` to the E1 layout; page tests.
6. Docs and spec: README dashboard line, `product-v1.md` dashboard contract.
7. Validation: typecheck, full test suite, `npm run sandbox:mock` manual check (desktop and narrow, light and dark, links), independent review.

Validation plan:

- Unit tests for summary rules (skipped steps, direct-to-rejected, saved-then-withdrawn, interview-then-rejected, created-as-interview-then-rejected with no creation row, 13 vs 14 days, backdated `applied_at` with no history, a later status change resetting the clock, null `applied_at` fallback, zero applications).
- API tests through the harness, including another profile's data not leaking.
- UI tests with the mocked client: tiles and hrefs, legend counts and hrefs, funnel numbers and percentage hiding, attention cap and "and M more", empty state, error alert with other parts still rendered.
- Manual check in `npm run sandbox:mock` with screenshots described in Validation (no real data).
- Independent reviewer per the project's review practice; same-failure search for leftover `count-applications`/`count-jobs` references.

Artifact impact plan:

- AGENTS.md: likely unaffected (no new command or guardrail); confirm at close.
- Runtime project skills: `project-local-api` lists global routes only, and this route is profile-scoped, so likely unaffected; `project-testing` may gain a note if dashboard tests introduce a new pattern (time injection).
- Specs: update `.agents/sow/specs/product-v1.md` with the dashboard contract and API route.
- End-user/operator docs: update `README.md` dashboard description.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: single SOW; move to `current/` at start, to `done/` with the work in one commit.

Open-source reference evidence:

- None checked; the feature relies only on local code and already-installed components.

Open decisions:

- None. Decisions 1-6 resolved below.

## Implications And Decisions

Recorded 2026-11-09. The user answered "All recommended".

1. **What "Active" counts.** A: reuse the sync "open" rule; B: plain `applied` + `screening` + `interview`. **Selected B**, with the tile named "In progress", so every tile equals the list its link opens and the sync rule stays untouched.
2. **Data source.** A: one computed `GET /api/profiles/:pid/dashboard`; B: raw history route with UI math; C: per-application fetches. **Selected A**: one request, server-tested logic, small payload.
3. **Jobs count tile.** A: drop; B: fifth tile; C: move into the last-discovery line. **Selected C**.
4. **Drawing.** A: plain HTML/CSS with the existing Tooltip; B: shadcn chart (Recharts). **Selected A**; a library waits for a time-series chart.
5. **Quiet clock** (raised by the builder check). A: `status_changed_at` only; B: `applied_at` for applications still at their starting `applied` status, `status_changed_at` otherwise. **Selected B**, so applications entered with a backdated Applied date show as quiet from day one and the day count matches the Applications table.
6. **Two meanings of application state** (raised by the user after plan review). "Open" is the sync rule: applications mail sync still checks for replies (`applications-repo.ts:38-39`, `mail-sync.ts:25`, scheduler `applications-repo.ts:145-158`, `prompts/sync_mail.md:12`, README lines 35 and 104), first defined in the v1 design (design doc line 181). "In progress" is the dashboard's stage grouping (Decision 1). Options: A sync uses In progress (would miss late replies and offer follow-ups); B dashboard uses open (Decision 1 option A, rejected); C rename "open" everywhere (prompt version bump, log parser, mock agent, README churn); D keep both, define each once. **Selected D**: after this SOW no dashboard number or label shows "open" (the sync run log line "No open applications to check", `mail-sync.ts:27`, keeps the sync meaning the README now defines); README and spec define "open" as "the applications sync still checks for replies (applied, screening, interview, no response, and offers from the last 30 days)" next to "In progress"; the UI client's now-unused `open` argument of `listApplications` (`src/ui/api/client.ts:176-177`) is removed. The server's `?open=1` query stays (API contract, covered by tests). No behavior change.
7. **Bar accessibility** (raised by the Task 3 review; the first Design text required both `role="img"` and focusable segment triggers, which conflict because `img` children are presentational). A: keep the labelled image, segments and funnel tracks not focusable, hover-only tooltips; B: a labelled group of named focusable segments and named funnel tracks. **Selected A** (user, "go with recommended"): correct accessibility tree without redundant tab stops; the legend links are the keyboard path to every count.
8. **Dark-mode ramp direction** (raised by the Task 3 review). A: same lightness order in both themes (saved brightest on the dark card); B: faint to strong on the dark card so later stages stand out most. **Selected B** (user, "go with recommended").

Layout: E1 (overview first), chosen in the browser mockup. Assistant guesses accepted by the user ("looks right, go with your guesses"): "In progress" excludes `saved`; tiles link to filtered lists; skipped steps count as passed; quiet = 14 days in applied/screening/interview; empty state replaces the charts.

## Plan

See Implementation plan in the gate.

## Execution Log

### 2026-11-09

- Design agreed in conversation; SOW written in `pending/`.
- Builder check by an independent reviewer: found that creation writes no history row (Facts and funnel rule corrected), that the quiet clock ignored backdated Applied dates (Decision 5, user chose B), and that an "and M more" link would contradict the numbers-match rule (replaced by an in-place toggle).
- Plan `docs/superpowers/plans/2026-11-09-profile-dashboard-charts.md` written; user raised the open/in-progress vocabulary (Decision 6, D). SOW moved to `current/`.
- Executed task by task, each with a fresh implementer and an independent task reviewer:
  - Task 1 `2348100`: summary rules.
  - Task 2 `50daee7`: history read, route, client call.
  - Task 3 `c568dce` + `aead8a4`: tokens and cards. The review found focusable segments inside `role="img"` and a dark ramp that inverted emphasis; the user decided 7A and 8B; one fix round.
  - Task 4 `0f972e0`: page, `listApplications` cleanup.
  - Final whole-branch review: "with fixes". Fix wave `4458e03`: long-name wrapping, "1 job", equal card heights, stronger isolation test; docs moved to proper sections; `project-local-api` skill updated. Scoped re-review clean.

## Validation

Acceptance criteria evidence:

- Route summarizes only its profile; unknown profile 404: `test/server/api/dashboard.test.ts` (the other profile has history, an offer and a pending proposal; this profile's response shows `funnel.offer` 0 and `pending_proposals` 1).
- Summary rules on invented histories: `test/server/domain/dashboard.test.ts` (15 cases: skipped steps, creation status from the first row, direct rejected/no_response, saved→withdrawn, 14 days vs 13.99, backdated `applied_at`, real change resets the clock, null fallback, future date, oldest first).
- Layout, links, empty state, error state: `test/ui/DashboardPage.test.tsx` and `test/ui/dashboard-cards.test.tsx` (tile and legend hrefs, singular forms, five-item cap with "Show M more", no `NaN`/`%` on an all-zero funnel, one-segment bar with both rounded ends, proportional widths, no tab stops on segments).
- Colours (light card `#ffffff`, dark card `#18181b`), dataviz palette validator `--ordinal` runs: all PASS for the light blue ramp `#86b6ef,#5598e7,#2a78d6,#1c5cab,#104281` (light end 2.11:1), the dark blue ramp `#184f95,#256abf,#3987e5,#6da7ec,#9ec5f4` (faint to strong, Decision 8; light end 2.19:1) and the dark grays `#52525b,#71717a,#a1a1aa` (light end 2.29:1). Contrast ≥ 3:1 for `interview`, `offer` and `rejected` in both themes (dark: 7.08, 9.91 and 6.91). The steps below 3:1 rely on the relief rule: the legend prints every count. The categorical-mode FAILs (lightness band, chroma floor, normal-vision floor between adjacent steps) do not apply to one ordered ramp (controller ruling, recorded in the SDD ledger).
- `npm run typecheck` exit 0; `npm test`: `Test Files 73 passed (73)`, `Tests 1026 passed (1026)`; no warnings or act() noise.

Tests or equivalent validation:

- See above. TDD evidence (RED then GREEN) is recorded per task in the execution reports.

Real-use evidence:

- `npm run sandbox:mock` data (invented), served with `node bin/jobtrack.js --data-dir .tmp/sandbox-mock --no-open --port 0`, viewed in Chrome:
  - Rich profile: tiles 4/1/1/3; bar with 8 segments; tooltip "Applied: 2 (22%)"; funnel 8/3 38%/2 67%/1 50%; one quiet application "Screening, no change in 24 days".
  - Clicking In progress opened Applications with "Showing 4 of 9".
  - Dark theme checked.
  - Sparse profile: one-segment bar, Interview percentage hidden.
  - Empty profile: empty state and "Last discovery: never · 0 jobs".
  - API JSON matches the seed (funnel Applied 8 includes the applied→withdrawn application).
- Found in the real-use check and fixed: an unbroken long name overflowed the attention card and the page (scrollWidth 1512→1611). After the fix: 1512→1512, and both bottom cards are the same height.
- At 375 px the app overflows sideways on every profile page (Runs 548, Profile 500, Dashboard 475 in a 375 px frame). This predates this SOW: the fixed sidebar and "desktop browsers only" in the README and spec.

Reviewer findings:

- Builder check (design): 3 findings, all resolved before implementation (see Execution Log).
- Task reviews: Tasks 1, 2 and 4 approved with minors. Task 3 had one Important finding, mandated by the plan, plus a dark-ramp question; the user decided 7A and 8B; fixed and re-reviewed clean.
- Final whole-branch review: "with fixes". One Important finding (long-name overflow), the SOW close items, and 7 minors. All addressed in `4458e03` plus the docs, except those the reviewer triaged as "leave", each with a reason: test-only redundancies, the `QuietStatus` type duplicated as a list, cosmetic ordering.

Same-failure scan:

- `grep -rn "count-applications\|count-jobs" src test`: no hits.
- `grep -rn "listApplications(" src test`: only `ApplicationsPage.tsx`, without `open`.
- `listProposals(profileId)` remains only in `ReviewPage.tsx`, as expected.
- No other new component renders user-supplied text in a grid cell; the legend, funnel and titles use fixed labels.

Sensitive data gate:

- Tests, SOW, spec, README and skill use invented companies (Acme, Globex, Initech, Acme Robotics), `example.com` and generated ids only. No run logs, credentials or real mail content. The workstation path of the validator is not recorded.

Artifact maintenance gate:

- AGENTS.md: no update needed. No new command, guardrail or workflow; `npm run sandbox:mock` already covers the real-use path.
- Runtime project skills: `.agents/skills/project-local-api/SKILL.md` now lists the read-only dashboard router among the profile-scoped routers. `project-testing` and `project-agent-adapter` are unaffected: no new test pattern, and no agent or prompt change.
- Specs: `.agents/sow/specs/product-v1.md` has a new "Dashboard (SOW-0034)" section (tiles, bar, funnel, quiet rule, response shape, empty and error states, "1 job") and the "open" vs "In progress" vocabulary.
- End-user/operator docs: `README.md` has a Dashboard bullet under Interface, and the vocabulary sentence next to both sync lines.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: `Status: completed`; moved to `done/`; committed together with the docs, spec, skill and plan in one commit.

Specs update:

- `.agents/sow/specs/product-v1.md`, as above.

Project skills update:

- `.agents/skills/project-local-api/SKILL.md`, as above.

End-user/operator docs update:

- `README.md`, as above.

End-user/operator skills update:

- None exist, so none were affected.

Lessons:

- Design docs must be checked against the code before they go to the user. The first draft stated as fact that creating an application writes a history row; the builder check caught it.
- Accessibility rules in a design need a consistency check: `role="img"` and focusable children conflict.
- "Light to dark" is not theme-neutral: on a dark surface, emphasis comes from contrast, not lightness.
- Unbroken user text in a grid cell needs `wrap-anywhere` and `min-w-0`. jsdom cannot catch this, so the real-browser check earned its place.

Follow-up mapping:

- Activity-over-time chart and cross-profile comparison: non-goals by the user's choice of E1, not deferred work; they need a new user request.
- Creating an application still writes no history row: out of scope (Design risk note); the funnel recovers the starting status exactly. Not tracked as work; a future change to `create()` must keep the summary tests green.
- Mobile layout below 768 px: pre-existing, app-wide, and documented as desktop-only. Not introduced here.
- Final review minors triaged "leave" are rejected with reasons in the reviewer findings above.

## Outcome

Delivered. Each profile's Dashboard shows:

- In progress, Interviews, Offers and To review tiles, each linking to a matching list;
- a status bar with a counted legend;
- a funnel (Applied → Screening → Interview → Offer) with counts and step shares;
- a needs-attention list (pending proposals and applications quiet for 14+ days);
- an empty state;
- the jobs count in the discovery line.

`GET /api/profiles/:pid/dashboard` serves the summary. GitHub issue #22.

## Lessons Extracted

- See Validation → Lessons. The overflow lesson is a UI pattern, and the repo has no UI-layout skill yet. It is recorded here instead of creating a generic project skill only for one rule.

## Followup

None. Every item is mapped in Validation → Follow-up mapping.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
