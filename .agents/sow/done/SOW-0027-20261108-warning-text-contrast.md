# SOW-0027 - Readable amber warning text in light mode

## Status

Status: completed

Sub-state: delivered; decisions 1-3 implemented and validated.

## Requirements

### Purpose

Make amber warning text meet WCAG AA contrast (4.5:1) in light mode. Found by the SOW-0026 review and tracked in SOW-0005.

### User Request

- 2026-11-08: "Fix the amber text contrast issue."
- 2026-11-08: all three recommended options (see Implications And Decisions).

### Assistant Understanding

Facts:

- Only two places colour text with `--warning` (`grep` for `(text|border|bg|fill|stroke|ring)-warning` in `src/ui`, outside `components/ui/badge.tsx`):
  - `src/ui/components/AgentModelFields.tsx:96`: effort warnings under the model fields in Settings (`FieldDescription className="text-warning"`).
  - `src/ui/components/LogView.tsx:38`: `TONES.warning` for warning rows in the readable run log, small text on `bg-muted/40`.
- Light-mode `--warning` `oklch(0.666 0.179 58.318)` measures 3.19:1 on white and 3.07:1 on `bg-muted/40` over white (alpha blended in sRGB).
- Dark-mode `--warning` `oklch(0.769 0.165 70.08)` measures 9.27:1 on the background, 8.50:1 on `bg-muted/40` and 8.27:1 on cards; dark mode needs no change.
- The `warning` badge (`badge.tsx`) uses `--warning` as a background with dark text since SOW-0026 (6.23:1); darkening `--warning` would drop that to about 3.6:1.

Inferences:

- A separate text colour is needed because one amber cannot be both a light badge background and dark text on white.

Unknowns:

- None.

### Acceptance Criteria

- Light-mode amber text measures at least 4.5:1 on white and on `bg-muted/40` (computed; built-app check of the token value).
- Dark-mode amber text keeps today's colour.
- Warning badges are unchanged.
- Both usages use the new colour (UI tests assert the class on the Settings effort warning and on a warning row in the run log).
- `npm run typecheck`, `npm test`, `npm run build` pass.

## Analysis

Sources checked:

- `src/ui/styles.css`, `src/ui/components/AgentModelFields.tsx`, `src/ui/components/LogView.tsx`, `src/ui/components/ui/badge.tsx`, `src/ui/log-format.ts:266`.
- `test/ui/SettingsPage.test.tsx:116-131`, `test/ui/RunPage.test.tsx:248-300`, `test/ui/log-format.test.ts:49-62`.
- SOW-0026 (review finding), SOW-0005 (backlog item).

Current state:

- One token, `--warning`, serves badge backgrounds and text.

Risks:

- jsdom does not compute colours, so tests can only prove the class; the contrast itself is proven by computation and the built-app token check.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- `--warning` was tuned as a badge background; using it as text colour on light surfaces gives about 3:1. Evidence: contrast measurements above.

Evidence reviewed:

- Files and measurements listed above. No external open-source repositories were relevant; Tailwind's amber-700 was used only as a reference shade.

Affected contracts and surfaces:

- UI tokens in `src/ui/styles.css` (new `--warning-text`, `--color-warning-text`).
- `AgentModelFields.tsx`, `LogView.tsx`.
- Tests: `test/ui/SettingsPage.test.tsx`, `test/ui/RunPage.test.tsx`.
- Spec: `.agents/sow/specs/product-v1.md` branding bullet.
- SOW-0005 backlog item.

Existing patterns to reuse:

- Token pairs in `:root` and `.dark` with `@theme inline` mapping, as for `--success` and `--warning`.
- `FieldDescription` and `TONES` stay; only the class changes.

Risk and blast radius:

- Two text usages change colour in light mode only. No layout, logic or API change.

Sensitive data handling plan:

- No user data involved; test log lines are invented.

Implementation plan:

1. Tests first: assert `text-warning-text` on the Ultra effort warning and on a `Worker N (...) failed:` row in the readable run log.
2. Add `--warning-text` (light `oklch(0.555 0.163 49)`, dark equal to `--warning`) and `--color-warning-text`.
3. Switch both usages to `text-warning-text`.
4. Update spec and SOW-0005.

Validation plan:

- New assertions fail first, then pass; full `npm test`, `npm run typecheck`, `npm run build`.
- Built app: computed `--warning-text` in light and dark.
- Same-failure scan: grep for any other `text-warning` use.

Artifact impact plan:

- AGENTS.md: no update; no workflow or guardrail change.
- Runtime project skills: no update expected.
- Specs: branding bullet in `product-v1.md` mentions the text colour.
- End-user/operator docs: README has no colour or theme content.
- End-user/operator skills: none exist.
- SOW lifecycle: SOW-0005 item marked done in SOW-0027; this SOW closes in `done/` with the work in one commit on PR #18.

Open-source reference evidence:

- None; no external repository was consulted.

Open decisions:

- None; decisions 1-3 resolved below.

## Implications And Decisions

1. Approach: **A, a text-only token `--warning-text`** (darker in light mode, equal to `--warning` in dark mode). Rejected: darkening `--warning` (breaks the badge's dark text, about 3.6:1); Tailwind palette classes in place (bypass the theme).
2. Shade: **A, `oklch(0.555 0.163 49)`** (about Tailwind amber-700): AA on white and on `bg-muted/40`, still reads as amber. Rejected: `oklch(0.473 0.137 46)` (AAA, reads brown).
3. Delivery: **A, a separate commit on PR #18**, pushed after the current CI run is recorded.

## Plan

See the implementation plan in the gate.

## Execution Log

### 2026-11-08

- Decisions recorded.
- Tests first: `test/ui/SettingsPage.test.tsx` asserts `text-warning-text` on the Ultra effort warning; new `test/ui/RunPage.test.tsx` case asserts it on a `Worker 2 (Lever) failed:` row and not on the `started` row. Both failed before the change.
- `src/ui/styles.css`: `--warning-text` in `:root` (`oklch(0.555 0.163 49)`) and `.dark` (`oklch(0.769 0.165 70.08)`), mapped as `--color-warning-text`.
- `AgentModelFields.tsx` and `LogView.tsx` switched to `text-warning-text`.
- Deviation caught during validation: the first edit of the light value did not apply (ambiguous match), yet the class-only tests passed. The built CSS showed only the dark value; the light value was added and the built CSS and browser check then confirmed both. This is the jsdom limit noted under Risks.

## Validation

Acceptance criteria evidence:

- Light mode: `oklch(0.555 0.163 49)` measures 5.05:1 on white and 4.86:1 on `bg-muted/40` (was 3.19:1 and 3.07:1).
- Dark mode: unchanged colour (`oklch(0.769 0.165 70.08)`, 8.3-9.3:1).
- Built app (`node bin/jobtrack.js --no-open --port 0 --data-dir .tmp/dev`, Settings page, Chrome): an element with `text-warning-text` computes to `oklch(0.555 0.163 49)` in light mode and `oklch(0.769 0.165 70.08)` with `.dark`. Built CSS contains both `--warning-text` values.
- Warning badges unchanged: `badge.tsx` still uses `bg-warning text-warning-foreground`; `--warning` values untouched.

Tests or equivalent validation:

- `npm run typecheck`: clean.
- `npm test`: `Test Files  65 passed (65)`, `Tests  856 passed (856)`.
- `npm run build`: succeeds.

Real-use evidence:

- Browser check above; the app process was stopped by its own PID.

Reviewer findings:

- No separate reviewer: a two-class, one-token change following the decided design; the deviation found during validation is recorded in the Execution Log.

Same-failure scan:

- `grep -rnE "text-warning([^-]|$)" src/ui`: no remaining uses of `--warning` as text colour.

Sensitive data gate:

- No user data; the test log lines are invented.

Artifact maintenance gate:

- AGENTS.md: no update; no workflow or guardrail change.
- Runtime project skills: no update; the class-only limit of jsdom is a known testing fact, recorded here, and the new tests follow existing patterns.
- Specs: `.agents/sow/specs/product-v1.md` branding bullet describes `--warning-text`.
- End-user/operator docs: README has no colour or theme content.
- End-user/operator skills: none exist.
- SOW lifecycle: SOW-0005 item marked done in SOW-0027; this SOW completed and moved to `done/` in the same commit as the work.

Specs update:

- See artifact maintenance gate.

Project skills update:

- See artifact maintenance gate.

End-user/operator docs update:

- See artifact maintenance gate.

End-user/operator skills update:

- See artifact maintenance gate.

Lessons:

- Tests that assert a class cannot prove a colour exists; check the built CSS for every token value a styling change adds.

Follow-up mapping:

- None open.

## Outcome

Amber warning text is readable in light mode (about 5:1) through a text-only `--warning-text` colour; dark mode and warning badges are unchanged.

## Lessons Extracted

- For token changes, verify each added value in the built CSS; jsdom tests only see class names.

## Followup

None.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
