# SOW-0030 - Hand-entered Applied dates use UTC midnight, the table and filters use local days

## Status

Status: completed

Sub-state: delivered and validated.

## Requirements

### Purpose

An Applied date the user types in should show and filter as that same calendar day everywhere.

### User Request

Raised by the SOW-0029 independent review; the user chose option A on 2026-11-09 ("1.A") and asked for it before the issue #20 PR.

### Assistant Understanding

Facts:

- `src/ui/components/AddApplicationForm.tsx:40` and `src/ui/pages/ApplicationDetailPage.tsx:72` store a typed date as `${date}T00:00:00Z` (UTC midnight).
- The Applications table shows `applied_at` with `formatTime` (local time), and since SOW-0029 the Applied date filter uses local days (user decision 6).
- The detail page shows the date from the stored UTC string.
- Example (invented): a user at UTC-8 types 2026-11-05; the table shows 4 Nov 16:00, the detail page 2026-11-05, and an Applied filter of 5 Nov leaves the row out. East of UTC the day matches.
- `applied_at` set by Mark applied is a real timestamp (server `now`), not a date.

Inferences:

- The mismatch predates SOW-0029 (the table cell already showed the previous day west of UTC); the filter makes it visible.

Unknowns:

- None.

### Acceptance Criteria

- A date typed in Add application or on the detail page is sent as local midnight of that day (`new Date(y, m - 1, d).toISOString()`). Verified by unit tests under a zone west and a zone east of UTC, and by page tests written zone-independently.
- The detail page's Applied date field shows the local calendar day of the stored value (the day the table shows and the filter uses), so a typed date round-trips unchanged. Unit tests in both zones.
- Unparseable stored values still show their first 10 characters, as before.

## Analysis

Options for the user:

- A. Store typed dates as local midnight (`new Date(y, m - 1, d)`), so table, filter and detail page agree in the user's zone. Existing rows keep UTC midnight unless migrated.
- B. Keep storage; display and filter hand-entered dates by their UTC day. Needs a way to tell typed dates from real timestamps.
- C. Store a plain date for typed values (schema change), timestamps for Mark applied.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Typed dates are pinned to UTC midnight (`AddApplicationForm.tsx:40`, `ApplicationDetailPage.tsx:72`) and the detail page reads the UTC day back (`toDateInput` slices the ISO string, `ApplicationDetailPage.tsx:19`), while the table (`formatTime`) and the SOW-0029 Applied filter use the browser's local day. Away from UTC the two disagree by a day for part of the zones.

Evidence reviewed:

- The three code locations above; `src/ui/format.ts`; `src/ui/table-view.ts` (`fromIsoDay`, `toIsoDay`); `src/server/api/applications.ts:27,41` (`applied_at` is any string, no server change needed); `src/server/api/jobs.ts:31` (Mark applied stores `new Date().toISOString()`, unaffected); `test/ui/ApplicationsPage.test.tsx:97` (asserts the UTC-midnight value).

Affected contracts and surfaces:

- UI only: Add application sheet, application detail form. Stored format stays an ISO UTC string; only the instant chosen for a typed day changes. No API, schema or migration.

Existing patterns to reuse:

- `fromIsoDay` / `toIsoDay` from `src/ui/table-view.ts` (local-day helpers added in SOW-0029); `src/ui/format.ts` for display helpers.

Risk and blast radius:

- Rows saved before this change keep UTC midnight (decision A leaves them). West of UTC their detail field now shows the previous day, matching what the table already showed; saving the detail form keeps that shown day. East of UTC (UTC+1..+14) UTC midnight is the same local day, so nothing changes there.
- A Mark-applied timestamp now shows its local day on the detail page instead of its UTC day (more correct; same as the table).
- CI runs in UTC, where old and new behaviour coincide; zone-pinned unit tests cover the difference.

Sensitive data handling plan:

- Invented dates only; no user data.

Implementation plan:

1. `src/ui/format.ts`: `dayToIso(day)` (local midnight ISO) and `isoToDay(iso)` (local day, fallback to the first 10 characters when unparseable). Unit tests with `process.env.TZ` set to `America/Los_Angeles` and `Asia/Tokyo`, restored after.
2. Use them in `AddApplicationForm.tsx` and `ApplicationDetailPage.tsx`; update the comment.
3. Make `test/ui/ApplicationsPage.test.tsx` "creates an application with an ISO applied date" zone-independent.
4. Spec line; SOW close.

