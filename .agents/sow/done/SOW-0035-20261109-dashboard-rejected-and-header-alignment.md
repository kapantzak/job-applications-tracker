# SOW-0035 - Rejected in red with its own Dashboard tile, and aligned header actions

## Status

Status: completed

Sub-state: delivered, reviewed, validated.

## Requirements

### Purpose

Polish the Dashboard delivered by SOW-0034 after the user reviewed it: make the sync scope note line up with the header buttons, show rejected applications in red, and give them their own tile.

### User Request

"The 'Sync searches Gmail label' is not aligned well with the rest of the buttons in the same div. Please fix it. Also, lets use a red color for 'Rejected' applications, and show the rejected tile on the dashboard." Decisions: 1.A, 2.A, 3.A (below).

### Assistant Understanding

Facts:

- `PageHeader` lays out actions in `flex flex-wrap items-center gap-2` (`src/ui/components/PageHeader.tsx:16`). `SyncScopeNote` takes its own line with `basis-full text-right` (`src/ui/components/SyncScopeNote.tsx:31`). So the note is right-aligned to the page edge while the buttons stay left-aligned in the same box. Measured in the SOW-0034 sandbox: buttons at x 836–1143, note ending at x 1428. The note appears on the Dashboard and Applications pages (`DashboardPage.tsx:140`, `ApplicationsPage.tsx:153`).
- The rest of the app already shows Rejected in red: `STATUS_TONES.rejected = 'destructive'` (`src/ui/labels.ts:22`) drives `StatusBadge` on the Jobs and application detail pages. SOW-0034's anti-goal "no alarm red for rejections" broke that convention. This SOW reverses it at the user's request.
- The Dashboard bar takes the Rejected color from `--status-rejected` (`src/ui/styles.css`: light `#52525b`, dark `#a1a1aa`, both grays). The app's red is `--destructive` (light `oklch(0.577 0.245 27.325)`, dark `oklch(0.704 0.191 22.216)`).
- The Dashboard has four tiles in `grid grid-cols-2 gap-4 sm:grid-cols-4` (`DashboardPage.tsx:148`). `status_counts.rejected` is already in the summary response (SOW-0034), so no server change is needed.

Inferences:

- `justify-end` in `PageHeader` changes layout only when the actions take more than their content width: when the note forces a full line, or when the header wraps on narrow screens. Other pages' wide-screen headers look the same.

Unknowns:

- None.

### Acceptance Criteria

- On the Dashboard and Applications pages, the header buttons and the sync note share the same right edge. Verified in the sandbox by measuring the right edge of the last button against the note's right edge.
- The status bar segment and legend swatch for Rejected use the app's red (`--destructive`) in both themes. Withdrawn and No response stay gray. Verified by the tokens, a page check in both themes, and the component tests still passing.
- The Dashboard shows a fifth tile "Rejected" after Offers, with count `status_counts.rejected`, a red icon, the number in normal text color, and a link to `applications?status=rejected`. The grid is 2 / 3 / 5 columns (narrow / medium / wide). Verified by a page test (count and href) and a sandbox check.
- Spec and README describe the new tile and colors. `npm run typecheck` and `npm test` pass.

## Analysis

Sources checked:

- `src/ui/components/PageHeader.tsx`, `src/ui/components/SyncScopeNote.tsx`, `src/ui/pages/DashboardPage.tsx`, `src/ui/pages/ApplicationsPage.tsx`, `src/ui/labels.ts`, `src/ui/components/StatusBadge.tsx`, `src/ui/styles.css`.
- `.agents/sow/specs/product-v1.md` (Dashboard section), `README.md:195`.
- SOW-0034 (`done/`), SOW-0032 (sync note placement).

Current state:

- See Facts.

Risks:

- `justify-end` on all `PageHeader` actions: on narrow screens, where the actions wrap under the title, they now sit at the right. Accepted by the user (Decision 1, option A). The app is desktop-only (README).
- The vivid red next to the blues draws the eye to rejections. This is the user's explicit choice (Decision 2).

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Misalignment: the note's `basis-full` widens the actions box to the header's free width, but nothing right-aligns the buttons inside that box. Evidence: the class lists cited in Facts, and the x positions measured in the SOW-0034 real-use check.
- Gray rejections: a deliberate SOW-0034 design rule, now reversed by the user.
- No rejected tile: not in the SOW-0034 layout.

