# SOW-0010 - Rebuild the UI on shadcn/ui

## Status

Status: completed

Sub-state: shipped; every screen runs on shadcn/ui with sheet, confirmations and theme menu.

## Requirements

### Purpose

Replace the hand-written stylesheet and raw HTML controls with shadcn/ui components (Tailwind CSS v4 plus Radix primitives) on every screen, so the app has a consistent, accessible, themeable interface that is easier to extend.

### User Request

"I want a full refactor of the UI. Please install and use shadcn/ui all over the app." Decisions taken 2026-11-06: 1.B, 2.A, 3.A, 4.A, 5.B, 6.A, 7.A, 8.A (see Implications And Decisions).

### Assistant Understanding

Facts:

- The UI is a React 19 + Vite 8 SPA under `src/ui/` with 10 pages, 9 components and one 200-line stylesheet (`src/ui/styles.css`). There is no Tailwind, no path alias, no icon library. React and every UI-only dependency live in `devDependencies` because Vite bundles them into `dist/ui` and the npm package ships only `bin`, `dist`, `prompts` (`package.json` `files`).
- The UI tests (`test/ui/*.test.tsx`) mock `src/ui/api/client.js`, render pages inside `MemoryRouter` and drive them by accessible role and label text. They do not render `Layout`.
- Native `<select>` elements are driven with `user.selectOptions` at `test/ui/ProfilePage.test.tsx:37`, `test/ui/SettingsPage.test.tsx:57`, `test/ui/ApplicationsPage.test.tsx:51`. Adapter radios are queried by role at `test/ui/SetupPage.test.tsx:42-65`; lines 63 and 65 use `.closest('label')`.
- Settings tests locate sections by `getByRole('region', { name: 'Runs' | 'Server' })` and assert "Saved" or the alert inside that section (`test/ui/SettingsPage.test.tsx:58-84`).
- Dashboard tests read counts through `data-testid="count-*"` (`test/ui/DashboardPage.test.tsx:38-40`).
- Baseline before this SOW: `npm test` 45 files, 318 tests passed; `npm run typecheck` clean.
- Design document section 11 leaves the CSS approach to the builder "as long as it is dependency-light and ships in the bundle" (`docs/superpowers/specs/2026-11-05-job-applications-tracker-design.md:246`). Section 3 declares desktop browser only (line 33).
- Registry versions checked 2026-11-06: shadcn CLI 4.23.0, tailwindcss 4.3.5, `@tailwindcss/vite` 4.3.5 (peer `vite ^5.2 || ^6 || ^7 || ^8`), `radix-ui` 1.8.1 (peer react ^19), lucide-react 1.70.0.

Inferences:

- Tailwind plus Radix is heavier than "dependency-light"; the user accepted this on 2026-11-06 by asking for shadcn. Recorded here as the deviation from the design document.
- Because tests never render `Layout`, the sidebar, theme switcher and `matchMedia` usage stay out of jsdom.

Unknowns:

- None blocking. Whether `shadcn init` detects the Vite root at `src/ui` is checked during chunk 1; the fallback is a hand-written `components.json`.

### Acceptance Criteria

- Every screen (Dashboard, Jobs, Applications, Application detail, Review, Runs, Run, Settings, Setup, Profile) and the shell render only shadcn components or Tailwind utility classes; `src/ui/styles.css` contains only the Tailwind import, theme tokens and base layer. Verified by reading each file and `grep -L` for `className="` of legacy class names.
- Add application opens in a `Sheet`; Purge run logs and Dismiss job ask for confirmation in an `AlertDialog`; the sidebar offers Light, Dark and System themes persisted in `localStorage`. Verified by UI tests and a manual run of the built app.
- All existing UI test behaviours still pass, with test edits limited to the DOM-structure changes listed under Decisions (radio label lookup, sheet opening, confirmation step). `npm test` and `npm run typecheck` pass with no `act(...)` warnings.
- `npm run build` succeeds and the built app serves and navigates at `127.0.0.1` with the new UI. `dist/ui` size before and after is recorded.
- shadcn and Tailwind packages are `devDependencies`; `dependencies` is unchanged.

