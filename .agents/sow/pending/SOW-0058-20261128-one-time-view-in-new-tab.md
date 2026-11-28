# SOW-0058 - One-time views opened in a new tab

## Status

Status: open

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: tracked from SOW-0057 (user decision 12B); not started.

## Requirements

### Purpose

A Dashboard tile or Journey branch is a quick look at some applications; opening one must never replace the user's saved Applications filters, whichever way it is opened.

### User Request

Raised by the SOW-0057 independent review (finding 4) and tracked by user decision 12B: "Open a pending SOW to fix it for tiles and branches together."

### Assistant Understanding

Facts:

- Tiles (SOW-0054 decision 8B) and Journey branches (SOW-0057) open Applications as a one-time view by passing router location state `ONE_TIME_VIEW` (`src/ui/view-storage.ts`).
- Router state is lost when the link opens in a new tab or window (Cmd/Ctrl-click, middle-click, "Open link in new tab"): the new page has the narrowed query in its URL and no state.
- `useSharedTableView` (`src/ui/hooks/use-table-view.ts`) saves any view that arrives in the URL when the location is not a one-time view, so the new tab overwrites `application-filters:<profileId>` with the tile's or branch's narrowed view.

Inferences:

- A marker in the URL (for example a reserved query key) would survive a new tab; it must not collide with column ids and must be dropped when the user changes the view.

Unknowns:

- The marker's form and whether the Details back link and browser Back/Forward keep it; to be settled by analysis and user decisions before implementation.

### Acceptance Criteria

- Opening a tile or branch in a new tab shows its view and leaves the saved filters unchanged until the user changes the view there. Verified by UI tests and a real-browser check.
- Existing one-time view behaviour (same-tab open, Details back link, Back/Forward, decision 12A of SOW-0054) is unchanged. Verified by the existing tests.

## Analysis

Sources checked:

- `src/ui/hooks/use-table-view.ts`, `src/ui/view-storage.ts`, `src/ui/pages/DashboardPage.tsx`, `src/ui/components/dashboard/JourneyCard.tsx`, SOW-0054, SOW-0057 review finding 4.

Current state:

- See Facts. Pre-existing for tiles since SOW-0054; SOW-0057 added ten more links with the same behaviour.

Risks:

- A URL marker changes the Applications URL contract and the saved-view parsing; it must not end up saved or shared as part of a view.

## Pre-Implementation Gate

Status: blocked

Not started: analysis, the marker design and user decisions are required before implementation. The gate is filled when this SOW moves to `current/`.

## Implications And Decisions

None yet.

## Plan

To be written after analysis.

## Execution Log

### 2026-11-28

- Opened from SOW-0057 decision 12B.

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

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
