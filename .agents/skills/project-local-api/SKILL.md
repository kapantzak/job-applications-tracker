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
- The CV upload `POST /api/cv-analysis` (SOW-0023) is the only non-JSON body: `application/octet-stream` (415 otherwise; not CORS-safelisted, so a cross-site page must preflight and the Origin check stops it), the URI-encoded file name in `X-File-Name`, and Hono's `bodyLimit` at 10 MB (413). Keep any future upload on a non-safelisted content type; never accept `multipart/form-data` or `text/plain`. `CvFileError` maps to its own status (413/415/422) and `CvAnalysisStateError` to 409 in `errors.ts`. Global CV routes: `GET`/`POST`/`DELETE /api/cv-analysis` and `POST /api/cv-analysis/retry`; profile-scoped: `GET`/`DELETE /api/profiles/:pid/cv`. File names from the client are only displayed and offered on download (RFC 6266 `filename`/`filename*`); paths are built from ids checked against `^[A-Za-z0-9_-]+$`.
- Every body is validated with zod; PATCH bodies use strict allow-lists (applications: six keys; settings: typed per key with bounds). Unknown ids → 404 via `HttpError` before any filesystem access (the log store throws on bad ids). Evidence: `src/server/api/applications.ts`, `settings.ts`, `runs.ts`.
- Profile scoping (SOW-0014): jobs, applications, proposals and runs are mounted under `/api/profiles/:pid` by `src/server/api/profiles.ts`. A middleware loads the profile (404 "Profile not found") and stores it in the Hono context (`ProfileEnv`); scoped routers read `c.get('profile')`, never the raw param. Every item route must also check the entity's owner (`profile_id`, or the application's for a proposal) and answer 404 for another profile's id. Only `/api/settings`, `/api/setup/*`, `/api/health`, `/api/profiles`, `GET /api/profiles/by-slug/:slug`, `DELETE /api/runs/logs` and `/api/cv-analysis` are global. Slugs exist for browser URLs only (SOW-0015): data routes stay keyed by id, and `by-slug` is registered before the scoped router so the `/:pid/*` middleware never treats `by-slug` as an id. Evidence: `test/server/api/profiles.test.ts`, `test/server/api/runs.test.ts` ("another profile's run is 404").
- `DELETE /api/profiles/:pid` refuses with 409 while the profile has a queued or running run, then deletes rows in one transaction and removes run logs afterwards. Check and delete stay synchronous in one handler so the queue cannot start a run in between. Evidence: `src/server/api/profiles.ts`, `src/server/db/profiles-repo.ts`.
- Error mapping: 400 validation, 404 missing (including another profile's ids), 409 `ProposalNotPendingError`, run cancel refusals, a taken profile name, a profile delete with active runs and a discovery of the other effort mode while one is active (`ActiveRunConflictError`, SOW-0016), 415 content type, 422 adapter not installed or invalid command, 500 `Internal error` without details. Evidence: `src/server/api/errors.ts`.
- `POST /api/profiles/:pid/runs/:id/cancel` (SOW-0012) is a state-changing route under the guard: 404 unknown id (checked before the queue), 202 with the run for `cancelled`/`cancelling`, 409 for `saving` ("This run is saving its results and can no longer be cancelled") and `finished`. Cancellation itself lives in `queue.cancel()`; the route only maps its outcome. Handlers must call `ctx.beginSaving()` before any data write so a cancel can never be reported while results are written. Evidence: `src/server/api/runs.ts`, `test/server/api/runs.test.ts`, `test/e2e/discovery-flow.test.ts`.
- `POST /api/profiles/:pid/runs/discover` (SOW-0016) takes no body (default) or a strict JSON body `{ mode }`; any body without a JSON content type is 415, so the form-post protection holds. Validation runs before the adapter check, so a bad body never enqueues.
- SSE (`GET /api/profiles/:pid/runs/:id/events`) replays the log, forwards new lines, polls the run status and sends `event: done` on a terminal status; it never ends on the queue's finish line. The UI client closes the `EventSource` on `done`. Evidence: `src/server/api/runs.ts`, `src/ui/api/client.ts`.
- Static UI is served from `<packageRoot>/dist/ui` only, with a traversal guard and SPA fallback that never shadows `/api/*`. Evidence: `src/server/app.ts`, `src/server/index.ts`.
- Shutdown order: scheduler stop, queue stop (aborts the running agent), CV service stop (aborts a running CV analysis), `closeAllConnections` (ends SSE), server close, db close; `close()` is idempotent. Evidence: `src/server/index.ts`.

## Best Practices

- New route: zod schema in the router file, `HttpError` for client errors, test via `app.request()` through the harness, assert body and DB state.
- A new profile-owned route goes in a router mounted from `profiles.ts` and checks ownership; a test requests another profile's id and expects 404.
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