## Analysis

Sources checked:

- `src/ui/**` (all files), `test/ui/**`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `tsup.config.ts`, `package.json`, `src/server/app.ts:82-92` (static serving), `README.md`.
- `docs/superpowers/specs/2026-11-05-job-applications-tracker-design.md` sections 3, 6, 10, 11.
- `.agents/sow/specs/product-v1.md`, `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` (UI items), `.agents/skills/project-testing/SKILL.md`.
- shadcn registry items `native-select`, `field`, `sidebar` read with `npx shadcn@4.23.0 view <name>`.

Current state:

- Controls are raw `button`, `input`, `select`, `textarea`, `table`, styled globally in `src/ui/styles.css:71-124`. Status badges use hard-coded colours (`styles.css:160-174`).
- Feedback is inline: `<p role="status">Saved</p>` and `<p role="alert">` in every page and in `SettingsSection.tsx:41-42`.
- Loading states are the text "Loading..." (every page); error states are a bare paragraph.
- `Layout.tsx` renders a fixed 220px nav with a red count badge for Review.

Risks:

- Radix overlays (`Sheet`, `AlertDialog`) in jsdom: Radix sets `pointer-events: none` on `body` while open, and `user-event` refuses clicks on elements that inherit it. Elements inside the overlay are clickable; tests that click outside while an overlay is open must close it first.
- `Sidebar` pulls `Sheet`, `Tooltip`, `Skeleton` and a `use-mobile` hook that reads `window.matchMedia`; it is only rendered by `Layout`, which tests do not mount.
- Tailwind v4 targets Safari 16.4+, Chrome 111+, Firefox 128+. Acceptable for a desktop local tool; recorded in README.
- Bundle size of `dist/ui` grows; measured in Validation.
- SOW-0005 lists small Jobs/Detail UI items (hide Dismiss on dismissed rows, list on load failure, disable Save in flight, heading refresh). They stay in SOW-0005; this SOW keeps behaviour unchanged except the approved UX changes.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The UI was built in SOW-0001 as the minimum needed to exercise the API: one stylesheet, raw controls, no design system. The user wants a product-grade interface built on shadcn/ui. No defect is being fixed; this is a planned rebuild of the presentation layer with three approved UX changes.

Evidence reviewed:

- Listed under Analysis. No open-source mirrors were consulted; the only external inputs are the shadcn registry (read-only `view`) and npm registry metadata.

Affected contracts and surfaces:

- Build: `package.json` devDependencies and scripts unchanged in name; `vite.config.ts` gains the Tailwind plugin and `@` alias; `vitest.config.ts` UI project gains the same alias; `tsconfig.ui.json` gains `baseUrl`/`paths`; new `components.json`.
- UI source: every file under `src/ui/` except `api/client.ts` and `format.ts`; new `src/ui/components/ui/*`, `src/ui/lib/utils.ts`, `src/ui/hooks/use-mobile.ts`, `src/ui/theme.ts`; `src/ui/index.html` gains the pre-paint theme script.
- Tests: `test/ui/SetupPage.test.tsx` (radio label lookup), `test/ui/ApplicationsPage.test.tsx` (open sheet before typing), `test/ui/SettingsPage.test.tsx` (confirm purge), `test/ui/JobsPage.test.tsx` (confirm dismiss), new `test/ui/theme.test.ts`.
- Specs: `.agents/sow/specs/product-v1.md` UI section (sheet, confirmations, theme, browser floor). Docs: `README.md` (theme, browser support, dev notes). Design document: deviation recorded here, not edited (it is the approved historical design).
- Skills: `.agents/skills/project-testing/SKILL.md` gains the Radix-overlay testing rule.

Existing patterns to reuse:

- `AdapterChooser`, `SettingsSection`, `StatusSelect`, `TagInput`, `VerificationBadge`, `LogView` keep their props and names; only their rendering changes.
- The `active` flag cleanup pattern in every `useEffect` stays as is.
- `STATUS_LABELS` in `JobsPage.tsx:17-26` becomes a shared `src/ui/labels.ts` used by Jobs, Applications and Review badges.
- Test conventions from `.agents/skills/project-testing/SKILL.md`: `vi.mock` of the client, `MemoryRouter`, `afterEach(cleanup)`, `userEvent`.

