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
- The CV upload `POST /api/cv-analysis` (SOW-0023) is the only non-JSON body: `application/octet-stream` (415 otherwise; not CORS-safelisted, so a cross-site page must preflight and the Origin check stops it), the URI-encoded file name in `X-File-Name`, and Hono's `bodyLimit` at 10 MB (413). Keep any future upload on a non-safelisted content type; never accept `multipart/form-data` or `text/plain`. `CvFileError` maps to its own status (413/415/422) and `CvAnalysisStateError` to 409 in `errors.ts`. Global CV routes (the analysis for a new profile): `GET`/`POST`/`DELETE /api/cv-analysis` and `POST /api/cv-analysis/retry`; profile-scoped: `GET`/`DELETE /api/profiles/:pid/cv` and the same analysis router mounted again at `/api/profiles/:pid/cv-analysis` for the profile's own analysis (SOW-0024; `createCvAnalysisRouter(deps, ownerOf)`, both mounts typed with `ProfileEnv`, the global one never reads the profile). `PUT /api/profiles/:pid` takes an optional `cv_analysis_id` (only that profile's `succeeded` analysis, else 409) and replaces the CV; `POST /api/profiles` refuses a profile's analysis. File names from the client are only displayed and offered on download (RFC 6266 `filename`/`filename*`); paths are built from ids checked against `^[A-Za-z0-9_-]+$`.
- Every body is validated with zod; PATCH bodies use strict allow-lists (applications: six keys; settings: typed per key with bounds). Unknown ids → 404 via `HttpError` before any filesystem access (the log store throws on bad ids). Evidence: `src/server/api/applications.ts`, `settings.ts`, `runs.ts`.
- Profile scoping (SOW-0014): jobs, applications, proposals, runs and the read-only dashboard (`GET /api/profiles/:pid/dashboard`, SOW-0034) are mounted under `/api/profiles/:pid` by `src/server/api/profiles.ts`. A middleware loads the profile (404 "Profile not found") and stores it in the Hono context (`ProfileEnv`); scoped routers read `c.get('profile')`, never the raw param. Every item route must also check the entity's owner (`profile_id`, or the application's for a proposal) and answer 404 for another profile's id. Only `/api/settings`, `/api/setup/*`, `/api/health`, `/api/profiles`, `GET /api/profiles/by-slug/:slug`, `DELETE /api/runs/logs` and `/api/cv-analysis` (the new-profile analysis) are global. Slugs exist for browser URLs only (SOW-0015): data routes stay keyed by id, and `by-slug` is registered before the scoped router so the `/:pid/*` middleware never treats `by-slug` as an id. Evidence: `test/server/api/profiles.test.ts`, `test/server/api/runs.test.ts` ("another profile's run is 404").
- `DELETE /api/profiles/:pid` refuses with 409 while the profile has a queued or running run, then deletes rows in one transaction (including the profile's CV analysis row, SOW-0024) and removes run logs, the CV folder and the analysis folder afterwards, stopping the analysis agent. Check and delete stay synchronous in one handler so the queue cannot start a run in between. Evidence: `src/server/api/profiles.ts`, `src/server/db/profiles-repo.ts`.
- Error mapping: 400 validation, 404 missing (including another profile's ids), 409 `ProposalNotPendingError`, run cancel refusals, a taken profile name, a profile delete with active runs and a discovery of the other effort mode while one is active (`ActiveRunConflictError`, SOW-0016), 415 content type, 422 adapter not installed or invalid command, 500 `Internal error` without details. Evidence: `src/server/api/errors.ts`.
- `POST /api/profiles/:pid/runs/:id/cancel` (SOW-0012) is a state-changing route under the guard: 404 unknown id (checked before the queue), 202 with the run for `cancelled`/`cancelling`, 409 for `saving` ("This run is saving its results and can no longer be cancelled") and `finished`. Cancellation itself lives in `queue.cancel()`; the route only maps its outcome. Handlers must call `ctx.beginSaving()` before any data write so a cancel can never be reported while results are written. Evidence: `src/server/api/runs.ts`, `test/server/api/runs.test.ts`, `test/e2e/discovery-flow.test.ts`.
- `POST /api/profiles/:pid/runs/discover` (SOW-0016) takes no body (default) or a strict JSON body `{ mode, custom_prompt }` (both optional; `custom_prompt` from SOW-0042 is trimmed, blank or null means none, more than `CUSTOM_PROMPT_MAX` = 2,000 characters is 400); any body without a JSON content type is 415, so the form-post protection holds. Validation runs before the adapter check, so a bad body never enqueues. While a discovery is active, only the same mode and the same instructions return it; anything else is 409 (`queue.enqueue` compares `effort_mode` and `custom_prompt`).
- Imports (SOW-0043): `POST /api/profiles/:pid/runs/import/prompt` (optional `{ custom_prompt }`, returns `{ prompt, version }`, no run, no agent) and `POST /api/profiles/:pid/runs/import` (strict `{ reply } | { result }` plus `custom_prompt`; `bodyLimit` 1 MB → 413 like the CV upload; `ImportInputError` from `parseImport` → 400; 409 "An import is already active"). Neither checks the agent: an import runs none. Both are registered before the `/:id` routes. The README documents the import route with a `curl` example, so its body and errors are a public contract: change them only with the README and spec.
- SSE (`GET /api/profiles/:pid/runs/:id/events`) replays the log, forwards new lines, polls the run status and sends `event: done` on a terminal status; it never ends on the queue's finish line. The UI client closes the `EventSource` on `done`. Evidence: `src/server/api/runs.ts`, `src/ui/api/client.ts`.
- Static UI is served from `<packageRoot>/dist/ui` only, with a traversal guard and SPA fallback that never shadows `/api/*`. Evidence: `src/server/app.ts`, `src/server/index.ts`.
- Data directory (SOW-0025): `locateDataDir` in `src/server/config/paths.ts` resolves `--data-dir`, `JOBTRACK_DATA_DIR`, `~/.config/job-applications-tracker/config.json`, then `~/.job-applications-tracker`, expanding a leading `~`. The config file is read only when flag and env are unset, so a broken file never blocks a run that names its folder. `startApp` refuses a config-file folder that does not exist instead of recreating it empty. `bin/jobtrack.js` accepts one command, `config get|set|unset data-dir` (no other options), and runs `chooseDataDirOnFirstRun` before `startApp`; it asks only when stdin and stdout are TTYs, opens readline lazily, and exits 130 on Ctrl-C or end of input. Tests never touch the real home: unit tests pass `home`; bin tests that reach the data directory or the config file spawn through `homeEnv()` (temporary `HOME`/`USERPROFILE`, no `JOBTRACK_DATA_DIR`), and the rest exit before reading either or pass `--data-dir`. The TTY path is checked manually with `script -q <log> node bin/jobtrack.js ...` on a temporary `HOME`.
- Shutdown order: scheduler stop, queue stop (aborts the running agent), CV service stop (aborts every running CV analysis), `closeAllConnections` (ends SSE), server close, db close; `close()` is idempotent. Evidence: `src/server/index.ts`.

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
- `src/server/config/paths.ts`, `first-run.ts`, `cli.ts`; `test/server/config/*.test.ts`, `test/server/bin.test.ts` (SOW-0025).
- `SOW-0001`: Task 15 final review finding and ruling.

## Update Rules

Update this skill when:

- the guard's allow-list or any status-code mapping changes;
- a new state-changing route is added;
- the shutdown order changes;
- the data directory precedence, the config file, or the bin commands change.
