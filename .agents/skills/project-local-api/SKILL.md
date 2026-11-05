---
name: project-local-api
description: "Mandatory knowledge when changing the HTTP API, the request guard, static serving, or the server bootstrap: src/server/api/*, src/server/app.ts, src/server/index.ts, bin/jobtrack.js. Use before adding a route, changing validation, touching SSE, or changing how the server binds or shuts down."
---
# Local HTTP API

## Purpose

The API is unauthenticated by design and listens only on loopback. Its safety rests on three guards and on strict validation; this skill keeps them intact when routes change.

## Scope

Use this skill when:

- adding or changing routes under `src/server/api/`;
- changing `src/server/api/guard.ts`, `errors.ts`, `app.ts`, `src/server/index.ts`, `bin/jobtrack.js`;
- changing the SSE route or the UI client that consumes it.

Do not use this skill for:

- repository or service logic that the API merely calls.

## Mandatory Knowledge

- The server binds `127.0.0.1` only. Never `0.0.0.0`. Evidence: `src/server/index.ts`, design section 8.
- Request guard on `/api/*`: Host must be `127.0.0.1`, `localhost` or `[::1]` (any port, plus `AppDeps.allowedHosts`); POST/PUT/PATCH/DELETE with a present Origin must match the same list; JSON bodies must have `Content-Type: application/json` (415 otherwise). Evidence: `src/server/api/guard.ts`, `errors.ts`. Ruling in SOW-0001 (final review of Task 15).
- Every body is validated with zod; PATCH bodies use strict allow-lists (applications: six keys; settings: typed per key with bounds). Unknown ids → 404 via `HttpError` before any filesystem access (the log store throws on bad ids). Evidence: `src/server/api/applications.ts`, `settings.ts`, `runs.ts`.
- Error mapping: 400 validation, 404 missing, 409 `ProposalNotPendingError`, 415 content type, 422 `Profile is not set` and (after the fix wave) adapter not installed, 500 `Internal error` without details. Evidence: `src/server/api/errors.ts`.
- SSE (`GET /api/runs/:id/events`) replays the log, forwards new lines, polls the run status and sends `event: done` on a terminal status; it never ends on the queue's finish line. The UI client closes the `EventSource` on `done`. Evidence: `src/server/api/runs.ts`, `src/ui/api/client.ts`.
- Static UI is served from `<packageRoot>/dist/ui` only, with a traversal guard and SPA fallback that never shadows `/api/*`. Evidence: `src/server/app.ts`, `src/server/index.ts`.
- Shutdown order: scheduler stop, queue stop (aborts the running agent), `closeAllConnections` (ends SSE), server close, db close; `close()` is idempotent. Evidence: `src/server/index.ts`.

## Best Practices

- New route: zod schema in the router file, `HttpError` for client errors, test via `app.request()` through the harness, assert body and DB state.
- Anything that spawns an agent run checks the adapter first and returns 422 with a human message rather than enqueueing a run that will fail.

## Bad Practices

- Reading `c.req.json()` outside `readJson` (skips the 415 check).
- Building SQL `SET` clauses from request keys without an allow-list.
- Ending an SSE stream on a log line.

## Workflow Checklist

1. Add the zod schema and the route; add the test in `test/server/api/<router>.test.ts`.
2. If the route changes state, confirm it is covered by the Origin check (it is, if under `/api`).
3. Update `src/ui/api/client.ts` and its test in the same change.
4. Run `npm test`; run the e2e test if the route is on the discovery or sync path.

## Validation Checklist

Before claiming done:

- `grep -rn "0.0.0.0" src bin` returns nothing.
- A foreign `Host` and a foreign `Origin` on the new route return 403 (add to `guard.test.ts` if the route is special).
- README "Security" section still accurate.

## Evidence

- `src/server/api/guard.ts`, `test/server/api/guard.test.ts`.
- `SOW-0001`: Task 15 final review finding and ruling.

## Update Rules

Update this skill when:

- the guard's allow-list or any status-code mapping changes;
- a new state-changing route is added;
- the shutdown order changes.