Risk and blast radius:

- Presentation only; no API, schema, prompt or server change. Regression risk is confined to the browser UI and its tests.
- Three behaviour changes (sheet, two confirmations) alter the click paths users and tests take; all are listed and tested.
- Performance: more CSS and JS in `dist/ui`; measured. No runtime server cost.
- Security: no new network calls (system fonts, no CDN). `rel="noopener noreferrer"` on external links preserved. URL scheme guards (`isHttp`) preserved.
- Data: none.

Sensitive data handling plan:

- No secrets or personal data are involved. Tests keep invented companies (`Acme`, `Beta`), `example.com` addresses and `msg-*` ids. No real run logs are pasted anywhere.

Implementation plan:

1. Toolchain: add Tailwind v4 via `@tailwindcss/vite`, `@` alias (`src/ui`) in `tsconfig.ui.json`, `vite.config.ts`, `vitest.config.ts`; run `shadcn init` (Vite, radix base, zinc, css variables) and fix `components.json` for the `src/ui` root; move added packages to `devDependencies`; rewrite `styles.css` to the Tailwind import plus tokens with a system font stack. Verify `npm run build`, `npm test`, `npm run typecheck` still pass with the old pages untouched.
2. Add components: button, badge, card, input, textarea, label, field, native-select, radio-group, checkbox, table, alert, alert-dialog, sheet, sidebar (brings separator, tooltip, skeleton, sheet, input), skeleton, separator, dropdown-menu, empty. Add `success` and `warning` badge variants.
3. Shell: `Layout` on `SidebarProvider` + `Sidebar` (collapsible none) with lucide icons, Review count via `SidebarMenuBadge`, theme menu in `SidebarFooter`; `theme.ts` (`light | dark | system`, localStorage key `theme`, applies the `dark` class, follows `matchMedia` in system mode); pre-paint script in `index.html`.
4. Shared pieces: `PageHeader`, `LoadingState` (Skeleton), `ErrorAlert`/`StatusAlert` wrappers keeping `role="alert"`/`role="status"`, `labels.ts`, `StatusBadge`, `VerificationBadge`, `TagInput` (Badge chips with icon button), `StatusSelect` (NativeSelect), `AdapterChooser` (RadioGroup + Field), `SettingsSection` (Card form), `LogView`, `DataSection` (AlertDialog before purge), `AddApplicationForm` (Field layout; submit button "Add").
5. Pages in order with their tests kept green after each: Setup, Profile, Settings, Dashboard, Jobs (AlertDialog before Dismiss), Applications (Sheet trigger "Add application"), Application detail, Review, Runs, Run.
6. Tests: adjust the four files named above; add `theme.test.ts`; run the whole suite and typecheck; check for `act(...)` warnings.
7. Validation and artifacts: `npm run build`, run `node bin/jobtrack.js --no-open --port 0 --data-dir .tmp/dev` and walk every screen in a browser; record `dist/ui` sizes; update spec, README, project-testing skill; close the SOW.

Validation plan:

- Per-page: `npx vitest run test/ui/<Page>.test.tsx` after each rewrite.
- Whole: `npm test`, `npm run typecheck`, `npm run build`; summary lines pasted here.
- Real use: built app served from `dist/ui`, every route visited, sheet and both confirmations exercised, theme switched and reloaded.
- Review: an independent reviewer pass on the diff before commit; findings recorded below.
- Same-failure search: `grep -rn "className=\"" src/ui` for legacy class names; `grep -rn "<button\|<input\|<select\|<textarea" src/ui --include=*.tsx` outside `components/ui`.

Artifact impact plan:

