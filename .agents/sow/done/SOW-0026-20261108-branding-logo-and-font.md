# SOW-0026 - Branding: Lens logo, Manrope font, favicon

## Status

Status: completed

Sub-state: delivered; decisions 1-6 implemented and validated.

## Requirements

### Purpose

Give the app its own identity so it looks less like a default shadcn/ui app. GitHub issue #14 ("Branding": "Create logo and branding. Experiment with colors").

### User Request

- 2026-11-08: explore logos and colour palettes and differentiate a bit from default shadcn style.
- 2026-11-08, picks from the branding board: Logo "Lens", Palette "Current (zinc)", Type "Manrope", Corners "Current", Wordmark "Job Tracker".
- 2026-11-08: all five recommended options for the follow-up decisions (see Implications And Decisions).

### Assistant Understanding

Facts:

- The sidebar header on the profiles screen shows a lucide `BriefcaseIcon` in a `bg-primary` tile next to "Job Tracker" (`src/ui/components/Layout.tsx:203-207`). Inside a profile the header is the back link instead.
- `BriefcaseIcon` is also the Jobs nav icon (`Layout.tsx:47`) and a Dashboard card icon (`src/ui/pages/DashboardPage.tsx:162`); those stay.
- The UI font is the system stack (`src/ui/styles.css:75`). The UI uses weights 400, 500 and 600 (`font-normal`, `font-medium`, `font-semibold` in `src/ui`).
- `src/ui/index.html` has no favicon.
- The server serves any file under `dist/ui` (`src/server/app.ts:92`); Hono's MIME table maps `svg` to `image/svg+xml` and `woff2` to `font/woff2` (`node_modules/hono/dist/utils/mime.js`).
- Light-mode `--warning-foreground` is white on `--warning` `oklch(0.666 0.179 58.318)` (`src/ui/styles.css:37-38`): 3.06:1, below WCAG AA 4.5:1. The dark text already used in dark mode, `oklch(0.141 0.005 285.823)`, gives 6.23:1. The approved board preview showed dark text on amber.
- `@fontsource-variable/manrope` 5.3.0 ships one variable woff2 per subset (latin, latin-ext, cyrillic, cyrillic-ext, greek, vietnamese) with `font-family: 'Manrope Variable'`, weights 200-800, `unicode-range` per subset, licensed under the SIL Open Font License 1.1.
- The tarball ships only `dist` and `bin`; UI-only packages are devDependencies (`AGENTS.md`, project-specific overrides).

Inferences:

- Browsers fetch only the subsets a page needs, so a page in English loads the latin file only; the package carries all six.

Unknowns:

- None.

### Acceptance Criteria

- The profiles-screen sidebar header shows the Lens mark in the `bg-primary` tile next to "Job Tracker" (UI test in `test/ui/Layout.test.tsx`; visual check in the built app, light and dark).
- The UI renders in Manrope from the bundled font, with no request to an external host (build output lists the woff2 files under `dist/ui/assets`; network check in the running app).
- The browser tab shows the Lens favicon (`index.html` link; built app check).
- Light-mode warning badges use dark text (token in `src/ui/styles.css`).
- `@fontsource-variable/manrope` is a devDependency, not a dependency (`package.json`).
- `npm run typecheck`, `npm test` and `npm run build` pass.

## Analysis

Sources checked:

- `src/ui/components/Layout.tsx`, `src/ui/styles.css`, `src/ui/index.html`, `src/ui/main.tsx`, `src/ui/labels.ts`, `src/ui/components/ui/badge.tsx`, `src/server/app.ts`, `vite.config.ts`.
- `test/ui/Layout.test.tsx`, `.agents/sow/specs/product-v1.md:106`, `README.md` (no branding content), `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` (no overlap).
- Branding board artifact (private, scratch): six marks and seven palettes previewed in a mock of the Jobs page; contrast computed with an oklch-to-sRGB script.

Current state:

- Stock shadcn zinc theme, system font, lucide briefcase as the app mark, no favicon.

Risks:

- Manrope is wider than the system font, so truncated texts (sidebar profile name, table cells) cut earlier. Visual check in the built app.
- With the zinc palette and the current radius the app still reads as shadcn; only the font and the mark change. Accepted by the user's picks.
- The Open Font License asks that copies of the font carry its copyright and licence; the woff2 files are bundled into `dist/ui/assets` without the licence text. Raised with the user in the close-out report.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The app uses shadcn defaults throughout (zinc tokens, system font, a lucide icon as the logo), so it has no identity of its own. Evidence: `src/ui/styles.css:6-73`, `Layout.tsx:203-207`.

Evidence reviewed:

- Files listed under Analysis. No external open-source repositories were consulted; the font package was inspected in `node_modules/@fontsource-variable/manrope` (`index.css`, `LICENSE`, `files/`).

Affected contracts and surfaces:

