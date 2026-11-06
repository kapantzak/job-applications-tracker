# SOW-0005 - v1 hardening backlog from per-task and final reviews

## Status

Status: open

Sub-state: drafted at SOW-0001 close; schedule after the user decisions in SOW-0002..0004.

## Requirements

### Purpose

Collect every reviewer finding from SOW-0001 that was accepted as real but deferred, so none is lost. Each item below is small; batch them by area.

### Items

Settings and UI:
- Show prompt template versions in use and an "Open logs folder" action in Settings (design 6.5).
- Show `match_reason` and `description_excerpt` on the Jobs screen.
- Done in SOW-0009: Saved/Applied state derived from `application_status` on the jobs list; a saved job can be marked applied.
- Hide "Dismiss" on already dismissed rows; show the list (not "Loading") when the initial job load fails.
- Detail page heading should refresh after save; add a detail-page test; disable Save buttons while a request is in flight.
- Done in SOW-0009: the Jobs page shows the real status label (Interview, Offer, …) from `application_status`.
- Sync-interval options derived from a shared constant.
- From SOW-0010 review: status `<select>` options show raw values (`no_response`); switch to `STATUS_LABELS` in `src/ui/components/StatusSelect.tsx` and update `test/ui/ApplicationsPage.test.tsx` (`findByDisplayValue('interview')`).
- From SOW-0010 review: after confirming Purge run logs or Dismiss, focus returns to a disabled or removed trigger and lands on `body`; move focus to the result message or the table.
- From SOW-0010 review: closing the Add application sheet discards a half-filled form; keep the draft in `ApplicationsPage` state if users ask for it.
- From SOW-0010 real use: adapter cards show both an Installed badge and "installed <version>" text; drop one.
- `src/ui/api/client.ts` imports `Job` without using it (pre-existing, found by `--noUnusedLocals` in SOW-0010).

Server:
- Windows resolver: handle a `.cmd` shim that references a native `.exe`; look up a bare `name.cmd` argv0 on PATH instead of cwd only (SOW-0002 review).
- `extractClaudeStructuredOutput`: surface `is_error` / `subtype` from the Claude result event instead of "no structured output".
- Verifier: skip loopback and private-range hosts; share one deadline across redirect hops; `body.cancel()` failure must not misclassify.
- Done in SOW-0014: logs purge uses `runsRepo.listActiveIds()` instead of direct SQL in the route.
- Origin check should also compare the port (another local dev server page could issue writes).
- Product decisions for the user: duplicate applications on double Save / Save-then-Applied; manual applications do not infer `sender_domains`; `no_response` ageing.
- Queue: `start()` after `stop()` is a silent no-op; stuck-row guard blocks later runs of the other kind (only on DB write failure).
- Data directory: expand a leading `~`; close the db if migration fails before listen.
- Profile round-trip (routes are `GET`/`PUT /api/profiles/:pid` since SOW-0014; `id` is now returned too): `GET /api/profile` returns `created_at` but `PUT /api/profile` rejects it (`Unrecognized key`), so a client cannot PUT what it GOT (found in SOW-0008 validation).

Tests:
- Auth-probe `hang` test should record the child pid and assert it is dead (SOW-0003 review).
- Migration tests: positive controls, CHECK/FK/unique/rollback assertions.
- Repository tests: rollback paths, boundary dates, unknown-id paths, `reviewedMessageIds` with accepted proposals.
- Scheduler: `unref`, swallowed enqueue, 1h→6h refresh.
- API: PATCH stored-row assertions; traversal variants; e2e `afterEach` try/finally and GET status assertions.
- UI: client tests restore `fetch`; `unstubAllGlobals` in `afterEach`; success-path tests for discovery/save/dismiss.

### Acceptance Criteria

- Every item implemented or rejected with a one-line reason in this file.

## Pre-Implementation Gate

Status: blocked (fill when scheduled)