- AGENTS.md: add `src/ui/components/ui` ownership note and the "shadcn deps are devDependencies" override. Project skills index gains the testing-skill update.
- Runtime project skills: `project-testing` gains the Radix overlay rule and the alias note.
- Specs: `product-v1.md` UI section updated for sheet, confirmations, theme and browser floor.
- End-user/operator docs: README gains theme and browser-support notes; dev section mentions `npx shadcn add`.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: single SOW; SOW-0005 UI items remain there; design-document deviation recorded here.

Open-source reference evidence:

- None. Only the shadcn registry (read-only) and npm metadata were consulted; no mirrored repositories.

Open decisions:

- All resolved; see Implications And Decisions.

## Implications And Decisions

Recorded 2026-11-06 from the user's reply "1.B, 2.A, 3.A, 4.A, 5.B, 6.A, 7.A, 8.A".

1. Scope: B. Visual refactor plus UX changes: Add application in a `Sheet`; `AlertDialog` confirmation before "Purge run logs" and before "Dismiss"; no toasts (see 7).
2. App shell: A. shadcn `Sidebar` component.
3. Select controls: A. `NativeSelect` (styled real `<select>`); tests keep `selectOptions`.
4. Adapter radios: A. Radix `RadioGroup`; `test/ui/SetupPage.test.tsx:63,65` rewritten to read the radio's label text.
5. Theme: B. Follow the OS preference with Light/Dark/System in the sidebar footer, remembered in `localStorage`.
6. Fonts: A. System font stack; no network fonts.
7. Feedback: A. Inline `Alert` keeping `role="status"`/`role="alert"` in place.
8. Base palette: A. zinc.

Assistant calls stated to the user and not objected to:

- `@/` alias maps to `src/ui`; shadcn components under `src/ui/components/ui`.
- All shadcn and Tailwind packages in `devDependencies`.
- Tailwind v4 through the Vite plugin; Radix as primitive base.
- Badge gains `success` and `warning` variants.
- Accessibility contracts unchanged (named regions, `role=alert`, `role=status`, labels).
- Sheet trigger is named "Add application"; the submit inside the sheet is named "Add" so the two buttons have distinct accessible names.
- Theme menu is a `DropdownMenu` with Light, Dark, System; default System.

## Plan

See Implementation plan in the gate.

## Execution Log

### 2026-11-06

- SOW created with decisions; implementation starting at chunk 1.
- Chunk 1: Tailwind 4.3.5 via `@tailwindcss/vite`; `@` alias in `vite.config.ts`, `vitest.config.ts` (UI project) and `tsconfig.ui.json` (`paths`, plus `DOM.Iterable` lib for Radix types). `components.json` hand-written (new-york, zinc, lucide, css variables). Theme tokens taken verbatim from the shadcn registry item `colors/zinc` (`cssVarsV4`), plus app `success`/`warning` tokens; system font stack. Toolchain checkpoint: build, typecheck and 318/318 tests green with old pages.
- Chunk 2 deviation found and handled: `npx shadcn@4.23.0 add` could not resolve the `@/` alias (it reads the root `tsconfig.json`) and wrote 21 files under a literal `./@/` folder; it also installed an unrelated npm package named `cn` as a runtime dependency for the registry's `cn` placeholder import. Files moved to `src/ui/components/ui/` and `src/ui/hooks/`, imports rewritten to `@/lib/utils`, `cn` uninstalled. Recorded as a hazard in `AGENTS.md`. Badge gained `success` and `warning` variants.
- Chunk 3: `src/ui/theme.ts` (light/dark/system, `localStorage` key `theme`, storage errors tolerated, live OS following in system mode), pre-paint script in `src/ui/index.html`, `ThemeMenu` dropdown, `Layout` on shadcn `Sidebar` (`collapsible="none"`, desktop only).
- Chunk 4: shared `feedback.tsx` (ErrorAlert keeps `role="alert"`, SuccessMessage `role="status"`, LoadingState skeleton), `PageHeader`, `StatusBadge`, `labels.ts`; `TagInput`, `StatusSelect`, `AdapterChooser` (radio inside its label, choice-card layout, so existing `.closest('label')` assertions still hold), `SettingsSection` (Card with `role="region"`), `DataSection` (AlertDialog), `AddApplicationForm` (submit renamed "Add"), `LogView`.
- Chunk 5: all ten pages rewritten. Radix radio needs `ResizeObserver`; stubbed in `test/ui/setup.ts`.
- Chunk 6: test edits limited to the planned ones: purge confirm plus cancel test (Settings), open the sheet before typing and assert it closes (Applications), new dismiss confirm and cancel tests (Jobs), new `test/ui/theme.test.ts` (5 tests). Setup tests needed no change.
- Chunk 7 real-use walk found one defect: the Review count badge text turned dark on red when Review was the active or hovered item (sidebar active colour won). Fixed in `Layout.tsx` by pinning white text for those states; re-checked in the browser.
- Review fixes (independent reviewer, see Validation): removed the vendored sidebar's `sidebar_state` cookie and Cmd/Ctrl+B shortcut (marked local changes in `src/ui/components/ui/sidebar.tsx`); guarded `matchMedia` in `src/ui/hooks/use-mobile.ts` and the `index.html` pre-paint script; Dashboard stat links named "<label>: <value>"; Review nav link name carries the pending count; root `tsconfig.json` gained the `@/*` path so `shadcn add` writes to `src/ui/components/ui/`; new `test/ui/Layout.test.tsx` (3 tests).