- UI: sidebar header mark, global font, favicon, light-mode warning badge text.
- Build: new devDependency bundled by Vite into `dist/ui/assets`.
- Tests: `test/ui/Layout.test.tsx`.
- Spec: `.agents/sow/specs/product-v1.md:106` (sidebar header).
- `AGENTS.md`: the list of UI-only devDependency packages.
- No API, schema, server or CLI change.

Existing patterns to reuse:

- The tile markup in `Layout.tsx:204-206` (`bg-primary text-primary-foreground`), keeping the tile theme-aware (decision 5).
- Inline SVG component style as in `src/ui/components/CvIllustration.tsx` (`aria-hidden`, `currentColor`).
- Theme tokens in `src/ui/styles.css`; `--font-sans` in `@theme inline`.

Risk and blast radius:

- Font change affects every screen's text metrics; no logic change. Tests run in jsdom without layout, so only the visual check covers truncation.
- Token change affects every `warning` badge (run status "aborted", verification "Could not verify") in light mode only.
- Tarball grows by the six woff2 files (package unpacked size about 97 KB including CSS and metadata).

Sensitive data handling plan:

- No user data involved. Test and preview data stay invented.

Implementation plan:

1. Add `@fontsource-variable/manrope` as a devDependency; import it in `src/ui/main.tsx`; set `--font-sans` to `'Manrope Variable'` with the existing system stack as fallback.
2. Set light-mode `--warning-foreground` to `oklch(0.141 0.005 285.823)`.
3. Add `src/ui/components/LogoMark.tsx` (Lens, one colour via `currentColor`) and use it in the `Layout.tsx` header tile in place of `BriefcaseIcon`.
4. Add `src/ui/favicon.svg` (fixed `#18181b` tile, `#fafafa` mark) and link it from `src/ui/index.html`.
5. Extend `test/ui/Layout.test.tsx` to assert the mark in the profiles-screen header.
6. Update the spec and `AGENTS.md`.

Validation plan:

- `npx vitest run test/ui/Layout.test.tsx` failing first, then passing.
- `npm run typecheck`, `npm test`, `npm run build`; inspect `dist/ui` for the font files and favicon.
- Run the built app on `.tmp/dev`; check light and dark headers, favicon, Manrope in computed style, and no external font requests.

Artifact impact plan:

- AGENTS.md: add the font package to the UI-only devDependency list.
- Runtime project skills: no update expected; no workflow or test pattern changes.
- Specs: `product-v1.md` sidebar header line, plus font and favicon.
- End-user/operator docs: README has no branding or screenshots; no update expected.
- End-user/operator skills: none exist.
- SOW lifecycle: close in `done/` with the work in one commit when the user asks to commit.

Open-source reference evidence:

- None; the work uses a published npm font package only.

Open decisions:

- None; decisions 1-5 resolved below.

## Implications And Decisions

Picks from the branding board (2026-11-08): Lens logo, zinc palette (unchanged), Manrope, current corners (unchanged), wordmark "Job Tracker" (unchanged).

1. Logo colour with zinc: **A, monochrome** (as previewed). An accent would add a colour outside the palette, and a green check would echo the success badge.
2. Font delivery: **A, `@fontsource-variable/manrope` as a devDependency**. One variable file per subset covers all weights; follows the UI-only devDependency rule.
3. Favicon: **A, a single SVG favicon** linked from `index.html`. Safari support for SVG favicons is uncertain; the fallback is a generic icon.
4. Warning badge contrast: **A, fix now** with dark text in light mode (one token), matching the approved preview.
5. Logo tile in dark mode: **A, keep `bg-primary`** so the tile follows the theme; the favicon stays dark.
6. Font licence (2026-11-08, raised after implementation): the SIL Open Font License asks that copies of the font carry its copyright and licence. **A, ship the package's `LICENSE` as `src/ui/public/licenses/manrope-OFL.txt`**, which Vite copies to `dist/ui/licenses/`. Rejected: B, a root third-party notices file (needs a `files` entry; more than one font needs); C, nothing (the condition may go unmet).

## Plan

See the implementation plan in the gate.

## Execution Log

### 2026-11-08

- Branding board published for exploration; user picks and decisions recorded above.
- Added `@fontsource-variable/manrope@^5.3.0` (devDependency), imported in `src/ui/main.tsx`; `--font-sans` leads with `'Manrope Variable'`.
- Light-mode `--warning-foreground` set to `oklch(0.141 0.005 285.823)` in `src/ui/styles.css`.
- New `src/ui/components/LogoMark.tsx`; `Layout.tsx` header tile uses it (`size-5`, `data-testid="app-logo"`). `BriefcaseIcon` stays imported for the Jobs nav item.
- New `src/ui/favicon.svg`, linked from `src/ui/index.html`; Vite emits it hashed under `dist/ui/assets`.
- Test added in `test/ui/Layout.test.tsx` (failed first on the missing logo, then passed); strengthened after review to check the Lens check-stroke path and containment in the header row.
- Spec and `AGENTS.md` updated; one backlog item added to SOW-0005.
- Independent reviewer (subagent) over the full diff.

