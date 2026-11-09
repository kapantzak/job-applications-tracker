# SOW-0037 - Dashboard Journey view: a main flow graph with a view switch

## Status

Status: completed

Sub-state: delivered, reviewed, validated.

## Requirements

### Purpose

Give the Dashboard one striking main graph that shows the share of applications at each stage, with the applications that stopped at a stage branching off. Keep today's cards as a second view.

### User Request

"I want to show a main graph under the tiles (possibly replacing the 'Where your 9 applications stand' section). It should depict in a nice way the portion of applications at each stage. Branch off not-responsed applications. Make it beautiful." Then: "Can we offer two flavours of layout? Show the graph by default when the number of applications is big. Show a button or toggle that let users change views."

The user picked from browser mockups and options:

- 1.A: the journey with exits.
- 2.A: all four exits branch off.
- 3.A: in the Journey view the graph replaces both cards.
- 4.A: Journey is the default from 10 sent applications.
- 5.A: the choice is remembered in the browser for all profiles.
- 6.A: below 768 px always Breakdown, with no switch.

### Assistant Understanding

Facts:

- Below the tiles, the Dashboard renders `StatusBarCard`, then a row with `FunnelCard` (3/5) and `AttentionCard` (2/5) (`src/ui/pages/DashboardPage.tsx:187-210`). With no applications, an empty-state card replaces them.
- `summarizeDashboard` (`src/server/domain/dashboard.ts`) already computes each application's reach and `rejected_at` (SOW-0036). `funnel[X]` counts reach ≥ X.
- The theme preference is stored in `localStorage` with try/catch guards (`src/ui/theme.ts:13,22`, key `theme`). `useIsMobile` (`src/ui/hooks/use-mobile.ts`) reports `window.innerWidth < 768` and treats jsdom without `matchMedia` as desktop. `ButtonGroup` exists in `src/ui/components/ui/button-group.tsx`.
- Status colours are the `--status-*` tokens in `src/ui/styles.css`: a blue ramp for saved through offer (faint to strong in dark), Rejected = `--destructive`, Withdrawn and No response gray. The Tailwind classes are `bg-status-*`.

Inferences:

- An application can stop at a stage in one of four ways: still active, rejected, no response, or withdrawn. For each stage, the four counts add up to `funnel[X] − funnel[next]`.

Unknowns:

- None.

### Acceptance Criteria

1. The summary gains `stopped_at`. A unit test checks the invariant sum and the case rules.
2. The Journey view draws the graph exactly as in "Design → Journey graph". Component tests check:
   - labels, counts, shares;
   - which exits are omitted;
   - the offer label;
   - the caption;
   - the `aria-label`;
   - no `NaN` with only Applied.
3. The view switch:
   - the default rule (stored choice, otherwise Journey from 10 sent);
   - persistence;
   - narrow and empty states.

   Unit tests cover the pure rule; page tests cover the rendered behavior.
4. Breakdown is today's layout, unchanged. The existing page and card tests still pass.
5. Checked in the browser: both views, both themes, the switch and persistence, desktop width.
6. Spec and README updated. `npm run typecheck` and `npm test` pass.

## Design

### Data: `stopped_at` (server)

- `DashboardSummary.stopped_at: Record<FunnelStage, { waiting: number; rejected: number; no_response: number; withdrawn: number }>`.
- For each application with reach ≥ 1 (sent), at the stage equal to its reach:
  - `rejected`, `no_response` or `withdrawn` when the current status is that status;
  - otherwise `waiting`. This covers every active or other status; at the Offer stage, `waiting` means "has the offer".
- Invariants:
  - `Σ stopped_at[X] = funnel[X] − funnel[next(X)]` (`funnel[next(Offer)]` = 0);
  - `stopped_at[X].rejected = rejected_at[X]`.
- `rejected_at` stays (the Breakdown funnel uses it).
- Computed in `summarizeDashboard`, next to `rejected_at`, from the reach it already computes.