## Validation

Acceptance criteria evidence:

- Every screen and the shell use shadcn components: `src/ui/pages/*.tsx` and `src/ui/components/*.tsx` rewritten; scan `grep -rn -E "<(button|input|select|textarea|table)[ >]" src/ui --include='*.tsx' | grep -v src/ui/components/ui/` returns nothing; legacy class-name scan returns nothing; `src/ui/styles.css` holds only the Tailwind imports, tokens and base layer.
- Sheet, both confirmations and the theme menu exist and are tested: `test/ui/ApplicationsPage.test.tsx` (sheet open, add, closes), `test/ui/SettingsPage.test.tsx` (purge confirm and cancel), `test/ui/JobsPage.test.tsx` (dismiss confirm and cancel), `test/ui/Layout.test.tsx` and `test/ui/theme.test.ts` (theme).
- Test edits were limited to the planned ones; Setup tests passed unchanged.
- `dependencies` unchanged (`@hono/node-server`, `better-sqlite3`, `hono`, `open`, `zod`); all new packages are `devDependencies`. `npm pack --dry-run`: 10 files, 183.5 kB, UI only under `dist/ui`.
- Bundle size of `dist/ui` (gzip): JS 88 kB before, 146 kB after; CSS 1 kB before, 11 kB after; `dist/ui` on disk 288 kB before, 536 kB after.

Tests or equivalent validation:

- Baseline before changes: `Test Files 45 passed (45)`, `Tests 318 passed (318)`.
- Final: `npm test` reports `Test Files 47 passed (47)`, `Tests 329 passed (329)`, no `act(...)` or other warnings in the output (grep for warn/stderr empty). Includes `test/e2e/discovery-flow.test.ts`.
- `npm run typecheck` clean. `npm run build` succeeds (no warnings).

Real-use evidence:

- Built app (`node bin/jobtrack.js --no-open --port 0 --data-dir .tmp/dev`) seeded with invented rows (companies Acme, Globex, Initrode, Umbrella, Hooli at `.example` domains, message id `msg-001`). Visited Dashboard, Jobs, Applications, Application detail, Review, Runs, Run (failed sync with the no-Gmail follow-up), Settings, Profile and Setup in Chrome, in light and dark. Opened the dismiss confirmation and the add sheet; switched to Dark from the sidebar menu and confirmed it survived full page loads. One defect found and fixed (Review badge contrast, see Execution Log). Server stopped by its recorded PID.

Reviewer findings:

