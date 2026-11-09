# SOW-0030 - Hand-entered Applied dates use UTC midnight, the table and filters use local days

## Status

Status: open

Sub-state: found in the SOW-0029 review; needs a user decision before implementation.

## Requirements

### Purpose

An Applied date the user types in should show and filter as that same calendar day everywhere.

### User Request

None yet. Raised by the SOW-0029 independent review and reported to the user.

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

- Which model the user wants (see options).

### Acceptance Criteria

- Pending the decision.

## Analysis

Options for the user:

- A. Store typed dates as local midnight (`new Date(y, m - 1, d)`), so table, filter and detail page agree in the user's zone. Existing rows keep UTC midnight unless migrated.
- B. Keep storage; display and filter hand-entered dates by their UTC day. Needs a way to tell typed dates from real timestamps.
- C. Store a plain date for typed values (schema change), timestamps for Mark applied.

## Pre-Implementation Gate

Status: needs-user-decision

Open decisions:

- Choose A, B or C above.

## Implications And Decisions

Pending.

## Plan

Pending.

## Execution Log

### 2026-11-09

- Created from the SOW-0029 review.

## Validation

Pending.

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

None yet.

## Regression Log

None yet.
