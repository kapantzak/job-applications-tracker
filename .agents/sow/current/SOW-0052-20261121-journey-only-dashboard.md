# SOW-0052 - Journey-only Dashboard

## Status

Status: in-progress

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: implementation, docs and validation done and committed; waiting for the new demo video attachment to be visible to visitors, then the README links are swapped and the SOW closes.

## Requirements

### Purpose

Simplify the Dashboard to one way of showing applications: the Journey graph.

### User Request

"Completely remove the Breakdown layout option from the dashboard. The dashboard should only show the applications using the Journey view. Cleanup any unused code."

### Assistant Understanding

Facts:

- The Dashboard has two views (SOW-0037): Journey (`JourneyCard`) and Breakdown (`StatusBarCard` + `FunnelCard`), chosen by a "Dashboard view" button group, a `localStorage` key `dashboard-view`, a default rule (Journey from 10 sent) and a width rule (below 1280 px Breakdown only). Evidence: `src/ui/pages/DashboardPage.tsx`, `src/ui/dashboard-view.ts`.
- `rejected_at` in the dashboard response is read only by `FunnelCard`. It equals `stopped_at[stage].rejected` (spec `product-v1.md`, Dashboard section).
- `STATUS_COLOR_CLASS` and the `--color-status-*` Tailwind theme tokens are used only by the Breakdown cards; `STATUS_COLOR_VAR`, the `--status-*` variables and `AFTER_STEP` are used by Journey.
- `docs/images/dashboard.png` shows Breakdown; demo video scene 10 (`scripts/demo-video/record.mjs`, "See where every application stands.") opens the Dashboard with fewer than 10 sent, so it shows Breakdown.

Inferences:

- Without the width rule, Journey must handle windows under 1280 px itself (SOW-0037 Decision 7 readability concern).

Unknowns:

- None; the design forks below are decided.

### Acceptance Criteria

- The Dashboard shows the Journey card (and Needs attention under it) for every profile with applications, at every window width, with no view switch. Verified by `test/ui/DashboardPage.test.tsx`.
- Below the width the graph has at a 1280 px window, the graph keeps that width and its card scrolls sideways. Verified by a unit test of the min-width style and a manual check at 1024 px.
- `StatusBarCard`, `FunnelCard`, `dashboard-view.ts`, `STATUS_COLOR_CLASS`, the `--color-status-*` theme tokens and `rejected_at` are gone, with their tests; `npm run typecheck` and `npm test` pass.
- README, spec and `AGENTS.md` describe one view; `docs/images/dashboard.png` shows Journey; the demo video is re-recorded with the unchanged captions.

## Analysis

Sources checked:

- `src/ui/pages/DashboardPage.tsx`, `src/ui/dashboard-view.ts`, `src/ui/components/dashboard/*`, `src/ui/styles.css`, `src/ui/components/Layout.tsx`, `src/ui/components/ui/card.tsx`, `src/ui/components/ui/sidebar.tsx`.
- `src/server/domain/dashboard.ts`, `test/server/domain/dashboard.test.ts`, `test/server/api/dashboard.test.ts`.
- `test/ui/DashboardPage.test.tsx`, `test/ui/dashboard-cards.test.tsx`, `test/ui/dashboard-view.test.ts`.
- `README.md` (Interface), `.agents/sow/specs/product-v1.md` (Dashboard), `AGENTS.md` (demo video note), `scripts/demo-video/record.mjs`, `docs/images/dashboard.png`.
- `.agents/sow/done/SOW-0037-20261109-dashboard-journey-view.md` (Decision 7).

Current state:

- `DashboardPage.tsx` renders the switch only when the window is at least 1280 px and picks the view via `chooseView`.
- `ButtonGroup` stays in use by `FindJobsButton`; the Tooltip components stay in use by `JourneyCard`.

Risks:

- Narrow windows: the Journey SVG scales with its card; below 1280 px its 12-unit labels render under 12 px (Decision 7). Handled by decision 1.
- A profile with only saved or withdrawn applications shows "0 sent · N saved" with empty headers (decision 2 keeps that).
- Removing `rejected_at` changes the dashboard API response; the UI is its only consumer and the demo script reads `stopped_at` only.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The user wants one Dashboard view. Breakdown code, the switch, its persistence and default rules, Breakdown-only helpers and the API field only Breakdown read become dead once Journey is the only view.

Evidence reviewed:

- See Analysis sources. No external open-source references were relevant (local UI refactor).

Affected contracts and surfaces:

- UI: Dashboard page layout; `localStorage` key `dashboard-view` is no longer read or written.
- API: `GET /api/profiles/:pid/dashboard` drops `rejected_at`.
- Tests: UI dashboard tests, server dashboard domain and API tests.
- Docs: README Interface, `docs/images/dashboard.png`, demo video and its README attachment links; spec Dashboard section; `AGENTS.md` demo video note.

Existing patterns to reuse:

- `JourneyCard` as is; Tailwind `overflow-x-auto` and an inline `minWidth` on the SVG; the existing screenshot (SOW-0038/0047) and demo video (SOW-0048..0050) procedures in `AGENTS.md`.

Risk and blast radius:

- UI-only behaviour change plus one removed response field. No data migration, no stored data touched. A stale `dashboard-view` key stays in browsers, unread and harmless.

Sensitive data handling plan:

- Screenshots and the video come from `npm run sandbox:mock` / `npm run demo:video` invented data; frames are checked for personal data before commit. No real run logs or mail in any artifact.

Implementation plan:

1. Server: remove `rejected_at` from `DashboardSummary` and `summarizeDashboard`; update domain and API tests (keep the `stopped_at.rejected` checks).
2. UI: delete `StatusBarCard.tsx`, `FunnelCard.tsx`, `dashboard-view.ts`, `STATUS_COLOR_CLASS`, `--color-status-*` tokens; render Journey + Needs attention unconditionally in `DashboardPage.tsx`; give the Journey SVG a minimum width inside a horizontally scrolling wrapper.
3. Tests: delete `dashboard-view.test.ts` and the two card blocks in `dashboard-cards.test.tsx`; replace the view tests in `DashboardPage.test.tsx`; add a min-width test for `JourneyCard`.
4. Docs: README Interface, spec, `AGENTS.md`; retake `docs/images/dashboard.png`; re-record the demo video.

Validation plan:

- `npm run typecheck`, `npm test`, `npm run build`; `npm run sandbox:mock` at 1440 and 1024 px wide; independent reviewer; same-failure grep for `breakdown`, `rejected_at`, `StatusBarCard`, `FunnelCard`, `dashboard-view`, `STATUS_COLOR_CLASS`, `bg-status-`.

Artifact impact plan:

- AGENTS.md: update the demo video re-record trigger ("Dashboard Breakdown and Journey" → "Dashboard Journey").
- Runtime project skills: none expected; no testing, adapter or local-api workflow changes (the route code is unchanged; only the domain summary loses a field).
- Specs: update `product-v1.md` Dashboard section (response, rules, views).
- End-user/operator docs: README Interface text, `docs/images/dashboard.png`, demo video links.
- End-user/operator skills: none exist (AGENTS.md: "Output/reference skills: none").
- SOW lifecycle: single SOW; close as completed with the work in one commit.

Open-source reference evidence:

- None checked; the change is internal to this repository's UI and domain code.

Open decisions:

- All resolved, see below.

## Implications And Decisions

User accepted all recommendations on 2026-11-21.