### Journey graph (`src/ui/components/dashboard/JourneyCard.tsx`)

Approved mockup: `.tmp/.superpowers/brainstorm/63322-1794236934/content/main-graph.html`, option A. Match its look; the code there is a throwaway. Hand-drawn SVG, no new dependency.

- **Card.** Title "Your applications' journey". Caption "N sent" plus " · M saved, not applied yet" when M > 0 (singular "1 saved").
- **Size.** The SVG fills the card width (`width="100%"`, a fixed `viewBox` width around 940). Its height fits the content, with no large empty band.
- **Trunk.** One node per stage (Applied, Screening, Interview, Offer):
  - nodes are rounded vertical bars, top-aligned, evenly spaced;
  - height is proportional to `funnel[X]`, with the tallest about 200 viewBox units and a minimum of 3 units for any non-zero value;
  - a node with count 0 is still drawn as a header but has no bar.
  - Above each node: the stage name (bold), then the count, plus "· P%" (share of the stage before, rounded; hidden when the stage before is 0), in muted text.
- **Moving on.** A ribbon from the top of node X to the next node, thickness `funnel[next]`, filled with a horizontal gradient from X's colour to the next stage's colour at about 45% opacity.
- **Exits.** Below the moving-on part, each non-zero exit of `stopped_at[X]` leaves the node in the order waiting, rejected, no response, withdrawn:
  - as a ribbon curving down and right to an end cap, a short rounded bar about 150 units right of the node;
  - each successive exit drops further, so they fan out and labels never overlap;
  - the gradient runs from the stage colour to the exit colour, faint to strong.
  - Exit colours: waiting = the stage's own colour at reduced strength; rejected `--status-rejected`; no response `--status-no-response`; withdrawn `--status-withdrawn`.
  - Next to each cap, a label in normal text colour: "12 waiting", "3 rejected", "4 no response", "1 withdrawn".
  - At the Offer stage, the waiting exit is labelled "1 offer" / "N offers", in bold, in the offer colour's text-safe equivalent or the foreground colour.
- **Colours.** Stage colours are `--status-applied`, `--status-screening`, `--status-interview`, `--status-offer`, referenced as CSS variables in SVG (`fill`/`stop-color` through `style`), so both themes work without new tokens.
- **Hover.** Hovering a ribbon or node shows the app's Tooltip (as in the other cards, with its own `TooltipProvider`). Examples: "11 moved on to screening", "3 rejected after applying" (same step phrases as `FunnelCard`: applying, screening, the interview, the offer), "30 reached applied". Not focusable (SOW-0034 Decision 7). Every number is also a visible label.
- **Accessibility.** The `<svg>` has `role="img"` and an `aria-label` that lists, per stage with a non-zero count, the stage, its count and its non-zero exits. For example: "30 sent. Applied 30: 12 waiting, 3 rejected, 4 no response. Screening 11: …". The SVG text is presentational.
- **Dark mode.** Text uses `currentColor` / foreground and muted tokens, never series colours (except the offer emphasis noted above, which must stay readable).

### View switch and layout

- **Two views:**
  - **Journey:** `JourneyCard` full width, then `AttentionCard` full width below.
  - **Breakdown:** today's `StatusBarCard`, then `FunnelCard` + `AttentionCard`. Unchanged.
- **Switch:**
  - a `ButtonGroup` with two `Button`s, "Journey" and "Breakdown";
  - `aria-pressed` on each; the active one uses the default variant, the other outline;
  - size small;
  - right-aligned in a row directly above the view, under the tiles;
  - an accessible group name such as "Dashboard view".
- **Default rule.** A pure function in `src/ui/dashboard-view.ts`: `chooseView(stored: DashboardView | null, sent: number, narrow: boolean): DashboardView`.
  - `narrow` gives `breakdown`;
  - otherwise a valid stored value wins;
  - otherwise `sent >= JOURNEY_MIN_SENT` gives `journey`, else `breakdown`, with `JOURNEY_MIN_SENT = 10`;
  - `sent` = `summary.funnel.applied`.