Evidence reviewed:

- Files listed under Analysis. No external open-source references; the change uses only local components and tokens.

Affected contracts and surfaces:

- UI: `PageHeader` (every page header), the Dashboard tiles, the `--status-rejected` token (Dashboard bar and legend only).
- Tests: `test/ui/DashboardPage.test.tsx` (new tile). Existing header and page tests must keep passing.
- Docs: spec Dashboard section, README Dashboard bullet.

Existing patterns to reuse:

- `StatCard` in `DashboardPage.tsx`; lucide icons; the `text-destructive` utility (`--color-destructive`); `--destructive` as the single source of red.

Risk and blast radius:

- Layout-only change in `PageHeader`; no behavior change. One extra tile from data the response already carries. No API, schema or server change.

Sensitive data handling plan:

- None involved. Tests and docs use invented data only.

Implementation plan:

1. `src/ui/components/PageHeader.tsx`: add `justify-end` to the actions container (extended with `ml-auto` during the browser check; see Execution Log). Update the stale comment in `SyncScopeNote.tsx` only if it describes the alignment.
2. `src/ui/styles.css`: `--status-rejected: var(--destructive)` in `:root` and `.dark`, and update both comments (rejected is red, the grays are withdrawn and no response).
3. `src/ui/pages/DashboardPage.tsx`: add a "Rejected" `StatCard` (`testId` `count-rejected`, icon lucide `CircleXIcon` in `text-destructive`, link `/applications?status=rejected`) after Offers, and change the grid to `grid-cols-2 md:grid-cols-3 xl:grid-cols-5`. Test first in `test/ui/DashboardPage.test.tsx`.
4. Spec and README updates.
5. Typecheck, full suite, sandbox check in both themes (alignment measured on Dashboard and Applications), independent review.

Validation plan:

- Page test for the Rejected tile's count and href. Full `npm test` and `npm run typecheck`. Sandbox check in Chrome: edge alignment measured on both pages, bar and legend red in both themes, five tiles in one row at desktop width. Independent reviewer on the diff.

Artifact impact plan:

- AGENTS.md: no new command or rule; likely unaffected.
- Runtime project skills: no API, test pattern or agent change; likely unaffected.
- Specs: `.agents/sow/specs/product-v1.md` Dashboard section (tiles, colors).
- End-user/operator docs: `README.md` Dashboard bullet.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW; completed and moved to `done/` in the same commit as the work.

Open-source reference evidence:

- None checked; not relevant to a local layout and color change.

Open decisions:

- None. Decisions 1-3 resolved below.

## Implications And Decisions

Recorded 2026-11-09; the user answered "1.A, 2.A, 3.A".

1. **Header alignment.**
   - A: `justify-end` on the `PageHeader` actions.
   - B: a right-aligned column wrapper on the two pages only.
   - C: left-align the note.
   - **Selected A:** one-line fix for both pages, matching SOW-0032's "under the buttons" intent.
2. **Which red.**
   - A: reuse `--destructive`.
   - B: a new chart-specific red.
   - **Selected A:** one red for Rejected across badges and charts.
   - Supersedes SOW-0034's anti-goal "no alarm red for rejections" and its "rejected darkest/most visible gray" color rule.
3. **Rejected tile.**
   - A: the same look as the other tiles, with a red icon and the number in normal text color.
   - B: a red number.
   - **Selected A.**
   - Placement: after Offers. Count: all rejected applications. Link: `applications?status=rejected`.
   - Grid 2 / 3 / 5 (narrow / medium / wide): proposed by the assistant and not objected to.

## Plan

See the implementation plan in the gate.

## Execution Log

### 2026-11-09

