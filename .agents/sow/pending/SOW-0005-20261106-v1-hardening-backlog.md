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
- Keep "Saved"/"Applied" state after remount (derive from applications instead of local state); let a saved job be marked applied.
- Hide "Dismiss" on already dismissed rows; show the list (not "Loading") when the initial job load fails.
- Detail page heading should refresh after save; add a detail-page test; disable Save buttons while a request is in flight.
- Sync-interval options derived from a shared constant.

Server:
- `extractClaudeStructuredOutput`: surface `is_error` / `subtype` from the Claude result event instead of "no structured output".
- Verifier: skip loopback and private-range hosts; share one deadline across redirect hops; `body.cancel()` failure must not misclassify.
- Logs purge via a `runsRepo.listActiveIds()` method instead of direct SQL in the route.
- Origin check should also compare the port (another local dev server page could issue writes).
- Product decisions for the user: duplicate applications on double Save / Save-then-Applied; manual applications do not infer `sender_domains`; `no_response` ageing.
- Queue: `start()` after `stop()` is a silent no-op; stuck-row guard blocks later runs of the other kind (only on DB write failure).
- Data directory: expand a leading `~`; close the db if migration fails before listen.

Tests:
- Migration tests: positive controls, CHECK/FK/unique/rollback assertions.
- Repository tests: rollback paths, boundary dates, unknown-id paths, `reviewedMessageIds` with accepted proposals.
- Scheduler: `unref`, swallowed enqueue, 1h→6h refresh.
- API: PATCH stored-row assertions; traversal variants; e2e `afterEach` try/finally and GET status assertions.
- UI: client tests restore `fetch`; `unstubAllGlobals` in `afterEach`; success-path tests for discovery/save/dismiss.

### Acceptance Criteria

- Every item implemented or rejected with a one-line reason in this file.

## Pre-Implementation Gate

Status: blocked (fill when scheduled)
