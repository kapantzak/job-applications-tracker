# SOW-0036 - Show where rejections happen in the Dashboard funnel

## Status

Status: completed

Sub-state: delivered, reviewed, validated.

## Requirements

### Purpose

Show in the "How far applications get" funnel at which step applications were rejected, so the user can see where they get turned down.

### User Request

"In the 'How far applications get' section, add the rejected ones also." From options A (a separate Rejected row), B (a red part in each row for rejections at that step) and C (a text line under the funnel), the user chose B.

### Assistant Understanding

Facts:

- The funnel counts applications by reach, the furthest step held: `src/server/domain/dashboard.ts:79-82`. Rejected applications already count in every row they passed. `rejected` implies at least Applied (SOW-0034 rule).
- `FunnelCard` draws one blue fill per row, with width = count / Applied (`src/ui/components/dashboard/FunnelCard.tsx:43`), shows the share of the step above, and has hover-only tooltips (SOW-0034 Decision 7).
- Rejected is drawn in `--status-rejected` = `--destructive` (SOW-0035).

Inferences:

- Rejections at a step are a subset of that step's count, so the row totals and shares do not change.

Unknowns:

- None.

### Acceptance Criteria

- The summary response gains `rejected_at: { applied, screening, interview, offer }`: the number of applications whose current status is `rejected`, counted at their furthest reached step. Unit tests cover:
  - rejected straight after applying;
  - rejected after an interview;
  - created directly as rejected (counts at Applied);
  - a skipped step;
  - non-rejected applications not counted.
- Each funnel row's fill shows a red part, width rejected_at / Applied, at the end of the blue fill. The row count and share are unchanged. The row tooltip adds "; N rejected after <step>" when N > 0. Component tests check the widths and the tooltip.
- Hover-only tooltips are not a keyboard path (SOW-0034 Decision 7), so the exact counts must also be visible as text. When any application was rejected, a line under the funnel reads "Rejected after: applying 2 · screening 1", with a red swatch and only the non-zero steps. The line is hidden when there are no rejections. Component tests cover both.
- Spec and README updated. `npm run typecheck` and `npm test` pass. Checked in the browser in both themes.

## Analysis

Sources checked:

- `src/server/domain/dashboard.ts`, `src/ui/components/dashboard/FunnelCard.tsx`, `src/ui/pages/DashboardPage.tsx`, the tests next to them, the spec's Dashboard section, and the README bullet.

Current state:

- See Facts.

Risks:

- With small counts the red part is only a few pixels. The visible text line carries the exact numbers.
- The response shape grows by one field. The UI is its only consumer, and client tests use partial objects. No compatibility concern for a local app.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The funnel shows how far applications got, but not how many of them ended in rejection at each step. The summary does not compute that yet, although it already computes each application's reach.

Evidence reviewed:

- Files above. No external references needed.

Affected contracts and surfaces:

- `DashboardSummary` type and the `GET /api/profiles/:pid/dashboard` response (one new field).
- `FunnelCard` and its props; `DashboardPage` passes the new field.
- Tests: `test/server/domain/dashboard.test.ts`, `test/server/api/dashboard.test.ts` (shape), `test/ui/dashboard-cards.test.tsx`, and `test/ui/DashboardPage.test.tsx` (fixture).
- Spec Dashboard section; README Dashboard bullet.

Existing patterns to reuse:

- The reach computation in `summarizeDashboard`; `FUNNEL_STAGES`; `STATUS_COLOR_CLASS.rejected` (`bg-status-rejected`); the existing Tooltip in `FunnelCard`; the legend swatch style from `StatusBarCard`.

Risk and blast radius:

- Read-only summary plus one card. No schema, repository write or route change, so the mock sandbox seed is unaffected.

Sensitive data handling plan:

- None involved; invented data only.

Implementation plan:

1. Test first: `rejected_at` in `summarizeDashboard` (`src/server/domain/dashboard.ts`), counted from the reach that is already computed.
2. Test first: `FunnelCard` takes `rejectedAt`. In each row, the blue part (count − rejected) and the red part (rejected) sit inside the track. The tooltip gains the suffix, and the text line sits under the funnel. Step phrases: applied → "applying", screening → "screening", interview → "the interview", offer → "the offer".
3. `DashboardPage` passes `summary.rejected_at`; update the page test fixture.
4. Spec and README; typecheck; full suite; browser check in both themes; independent review.

Validation plan:

- Unit, component and page tests as above; the full suite; Chrome check on the mock sandbox (the rich profile has one application rejected after applying).

Artifact impact plan:

- AGENTS.md: unaffected (no new command or rule).
- Runtime project skills: unaffected (no route, test pattern or agent change).
- Specs: Dashboard section (funnel rejected parts, response field).
- End-user/operator docs: README Dashboard bullet.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW; completed and moved to `done/` in the same commit as the work.