- Independent reviewer (general-purpose subagent) on the full diff: no high-severity issue; confirmed URL guards, `rel` attributes, handlers, disabled states, effect cleanups, label/id pairs, roles and devDependency placement.
- Fixed: (1) sidebar Cmd/Ctrl+B handler swallowed the browser shortcut and wrote a `sidebar_state` cookie that would ride on every API request; (2) unguarded `matchMedia` in `use-mobile.ts`, and missing Layout/theme-menu coverage; (3) Dashboard stat links were named only by the number; (4) Review link lost the pending count from its name; (7) `shadcn add` wrote to a literal `@/` folder, verified with `--dry-run` before and after adding root `paths`; (8) pre-paint script lacked the `matchMedia` guard; (9) theme is per-origin, so per-port: noted in README.
- Tracked in SOW-0005: (5) focus lands on `body` after a confirm; (6) closing the sheet discards a draft.
- Rejected: (10) radio inside a `<label>` wrapping a `div` is the official shadcn choice-card pattern, works in browsers and tests, and gives each card a single click target.

Same-failure scan:

- Raw-control and legacy-class scans above: none left.
- `grep -rn "document.cookie\|addEventListener(\"keydown\"" src/ui` after the fix: no cookie writes or global key handlers remain.
- `grep -rn "matchMedia" src/ui`: every call is guarded (`theme.ts`, `use-mobile.ts`, `index.html`).

Sensitive data gate:

- No secrets, credentials or personal data in any changed file. Tests and the SOW use invented companies, `example.com`/`.example` addresses and `msg-*` ids. No run logs copied. Real-use screenshots were not saved to disk.

Artifact maintenance gate:

- AGENTS.md: updated (shadcn ownership rule, devDependency rule, `shadcn add` fix-up steps and the marked local changes; testing skill index line).
- Runtime project skills: `.agents/skills/project-testing/SKILL.md` gained Radix portal/confirmation testing, the `ResizeObserver` stub, the native-select rule and the alias note.
- Specs: `.agents/sow/specs/product-v1.md` gained a User interface section.
- End-user/operator docs: `README.md` gained an Interface section (theme, confirmations, browser floor) and shadcn development notes.
- End-user/operator skills: none exist (`AGENTS.md`: "Output/reference skills: none").
- SOW lifecycle: status `completed`, file moved to `.agents/sow/done/` in the same commit as the work. Follow-ups added to `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md`.

Specs update:

- `.agents/sow/specs/product-v1.md` User interface section.

Project skills update:

- `.agents/skills/project-testing/SKILL.md` as above.

End-user/operator docs update:

- `README.md` Interface and Development sections.

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- See Lessons Extracted.

Follow-up mapping:

- Implemented: reviewer items 1, 2, 3, 4, 7, 8, 9.
- Tracked in SOW-0005: reviewer items 5 and 6, status option labels, duplicate Installed text, unused `Job` import in `client.ts`.
- Rejected with reason: reviewer item 10.
- Design-document deviation (Tailwind plus Radix is not "dependency-light", section 11) accepted by the user's request on 2026-11-06 and recorded here; the historical design document is not edited.

## Outcome

The UI runs entirely on shadcn/ui with Tailwind v4 and Radix. It has a fixed sidebar with icons and the review count, and a Light/Dark/System theme. Data screens use tables and cards with designed loading, empty and error states. Add application lives in a side sheet, and Purge run logs and Dismiss ask for confirmation. Behaviour, API calls and test contracts are otherwise unchanged; the suite grew from 318 to 329 tests.

## Lessons Extracted

- The shadcn CLI resolves aliases from the root `tsconfig.json` only; a Vite app with its alias in a secondary tsconfig gets files written to `./@/`. Recorded in `AGENTS.md`.
- shadcn CLI 4.23 registry items import `cn` from a placeholder module named `cn` and list it as an npm dependency; the CLI installs that unrelated package. Always diff `package.json` after `shadcn add`. Recorded in `AGENTS.md`.
- Vendored shadcn components carry app-wide side effects (cookies, global keyboard shortcuts). Review vendored files, not only our own. Recorded as marked local changes plus the `AGENTS.md` note.
- Radix portals and confirmations change click paths in tests; scope queries to the dialog and add Cancel tests. Recorded in the project-testing skill.

## Followup

- Tracked in `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` (five items listed under Follow-up mapping).

## Regression Log

None yet.