## Validation

Acceptance criteria evidence:

- Logo in the header: UI test passes; built app shows the Lens tile dark-on-light in light mode and light-on-dark in dark mode.
- Manrope bundled: build lists `manrope-*-wght-normal-*.woff2` under `dist/ui/assets` (cyrillic-ext inlined into the CSS as it is under Vite's inline limit). In the running app the body's computed `font-family` starts with `"Manrope Variable"`, the latin face is `loaded`, and `performance` resource entries contain no request outside the app's origin.
- Favicon: `dist/ui/index.html` links `/assets/favicon-<hash>.svg`; the server returns it as `image/svg+xml; charset=utf-8`. Fonts are served as `font/woff2`.
- Warning text: computed `--warning-foreground` in light mode is `oklch(14.1% .005 285.823)`; dark text on the light amber measures 6.23:1 (was 3.06:1 with white).
- `package.json` lists the font under `devDependencies`; the lockfile marks it `"dev": true`.

Tests or equivalent validation:

- `npm run typecheck`: clean.
- `npm test`: `Test Files  65 passed (65)`, `Tests  855 passed (855)`.
- `npm run build`: succeeds. Vite repeats its existing warning that the JS chunk is over 500 kB; this change adds only a small SVG component to the JS.

Real-use evidence:

- `node bin/jobtrack.js --no-open --port 0 --data-dir .tmp/dev`, opened in Chrome; checks above done on the profiles screen. The process was stopped by its own PID afterwards.

Reviewer findings:

- No significant defects.
- Test did not prove the mark itself and depended on div nesting: fixed (path check, `toContainElement`).
- Light-mode `text-warning` amber text is about 3:1 in `AgentModelFields.tsx:96` and `LogView.tsx:38`; it existed before this change and is outside the approved scope: tracked in SOW-0005.
- Font files shipped without the Open Font License text (raised by the assistant): fixed by decision 6.
- Favicon corner (`rx` 7/32) is slightly sharper than the sidebar tile's `rounded-md`: rejected, because the difference is invisible at 16 px tab size and the favicon is a fixed asset.

Same-failure scan:

- `grep -rn "warning-foreground" src/ui`: only `src/ui/components/ui/badge.tsx` (the badge `warning` variant) reads it.
- `grep -rn "BriefcaseIcon" src/ui`: remaining uses are the Jobs nav item and a Dashboard card, both intended.

Sensitive data gate:

- No user data, credentials or real names in code, tests, spec or SOW. Preview data in the board used invented companies.

Artifact maintenance gate:

- AGENTS.md: the UI-only devDependency list now names `@fontsource-variable/manrope`.
- Runtime project skills: no update; no new test pattern, harness or workflow (the new test uses the existing `Layout` test setup).
- Specs: `.agents/sow/specs/product-v1.md` user-interface section (branding bullet and sidebar header).
- End-user/operator docs: README has no screenshots, branding or font text (`grep -in "logo\|brand\|font\|screenshot" README.md` finds nothing), so no update.
- End-user/operator skills: none exist (`AGENTS.md`, "Output/reference skills: none").
- SOW lifecycle: `Status: completed`, moved to `.agents/sow/done/`, committed with the work in one commit at the user's request.

Specs update:

- See artifact maintenance gate.

Project skills update:

- See artifact maintenance gate.

End-user/operator docs update:

- See artifact maintenance gate.

End-user/operator skills update:

- See artifact maintenance gate.

Lessons:

- A branding board with a live mock of the real page let the user decide palette, type, corners and mark in one pass; the preview also surfaced the warning contrast issue before code.

Follow-up mapping:

- Light-mode amber text contrast: tracked in SOW-0005.
- Favicon corner mismatch: rejected (see reviewer findings).
- Font licence text in the package: implemented (decision 6). `src/ui/public/licenses/manrope-OFL.txt` is a copy of the package's `LICENSE`; `npm run build` copies it to `dist/ui/licenses/manrope-OFL.txt`, and `npm pack --dry-run` lists it (4.4 kB) beside the five woff2 files and the favicon.

## Outcome

The app shows the Lens mark in the sidebar header and as its favicon, renders in the bundled Manrope variable font with its Open Font License shipped beside it, and its warning badges have dark text in light mode. The zinc palette and corner radius are unchanged, as picked. Issue #14 is addressed by this change.

## Lessons Extracted

- Previewing candidates in a mock of a real page let the user pick palette, type, corners and mark at once, and surfaced the warning contrast defect before any code.
- Bundling a font is a licensing change as well as a styling one: check the font's licence terms when adding it, not after. No project skill update: this is the first bundled asset with a licence, so it is recorded here and in the spec rather than generalized.

## Followup

- Light-mode amber text contrast in `AgentModelFields.tsx` and `LogView.tsx`: tracked in SOW-0005.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