Open-source reference evidence:

- None; not relevant.

Open decisions:

- None.

## Implications And Decisions

Recorded 2026-11-09.

1. **How Rejected appears in the funnel.**
   - A: a separate Rejected row.
   - B: a red part inside each row for rejections at that step.
   - C: a text line under the funnel.
   - **Selected B** (user).
   - Withdrawn and No response are not shown (user asked for Rejected only).
   - The visible text line under the funnel is the assistant's addition, because SOW-0034 Decision 7 makes tooltips hover-only and the exact counts need a non-hover path.

## Plan

See the implementation plan in the gate.

## Execution Log

### 2026-11-09

- SOW written after the user chose B.
- Tests written first:
  - the summary rule (`counts each rejection at the furthest step it reached`, plus the zero-filled field on an empty profile);
  - the card (red parts and their widths, tooltip suffix, text line, nothing shown without rejections).
  - Four failed as expected, then passed after the change to `src/server/domain/dashboard.ts` and `FunnelCard.tsx`. `DashboardPage` passes `rejected_at`; the page and API test fixtures were updated.
- Independent review: approved, no Critical or Important findings.

## Validation

Acceptance criteria evidence:

- `rejected_at`: `test/server/domain/dashboard.test.ts` covers the five cases listed in the acceptance criteria, `{ applied: 2, screening: 0, interview: 2, offer: 0 }`, with the funnel itself unchanged. `test/server/api/dashboard.test.ts` asserts the field in the route response.
- Card: `test/ui/dashboard-cards.test.tsx` covers:
  - widths (blue `(count − rejected) / Applied`, red `rejected / Applied`);
  - an all-rejected row with no blue part;
  - row counts and shares unchanged;
  - the tooltip "20 applications sent; 5 rejected after applying";
  - the text line "Rejected after: applying 5 · screening 2 · the offer 1";
  - no parts or line without rejections.
- `npm run typecheck` exit 0. `npm test`: `Test Files 73 passed (73)`, `Tests 1030 passed (1030)`, no warnings.

Tests or equivalent validation:

- As above. RED then GREEN, recorded in the Execution Log.

Real-use evidence:

- Mock sandbox in Chrome, rich profile, with one application rejected after applying:
  - the Applied row ends in a red part;
  - hover tooltip "8 applications sent; 1 rejected after applying";
  - the line "Rejected after: applying 1" under the funnel;
  - correct in both themes;
  - the funnel and attention cards stay the same height (258 px);
  - no horizontal overflow (scrollWidth 1512).

Reviewer findings:

- Approved. It checked:
  - `FUNNEL_STAGES[reach - 1]` is always in range for rejected applications;
  - every width edge case;
  - the text line uses muted text, with the color only on an `aria-hidden` swatch;
  - the docs match the code.
- Minors:
  - a long test line (style only; left);
  - the gap and rounding need a visual check: done in the browser;
  - sub-pixel red parts for tiny counts: accepted risk, because the text line carries the numbers;
  - the tooltip has no plural handling, and reads fine for any N: left.

Same-failure scan:

- `grep -rn "<FunnelCard" src test`: every use passes `rejectedAt`.
- `grep -rn "funnel: {" test`: every summary fixture carries `rejected_at`.

Sensitive data gate:

- Invented data only. No workstation paths in durable text.

Artifact maintenance gate:

- AGENTS.md: unaffected; no new command or rule.
- Runtime project skills: unaffected. The route and its path are unchanged; only the response gains a field. `project-local-api` lists routes, not response fields.
- Specs: `.agents/sow/specs/product-v1.md` Dashboard section, covering the red parts, the tooltip suffix, the text line, `rejected_at` in the response and its definition.
- End-user/operator docs: the `README.md` Dashboard bullet mentions the red rejected parts.
- End-user/operator skills: none exist.
- SOW lifecycle: `completed`, moved to `done/`, committed with the work.

Specs update:

- As above.

Project skills update:

- None needed; see above.

End-user/operator docs update:

- `README.md`, as above.

End-user/operator skills update:

- None exist.

Lessons:

- When a chart's tooltips are hover-only, every new number it shows needs a visible text path too. The text line under the funnel follows the SOW-0034 Decision 7 rule and was planned before coding.

Follow-up mapping:

- None. Withdrawn and No response drop-offs were excluded on purpose (the user asked for Rejected only). They are not deferred work.

## Outcome

Delivered. Each funnel row now shows, in red at the end of its fill, how many applications were rejected after reaching that step. The tooltip adds "N rejected after …", and a text line lists the counts. The summary response carries `rejected_at`.

## Lessons Extracted

- See Validation → Lessons.

## Followup

None.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
