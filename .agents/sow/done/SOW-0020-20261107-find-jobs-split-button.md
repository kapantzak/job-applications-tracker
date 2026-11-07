# SOW-0020 - Find jobs split button

## Status

Status: completed

Sub-state: delivered 2026-11-07 on the PR #11 branch and committed with this file's move to `done/`.

## Requirements

### Purpose

One control starts a job search in either mode, so the choice between Default and Max effort reads as one action with an option, not two unrelated buttons.

### User Request

Turn "Find jobs" into a split button with an arrow on its right, like GitHub's "Merge pull request" button, using what shadcn provides, to choose between the Default mode and Max effort.

### Assistant Understanding

Facts:

- Today the Dashboard (`src/ui/pages/DashboardPage.tsx`) and the Jobs page (`src/ui/pages/JobsPage.tsx`) each show "Max-effort search" (`MaxSearchDialog` with its own trigger) next to "Find jobs".
- shadcn's Button Group (changelog October 2025) documents a split button: `ButtonGroup`, a `Button`, `ButtonGroupSeparator` and a `DropdownMenu` trigger. It is not installed here; `dropdown-menu` and `separator` are.
- `ThemeMenu` already uses `DropdownMenuRadioGroup`, tested in `test/ui/Layout.test.tsx`.

Inferences:

- None needed; the decisions fix the behaviour.

Unknowns:

- None.

### Acceptance Criteria

- Dashboard and Jobs page show one split button: the main part reads "Find jobs" (search icon) or "Find jobs with max effort" (rocket icon); the arrow part opens a menu with Default and Max effort as radio items with one-line descriptions.
- Choosing a menu item only changes the selection; nothing starts. Every page load starts on Default.
- Main button in Default starts a Default run; in Max effort it opens the existing warning dialog, and only its confirm starts a Max run.
- The separate "Max-effort search" button is gone from both pages. The Dashboard's busy state turns both parts off.
- UI tests cover these on both pages; `npm test`, `npm run typecheck`, `npm run build` pass; checked in a browser.

## Analysis

Sources checked:

- shadcn docs via Context7 (`/shadcn-ui/ui`): Button Group split pattern with `ButtonGroupSeparator` and `DropdownMenu`.
- `src/ui/components/MaxSearchDialog.tsx`, `ThemeMenu.tsx`, both pages and their tests.

Current state:

- See Facts.

Risks:

- `npx shadcn add` emits `import { cn } from "cn"` and installs an npm package `cn` (AGENTS.md); fixed by hand after the add.
- Radix menus render in a portal; tests must open them through the trigger.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Two separate buttons for one action with two modes.

Evidence reviewed:

- Files above; AGENTS.md shadcn rules; SOW-0016 regression section (Dashboard entry point).

Affected contracts and surfaces:

- UI only: new `src/ui/components/ui/button-group.tsx` (shadcn), new `src/ui/components/FindJobsButton.tsx`, `MaxSearchDialog.tsx` (controlled dialog without its own trigger), `DashboardPage.tsx`, `JobsPage.tsx`, `test/ui/DashboardPage.test.tsx`, `test/ui/JobsPage.test.tsx`, spec UI text, README Max-effort text. No API change.

Existing patterns to reuse:

- `ThemeMenu` radio menu; `MaxSearchDialog` text and loading; Radix portal testing in `project-testing`.

Risk and blast radius:

- Both search entry points. A wrong wiring could start Max without the dialog; tests assert the dialog gates it.

Sensitive data handling plan:

- No data involved; tests use invented ids.

Implementation plan:

1. `npx shadcn add button-group`; apply the AGENTS.md fix-ups; keep packages in devDependencies.
2. `MaxSearchDialog`: controlled `open`/`onOpenChange`, no trigger; loads details when opened.
3. `FindJobsButton`: split button (selection state, Default by default), opens the dialog for Max.
4. Pages use it; remove the old buttons.
5. Tests for both pages; docs.

Validation plan:

- UI tests (menu selection does not start a run; Default starts at once; Max needs confirm; Cancel starts nothing; busy disables both parts); full suite, typecheck, build; browser check in the user's sandbox.

Artifact impact plan:

- Spec `product-v1.md` (Jobs page and Dashboard controls); README (Max-effort section); `project-testing` skill only if a new test hazard appears; AGENTS.md unaffected unless the shadcn add shows new quirks.