- SOW written after the user's decisions.
- The Rejected tile test was written first and failed as expected (`Unable to find ... count-rejected`). Then implemented in `DashboardPage.tsx`, `styles.css` and `PageHeader.tsx`.
- Deviation within Decision 1A: the browser check showed that `justify-end` alone aligned the buttons and the note on Applications, but the group floated mid-page. There, the long description wraps the actions onto their own line, and both ended at x 938. Added `ml-auto` so the actions block itself sits at the right edge ("right-align the whole actions area", as option A was described). Reviewed as in scope.
- Independent review: approved. Every `PageHeader` caller was checked; pages without actions are unchanged, and single-action headers (Jobs, Profiles, ApplicationDetail, RunPage) sit at the right edge.

## Validation

Acceptance criteria evidence:

- Alignment, measured in Chrome on the mock sandbox: the last button's right edge equals the note's right edge, and both equal the header's right edge (x 1428), on the Dashboard and on Applications (actions on their own line under the description). Jobs and the Profiles screen also end at 1428. Before: buttons ended at x 1143 while the note ended at 1428 (Dashboard).
- Red: the computed color of the Rejected bar segment and its icon is `oklch(0.577 0.245 27.325)` in light mode and `oklch(0.704 0.191 22.216)` in dark mode, the same values as `--destructive`. Withdrawn and No response are unchanged grays.
- Tile: five tiles in one row at desktop width, Rejected after Offers. Page test asserts count 6 and href `applications?status=rejected`.
- `npm run typecheck` exit 0. `npm test`: `Test Files 73 passed (73)`, `Tests 1026 passed (1026)`.

Tests or equivalent validation:

- `test/ui/DashboardPage.test.tsx` ("tiles show counts and link to matching lists") gained the Rejected assertions, which went RED then GREEN. Layout and color are checked in the browser, which jsdom cannot do.

Real-use evidence:

- See the acceptance evidence above. Mock data is invented (`npm run sandbox:mock` seed).

Reviewer findings:

- Approved, with three minors:
  - Record the `ml-auto` deviation: done above.
  - The grid gives 2 per row between 640 and 767 px and 3 + 2 between 768 and 1023 px. This follows the 2 / 3 / 5 decision, and the app is desktop-only.
  - Comments confirmed accurate.

Same-failure scan:

- `grep -rn "<PageHeader" src/ui`: every caller reviewed (see the Execution Log). `SyncScopeNote` is used only on the Dashboard and Applications, and both are aligned.

Sensitive data gate:

- No sensitive data. Invented sandbox data only; no workstation paths in the durable text.

Artifact maintenance gate:

- AGENTS.md: no new command, rule or workflow.
- Runtime project skills: unaffected. No API, test pattern, agent or route change.
- Specs: `.agents/sow/specs/product-v1.md` Dashboard section now describes five tiles (Rejected with a red icon, the 2 / 3 / 5 grid) and the colors (Rejected = `--destructive`, the grays are Withdrawn and No response).
- End-user/operator docs: the `README.md` Dashboard bullet lists the Rejected tile and the red.
- End-user/operator skills: none exist.
- SOW lifecycle: `completed`, moved to `done/`, committed with the work.

Specs update:

- As above.

Project skills update:

- None needed, for the reasons above.

End-user/operator docs update:

- `README.md`, as above.

End-user/operator skills update:

- None exist.

Lessons:

- A shared layout component needs checking on every page that uses it, not only the page that prompted the change. The Applications header wraps differently from the Dashboard's, and only a browser check showed it.
- Check the app's existing visual conventions (here, the `STATUS_TONES` badge colors) before inventing new ones for a chart. SOW-0034's gray Rejected contradicted the badges.

Follow-up mapping:

- None. SOW-0034's "no alarm red" anti-goal and its gray Rejected rule are superseded by this SOW. The spec now states current reality.

## Outcome

Delivered:

- The header buttons and the sync scope note share one right edge on every page.
- Rejected is red in the Dashboard bar and legend, the same red as its badges.
- The Dashboard has a fifth tile, Rejected, linking to the rejected applications.

## Lessons Extracted

- See Validation → Lessons. Both lessons are recorded here; neither yet justifies a new project skill.

## Followup

None.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