- **Persistence (Decision 5A).**
  - Clicking the switch saves the choice under `localStorage` key `dashboard-view` (`journey` | `breakdown`), for all profiles.
  - Reads and writes are wrapped in try/catch like `theme.ts`, so a blocked storage falls back to the automatic rule.
  - Only an explicit click stores a value.
- **Hidden switch.** The switch is hidden when narrow (`useIsMobile`) and when the profile has no applications (the empty state shows instead).

### Non-goals

- No new chart library. No server setting for the view. No change to the Breakdown cards. The mock sandbox seed is unchanged; its richest profile has 8 sent, so it opens in Breakdown and Journey is one click away.

## Analysis

Sources checked:

- `src/server/domain/dashboard.ts`, `src/ui/pages/DashboardPage.tsx`, `src/ui/components/dashboard/*`, `src/ui/theme.ts`, `src/ui/hooks/use-mobile.ts`, `src/ui/components/ui/button-group.tsx`, `src/ui/styles.css`.
- SOW-0034, SOW-0035, SOW-0036; the mockup file.

Current state:

- See Facts.

Risks:

- **Custom SVG layout bugs** (overlaps, overflow) that jsdom cannot see. Mitigation: a browser check at 9, 30 and many applications, in both themes.
- **Hidden switch.** Users of narrow windows never see Journey. Accepted (6.A).
- **Stored choice outlives the threshold.** A stored choice keeps Breakdown even for a profile with 200 applications. Accepted (5.A); the switch is always visible on desktop.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The Dashboard lacks a single overview of progress and drop-offs per stage. The summary has reach and current status, but not per-stage outcome counts.

Evidence reviewed:

- Sources above. No external open-source code; the layout is hand-written from the approved mockup.

Affected contracts and surfaces:

- The summary response gains `stopped_at`.
- New UI: `JourneyCard`, the view switch, `src/ui/dashboard-view.ts`.
- `DashboardPage` layout.
- A new `localStorage` key, `dashboard-view`.
- Tests: domain, API (field present), components, view rule, page.
- Spec and README.

Existing patterns to reuse:

- Reach computation; `FUNNEL_STAGES`; step phrases from `FunnelCard` (move them to a shared spot if both need them, rather than duplicating).
- Tooltip with its own provider; the `theme.ts` storage guards; `useIsMobile`; `ButtonGroup` and `Button`; status tokens.

Risk and blast radius:

- Dashboard only. Breakdown is unchanged; one response field is added. No schema, route or repository-write change.

Sensitive data handling plan:

- None. Invented data only.

Implementation plan:

1. Test first: `stopped_at` in `summarizeDashboard`, with the invariants. Add a route test assertion that the field is present.
2. Test first: `chooseView` and the storage helpers in `src/ui/dashboard-view.ts`.
3. Test first: `JourneyCard` (labels, shares, caption, exits, offer, `aria-label`, zero cases).
4. `DashboardPage`: the switch, the two views, the defaults, persistence, hidden when narrow or empty. Page tests: journey at 10 sent, breakdown at 9, a click switches and stores, a stored value wins, narrow hides the switch (stub `matchMedia` and `innerWidth`, restore in `afterEach`).
5. Spec and README.
6. Typecheck, the full suite, then a browser check: both views, both themes, the switch and persistence, and a 30+ application profile in a throwaway data dir. Then an independent review.

Validation plan:

- The tests above, `npm test`, `npm run typecheck`, the Chrome check with screenshots, and an independent reviewer.

Artifact impact plan:

- AGENTS.md: unaffected.
- Runtime project skills: `project-testing` gains a note only if a new test pattern is needed (for example stubbing `innerWidth`); otherwise unaffected.
- Specs: the Dashboard section (views, switch, rule, `stopped_at`, graph contract).
- End-user/operator docs: the README Dashboard bullet.
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/` in the commit with the work.

Open-source reference evidence:

- None; not relevant.

Open decisions:

- None.

## Implications And Decisions

Recorded 2026-11-09.

1. **Main graph design.**
   - A: journey with exits.
   - B: stage to outcome.
   - C: stacked columns.
   - **Selected A** (user picked it from the browser mockups).
2. **What branches off.**
   - A: all four (waiting, rejected, no response, withdrawn).
   - B: only no response and rejected.
   - **Selected A.**
3. **What the graph replaces.**
   - A: both cards.
   - B: the status bar only.
   - C: the status bar, with the funnel percentages folded into the graph.
   - **Selected A**, then refined by Decision 4 into two views.
4. **Default threshold.**
   - A: 10 sent.
   - B: 15 sent.
   - C: 20 sent.
   - **Selected A.**
5. **Remembering the choice.**
   - A: in the browser, for all profiles.
   - B: per profile.
   - C: not remembered.
   - **Selected A.**
6. **Narrow windows.**
   - A: Breakdown only below 768 px, with no switch.
   - B: a Journey that scrolls sideways.
   - **Selected A.**

7. **Journey text at medium widths** (raised by the implementer and the review; measured in Chrome).
   - The graph scales with its card, so labels were 8–9 px in a 1024 px window and about 6 px at 860 px. They reach about 12 px only from about 1280 px.
   - A: Journey only from 1280 px windows. B: redesign for narrow cards. C: accept.
   - **Selected A** (user, "all recommended"). This replaces the 768 px cutoff of Decision 6. Below 1280 px: always Breakdown, no switch.
8. **Spaced-out digit "1"** (Manrope tabular figures render "17" as "1 7").
   - A: normal digits in the Dashboard tiles and the graph labels. B: the graph only.
   - **Selected A.**

Assistant calls (the user can override):

- In Journey, "Needs attention" sits below the graph at full width, because the graph needs the width.
- Hand-drawn SVG with no library.
- Waiting at the Offer stage is labelled "offer".
- The switch labels are "Journey" and "Breakdown".

## Plan

See the implementation plan in the gate.

## Execution Log

### 2026-11-09

- Browser mockups (three options); the user chose A, then asked for two views with a switch (Decisions 1-6).
- An implementer built the change test-first in three commits:
  - `e5c4c7a`: `stopped_at` in the summary;
  - `c6b781a`: `JourneyCard`, the view rule and `steps.ts` for the shared step phrases;
  - `fc53ddb`: the switch and the two views on the Dashboard.
- Accepted deviations:
  - one page test pins `breakdown`, because its fixture has 24 sent;
  - node spacing is 220 and exit length 136 units instead of about 250 / 150, to stay inside the 940 viewBox;
  - a bar grows when minimum ribbon thicknesses add up.
- Independent review: approved. Its one Important finding was the small Journey text at medium widths, which I confirmed in Chrome (8–9 px at 1024, about 6 px at 860). The user decided 7.A (Journey only from 1280 px) and 8.A (proportional digits).
- Fix commit `dd4d2d9`:
  - the 1280 px rule (`useJourneyFits`; `useIsMobile` untouched);
  - no `tabular-nums` on the tiles or the graph;
  - shared `STATUS_COLOR_VAR`;
  - an applied → saved test;
  - Offer exits shortened to 108 units so labels fit.
  - The scoped re-review found all six items addressed and no new breakage.

## Validation

Acceptance criteria evidence:

1. `stopped_at`: the unit tests check the invariants (`Σ stopped_at[X] = funnel[X] − funnel[next]`, `rejected` equals `rejected_at`) across every status path, plus applied → saved. The API test asserts the field. Real data (29 sent) gives 19 / 5 / 4 / 1, matching the funnel drops.
2. Journey graph: component tests cover labels, shares, caption, exits, the offer label, the `aria-label`, zero cases, no `NaN`, no tab stops and the label room at Offer. In Chrome the `aria-label` read "29 sent. Applied 29: 11 waiting, 4 rejected, 3 no response, 1 withdrawn. Screening 10: …".
3. View switch:
   - `chooseView` unit tests;
   - page tests: Journey at 10 sent, Breakdown at 9, a click switches and stores, a stored value wins, 1279 px gives Breakdown with no switch, 1280 px shows the switch, the empty state has no switch.
   - In Chrome: Journey by default (29 sent); clicking Breakdown stored `breakdown` and survived a reload; clearing it brought Journey back.
   - Same-origin frames of 1024 and 1279 px show Breakdown with no switch; 1280 px shows Journey with labels of at least 11.6 px.
4. Breakdown is unchanged; the existing page and card tests pass.
5. Browser: both views, light and dark, hover tooltip "4 rejected after applying", no horizontal overflow, no `NaN`.
6. `npm run typecheck` exit 0. `npm test`: `Test Files 74 passed (74)`, `Tests 1059 passed (1059)`, no warnings.

Tests or equivalent validation:

- As above, with TDD evidence (RED then GREEN) in the execution reports for each step and for the fix round.

Real-use evidence:

- Chrome, on a throwaway copy of the mock sandbox plus 22 invented applications added through the API (29 sent). Screenshots of light, dark and the fixed version were shown to the user.

Reviewer findings:

- First review: approved. Important: small text at medium widths (user Decision 7). Minors: colour maps duplicated, no applied → saved test, label clipping at Offer, a double blank line. All fixed in `dd4d2d9`.
- Re-review: all six addressed; no new breakage.
- Out of scope and accepted: Offer exits are 108 units against 136 for the other stages.

Same-failure scan:

- `grep -rn "rejected_at" test src`: every summary fixture carries `stopped_at`.
- `grep -rn "tabular" src/ui`: only the funnel count column, the legend and `TableView` keep it, as decided.

Sensitive data gate:

- Invented data only (Acme, Globex, "Invented Co N"). No workstation paths in durable text. The throwaway data directory `.tmp/journey-check` is git-ignored.

Artifact maintenance gate:

- AGENTS.md: unaffected; no new command or rule.
- Runtime project skills:
  - `project-testing` already documents stubbing `matchMedia` with `vi.stubGlobal` and restoring it; the `innerWidth` stub follows the same pattern, so no update.
  - `project-local-api`: no new route.
- Specs: `.agents/sow/specs/product-v1.md` Dashboard section, covering:
  - `stopped_at` and its invariants;
  - the known edge cases;
  - both views, the switch, the default rule, storage and the 1280 px rule;
  - the graph contract;
  - proportional digits.
- End-user/operator docs: the `README.md` Dashboard bullet about Journey and Breakdown.
- End-user/operator skills: none exist.
- SOW lifecycle: `completed`, moved to `done/`, committed with the docs (the code commits came first, on the same branch).

Specs update:

- As above.

Project skills update:

- None needed; see above.

End-user/operator docs update:

- `README.md`, as above.

End-user/operator skills update:

- None exist.

Lessons:

- A graph that scales with its container needs a readable-text check at the real breakpoints, not only at the developer's window width. The 768 px cutoff looked safe on paper; measuring rendered font sizes in frames of 860, 1024 and 1280 px showed it was not.
- Fixed-width digits suit columns, not headline numbers. In this font they look broken in single values ("1 7").

Follow-up mapping:

- None. Known edges (an offer corrected back to interview, applied corrected back to saved) are recorded in the spec as behaviour of the approved rules, not as defects.

## Outcome

Delivered. On windows 1280 px or wider, the Dashboard offers two views under the tiles:

- Journey: a flow graph from Applied to Offer, where the applications that stop at each stage branch off as labelled ribbons (waiting, rejected, no response, withdrawn).
- Breakdown: the status bar and funnel.

Journey is the default from 10 sent applications, and the choice is remembered in the browser.

## Lessons Extracted

- See Validation → Lessons.

## Followup

None.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