Open-source reference evidence:

- shadcn-ui/ui docs (Button Group), read through Context7 2026-11-07; no local mirror used.

Open decisions:

- None; see Implications And Decisions.

## Implications And Decisions

User decisions (2026-11-07):

1. A. GitHub-style: the menu picks the mode, the main button shows and runs it; Max opens the warning dialog.
2. A. Not remembered; every page load starts on Default.
3. A. Dashboard and Jobs page share one component; the separate "Max-effort search" buttons go.
4. Labels: "Find jobs" and "Find jobs with max effort" (user's wording).

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- Created with the user's decisions.
- `npx shadcn@4.23.0 add button-group` stopped at a prompt to overwrite `button.tsx` (a registry dependency) and had already added `cn` to `dependencies`. Wrote `src/ui/components/ui/button-group.tsx` from `npx shadcn@4.23.0 view button-group` with the `cn` import fixed and the separator import pointed at `@/components/ui/separator`; ran `npm uninstall cn`. `package.json` is back to its committed state; `package-lock.json` keeps only the user's earlier one-line change. AGENTS.md shadcn note extended.
- `MaxSearchDialog` is now controlled (`open`, `onOpenChange`), loads its details in an effect each time it opens, and has no trigger of its own.
- New `src/ui/components/FindJobsButton.tsx`; Dashboard and Jobs page use it; the old Max button and unused `SearchIcon` imports removed.
- Tests: new `test/ui/FindJobsButton.test.tsx` (9 tests); Dashboard and Jobs Max tests go through the menu; Dashboard busy test covers both parts; Default start asserts `startDiscovery('pf1', 'default')`.

## Validation

Acceptance criteria evidence:

- Split button on both pages, labels, icons, menu items and descriptions: `test/ui/FindJobsButton.test.tsx` ("lists both modes with the current one checked and a description each", "choosing Max effort only relabels the main button and starts nothing"), Dashboard and Jobs page tests.
- Default starts at once; Max needs confirm; Cancel starts nothing and keeps Max selected; details reload on each open: FindJobsButton tests plus the existing Jobs page dialog-wording tests, now reached through the menu.
- Starts on Default on every mount: "a new mount starts on Default again".
- Busy state: "turns both parts off when disabled" and Dashboard "turns both parts of the split button off while a run is starting".
- Old "Max-effort search" button gone: `grep -rn "Max-effort search" src/ui` finds only the warning dialog's own text (title, confirm button, last-search lines).

Tests:

- `npm test`: `Test Files  55 passed (55)`, `Tests  645 passed (645)`, no warnings. `npm run typecheck` clean. `npm run build` passes; bundle 509.97 kB (+3 kB), same chunk-size warning as before.

Real-use evidence:

- The user's sandbox served the new build. Dashboard: split button with a visible divider; menu showed Default (checked) and Max effort with descriptions; choosing Max effort relabelled the button "Find jobs with max effort" with the rocket icon; the main button opened the warning dialog; Cancel closed it. Jobs page: the same control, back on Default after navigation. The profile's run list was unchanged afterwards.

Reviewer findings:

- No separate reviewer pass: a UI composition change covered by 9 component tests, page tests and a browser check.

Same-failure search:

- `grep -rn "startDiscovery" src/ui` lists only the two pages, both now through `FindJobsButton`.

Sensitive data gate:

- No data involved; tests use invented ids (`pf1`). No durable artifact holds personal data.

Artifact maintenance gate:

- `AGENTS.md`: shadcn note extended (overwrite prompt on `add` when a registry dependency exists).
- Runtime project skills: unaffected; `project-testing` already covers Radix portals and menus (`ThemeMenu` pattern).
- Specs: `product-v1.md` Dashboard/Jobs control text updated.
- End-user/operator docs: README Max-effort section updated.
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/`.

Spec update: see above.

Project skill update: none needed, reason above.

## Outcome

- One "Find jobs" split button on the Dashboard and Jobs page; the arrow picks Default or Max effort, the main button runs it, Max still asks first, and every page load starts on Default.

## Lessons Extracted

- `shadcn add` for a component with installed registry dependencies stops at an overwrite prompt; recorded in AGENTS.md.

## Followup

- None. The Vite chunk-size warning predates this SOW and stays reported to the user (SOW-0016 follow-up mapping).

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