Validation plan:

- `npx vitest run test/ui/format.test.ts test/ui/ApplicationsPage.test.tsx`, then `npm run typecheck`, `npm test`; same-pattern search for other `T00:00:00Z` constructions in `src/`.

Artifact impact plan:

- AGENTS.md: no change expected (no workflow or hazard change).
- Runtime project skills: `project-testing` gets the zone-pinning technique if it works in this vitest setup.
- Specs: `product-v1.md` notes that typed Applied dates are stored as local midnight.
- End-user/operator docs: README describes the Applied date filter by day already; no wording depends on UTC. Checked, no change expected.
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/` in the same commit.

Open-source reference evidence:

- Not relevant; no external code involved.

Open decisions:

- Resolved: option A.

## Implications And Decisions

1. Option A (user, 2026-11-09): store typed dates as local midnight; existing rows are not migrated.

## Plan

See Implementation plan in the gate.

## Execution Log

### 2026-11-09

- Created from the SOW-0029 review; user chose option A.
- `src/ui/format.ts`: `dayToIso`, `isoToDay` (reuse `fromIsoDay`/`toIsoDay` from `table-view.ts`). Used in `AddApplicationForm.tsx` and `ApplicationDetailPage.tsx` (removed `toDateInput`).
- `test/ui/format.test.ts`: zone-pinned tests written first and seen failing (`dayToIso is not a function`); `test/ui/ApplicationsPage.test.tsx` add-with-date expectation made zone-independent.

## Validation

Acceptance criteria evidence:

- Local midnight on write and same day on read, west and east of UTC: `test/ui/format.test.ts` "stores a typed day as local midnight west of UTC…" (`2026-11-05` → `2026-11-05T08:00:00.000Z` in America/Los_Angeles) and "…east of UTC…" (`2026-11-04T15:00:00.000Z` in Asia/Tokyo), both reading back `2026-11-05`.
- Add application sends local midnight: `ApplicationsPage.test.tsx` "creates an application with an ISO applied date".
- Unparseable values keep their first 10 characters: "shows nothing for no date and the first ten characters…".

Tests or equivalent validation:

- `npm run typecheck`: exit 0.
- `npm test`: `Test Files  68 passed (68)`, `Tests  920 passed (920)`.
- Extra zone runs: `TZ=America/Los_Angeles npx vitest run` on the Applications, table-view, Jobs and Runs tests: 75 passed; `TZ=UTC npx vitest run --project ui`: 272 passed (the machine runs in EET).

Real-use evidence:

- Not run in the browser: the change is two pure helpers on the form paths, covered in three zones above. The detail page has no page test (tracked in SOW-0005, "add a detail-page test").

Reviewer findings:

- The change answers finding 2 of the SOW-0029 independent review. No separate review: two helper functions and three call sites, with zone-pinned tests; recorded here so the omission is visible.

Same-failure scan:

- `grep -rn "T00:00:00Z\|slice(0, 10)" src/ui` (excluding `format.ts`): no matches left.

Sensitive data gate:

- Invented dates only.

Artifact maintenance gate:

- AGENTS.md: no change; no workflow, command or hazard changed.
- Runtime project skills: `.agents/skills/project-testing/SKILL.md` gains the time-zone testing note.
- Specs: `.agents/sow/specs/product-v1.md` states that typed Applied dates are stored as local midnight and that older rows are not migrated.
- End-user/operator docs: README says the Applied filter works by day and nothing about UTC; the shown day now matches the typed day, so no wording changes.
- End-user/operator skills: none exist.
- SOW lifecycle: completed, moved to `done/` in the same commit as the change.

Specs update:

- `.agents/sow/specs/product-v1.md` (User interface, manual applications).

Project skills update:

- `.agents/skills/project-testing/SKILL.md`.

End-user/operator docs update:

- None needed (see gate).

End-user/operator skills update:

- None exist.

Lessons:

- CI in UTC hides time-zone bugs; pin `TZ` in the tests that care.

Follow-up mapping:

- Migrating older UTC-midnight rows: rejected by the user's choice of option A (no migration).
- Detail-page test: already tracked in SOW-0005.

## Outcome

A typed Applied date is the same day in the table, the Applied filter and the form, in every time zone.

## Lessons Extracted

See Lessons; recorded in `project-testing`.

## Followup

None.

## Regression Log

None yet.