1. Windows narrower than 1280 px: **B** — Journey keeps the width it has at a 1280 px window and its card scrolls sideways below that (long-term-best; keeps Decision 7's readability).
2. Profiles with applications but none sent: **A** — keep the current Journey rendering ("0 sent · N saved", empty headers); no new state (surgical).
3. `rejected_at`: **A** — remove it from the domain, the API response, tests and the spec (long-term-best).
4. Demo video: **A** — re-record now with unchanged captions; the user uploads the new file and the README attachment links are replaced.
5. (Raised during implementation, 2026-11-21, see Execution Log.) How the Journey card scrolls on narrow windows when the layout's `<main>` grows to fit the drawing: A `min-w-0` on `SidebarInset` (app-wide; Jobs, Applications and Runs tables then scroll in their own box instead of the page), B `contain: inline-size` on the Journey scroll area only, C accept page-level scrolling. Assistant recommended B (surgical). User chose **A** (app-wide fix of the cause). Consequence accepted with it: on windows where tables do not fit, Jobs, Applications and Runs no longer scroll the whole page sideways.

6. (Raised by the independent review, 2026-11-21.) The Journey scroll area had no keyboard access in Safari below ~1280 px: A make it a focusable labelled region (`tabIndex={0}`, `role="region"`, "Journey graph"), B leave it. Assistant recommended A (long-term-best). User chose **A**.

Accepted consequence of the removal (reported to the user, no change requested): the Breakdown legend linked every status; the Dashboard no longer links to the Saved, Withdrawn and No response lists (In progress, Interviews, Offers and Rejected keep their tiles; the Applications page filters still reach all statuses).

## Plan

See Pre-Implementation Gate implementation plan.

## Execution Log

### 2026-11-21

- SOW opened with decisions 1B, 2A, 3A, 4A.
- Server `rejected_at` removed; Breakdown cards, `dashboard-view.ts`, `STATUS_COLOR_CLASS`, `--color-status-*` tokens and their tests removed; Dashboard renders Journey + Needs attention; Journey SVG `minWidth` 910 px in an `overflow-x-auto` card content. Spec, README, AGENTS.md updated. `npm run typecheck` clean; `npm test` 83 files / 1358 tests passed.
- Real-use check (`npm run sandbox:mock`, Playwright at 1440/1280/1024 px): the drawing is 910 px wide in a 1280 px window (labels 15 px tall), confirming the constant. At 1024 px the whole page scrolled sideways by 178 px instead of the card: `SidebarInset` (`<main>`, a flex item) keeps `min-width: auto` and grows to the drawing. Same pre-existing page-level overflow measured on Jobs (178 px), Applications (115 px) and Runs (155 px) at 1024 px. Two fixes verified by injected CSS: `min-width: 0` on `SidebarInset` (all pages lose page-level overflow; their tables would scroll inside their own box) and `contain: inline-size` on the Journey scroll area (Dashboard only; card content 702 px wide, scrolls to 958 px, page overflow 0). Implementation paused for user decision 5.
- Decision 5A applied: `SidebarInset className="min-w-0"` in `src/ui/components/Layout.tsx`, guarded by a Layout test. Re-measured on a fresh `sandbox:mock` build: page-level sideways overflow is 0 on every page (Dashboard, Jobs, Applications, Review, Runs, Profile, Settings, Profiles) at 1024 and 800 px (before: Dashboard 178, Jobs 178, Applications 115, Runs 155 px at 1024); Journey card content 702 px wide scrolling to 958 px at 1024; drawing 910 px at 1280 and 1038 px at 1440. Before the fix the overflow also squeezed the sidebar to 178 px and pushed header actions (Add application) off-screen at 1024; after it the sidebar keeps 256 px and the Jobs, Applications and Runs tables scroll inside their own container. 1440 px layouts unchanged (page overflow 0 before and after; byte differences are reseeded timestamps).
- `docs/images/dashboard.png` retaken from `sandbox:mock` (profile Frontend Platform, 1440×900, light); README Dashboard caption and alt text updated.
- Demo video re-recorded with `npm run demo:video` (89.7 s, unchanged captions); the script's Journey-number check passed. Scene 10 now shows a 2-sent Journey under "See where every application stands."; the opening still and scene 11 show the 42-sent Journey. Frames checked on a 3 s contact sheet and full-size scene 10: invented data only.

## Validation

Acceptance criteria evidence:

- Journey + Needs attention for every profile with applications, no switch, any width: `test/ui/DashboardPage.test.tsx` "shows the journey graph with the attention card below it", "shows Journey for a single sent application, with no view switch", "shows Journey in a window narrower than 1280 px", "ignores a view choice stored by an earlier version", "shows Journey with nothing sent but saved applications" (caption, four 0 headers, no bars or exits).
- Minimum width and card scrolling: `test/ui/dashboard-cards.test.tsx` "keeps a minimum drawing width inside a sideways-scrolling area"; `test/ui/Layout.test.tsx` "lets the main area shrink below its widest content"; browser measurements in the Execution Log (910 px at 1280; card 702 px scrolling to 958 px at 1024; page overflow 0 on every page at 1024 and 800 px).
- Removals: `StatusBarCard.tsx`, `FunnelCard.tsx`, `dashboard-view.ts`, `test/ui/dashboard-view.test.ts` deleted; `STATUS_COLOR_CLASS`, `--color-status-*`, `rejected_at` removed; `test/server/api/dashboard.test.ts` asserts the response has no `rejected_at`.
- Docs and media: spec, README, AGENTS.md updated; `docs/images/dashboard.png` retaken; demo video re-recorded (README attachment links pending the user's upload, see Follow-up mapping).

Tests or equivalent validation:

- `npm run typecheck`: clean.
- `npm test`: `Test Files  83 passed (83)`, `Tests  1360 passed (1360)`, no warnings or `act(...)` output.
- `npm run build`: succeeds (the Vite chunk-size notice is pre-existing).

Real-use evidence:

- `npm run sandbox:mock` driven by Playwright (scratch install under `.tmp/demo-video`) at 1440, 1280, 1024 and 800 px; screenshots compared before/after for Dashboard, Jobs, Applications, Runs and Review (see Execution Log).
- `npm run demo:video` end to end; frames reviewed.

Reviewer findings (final run after decision 6A: typecheck clean, 83 files / 1360 tests):

- Independent reviewer (fresh agent, diff and requirements only): no correctness bugs, no dead code left, nothing needed removed.
- Important: README Interface bullets merged into one line (a newline lost in the edit). Fixed.
- Minor: spec did not record the `min-w-0` layout rule. Fixed (spec Journey bullet).
- Minor: spec said "all saved or withdrawn" shows 0 sent; withdrawn after applying counts as sent. Fixed to "withdrawn before applying".
- Minor: Decision 2 test checked only the caption. Fixed: asserts four 0 headers and no nodes, ribbons or exits.
- Minor: narrow-window test cannot fail today. Kept as a guard against a returning width rule, with a comment saying so.
- Minor: the Journey scroll area is not keyboard-focusable; Safari keyboard users below ~1280 px cannot scroll to the Offer stage (the `aria-label` still reads the whole graph). Design call, raised to the user as decision 6.
- Decision 6A implemented: `JourneyCard` scroll area is a focusable region "Journey graph" with the shadcn focus ring; test "makes the scroll area a labelled region that the keyboard can reach"; in Chromium at 1024 px, focus plus ten ArrowRight presses scroll it to the end (scrollLeft 256 of 256) with the Offer stage visible.
- Nits: stale "shared by the funnel" comment in `steps.ts` fixed; the pinned `JOURNEY_MIN_WIDTH_PX` value kept as a tripwire tying test to the spec's 910 px; `status-colors.ts` kept with one consumer.

Same-failure scan:

- `grep -rniE "breakdown|where every application stands|how far applications get|rejected_at|StatusBarCard|FunnelCard|dashboard-view|STATUS_COLOR_CLASS|bg-status-|useJourneyFits|chooseView" README.md AGENTS.md src test scripts .agents/sow/specs docs`: remaining hits are intentional (tests asserting absence or the legacy key, spec history notes, the unchanged demo caption, and `docs/superpowers/` history which is not updated by rule).
- Page-level overflow scan of eight pages at 1024 and 800 px: 0 everywhere after the fix.

Sensitive data gate:

- Screenshot and video come from invented mock data (invented companies, `example.com` addresses, placeholder CV); Settings → Agent and Settings → Data were not captured. No run logs, mail or personal data in the SOW, spec, README or code comments.

Artifact maintenance gate:

- AGENTS.md: updated demo-video re-record trigger ("Dashboard Journey").
- Runtime project skills: no update; no new testing, adapter or local-api workflow (the route code is unchanged; the jsdom class-guard pattern for layout is a one-off noted in the test comment).
- Specs: `.agents/sow/specs/product-v1.md` Dashboard section updated (response, reach rules, Journey-only view, min width, `min-w-0` rule, zero-sent rendering).
- End-user/operator docs: README Dashboard caption, alt text and Interface bullets; `docs/images/dashboard.png`; `docs/video/demo.mp4` and `demo-poster.png`.
- End-user/operator skills: none exist (AGENTS.md: "Output/reference skills: none").
- SOW lifecycle: single SOW; status and directory consistent (`in-progress` in `current/`) until close.

Specs update:

- `.agents/sow/specs/product-v1.md` lines 84-90.

Project skills update:

- None needed: no skill describes the Dashboard views or the removed field (checked `project-testing`, `project-local-api`, `project-agent-adapter`).

End-user/operator docs update:

- README.md, docs/images/dashboard.png, docs/video/*.

End-user/operator skills update:

- None exist.

Lessons:

- A minimum-width child inside the sidebar layout pushes the whole page wider unless the flex item `<main>` has `min-w-0`; jsdom cannot see this, so width behaviour needs a real-browser check.
- Multi-line Python string replacements in Markdown can drop the newline between list items; re-read the rendered lines after such edits.

Follow-up mapping:

- README video attachment links: replaced after the user uploads the new `demo.mp4` (AGENTS.md procedure); must happen before close.
- Keyboard scrolling of the Journey card in Safari: implemented (decision 6A).
- Demo video attachment: the user uploaded the new `demo.mp4` (asset `e8d6f245-…`), but an anonymous `curl -L` returns 404 (the current README asset returns 200 `video/mp4`, 2 162 101 bytes, so the check itself works). Per AGENTS.md this is an attachment in an unposted comment. The README keeps the current link until the new one answers 200 anonymously; then both links are swapped and this SOW closes in that commit.

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
