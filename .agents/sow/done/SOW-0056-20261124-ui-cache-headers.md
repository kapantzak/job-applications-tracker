# SOW-0056 - Cache headers for the static UI

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered; the user asked for the pull request on 2026-11-24, so the SOW closes with the work in one commit.

## Requirements

### Purpose

After installing a new version, the browser keeps showing the old UI until the user does a hard refresh. The user wants new versions to show up without a hard refresh.

### User Request

"Every time I install a new version, it needs a hard refresh to pick up the new assets. Can we clear the cache after each update? Is this a good practice?" (2026-11-24). The user then chose cache headers (1A) and no open-tab version check (2A).

### Assistant Understanding

Facts:

- The UI is served by `serveStatic` from `@hono/node-server` 2.1.6 (`src/server/app.ts`, the files and the SPA fallback to `index.html`).
- `serveStatic` sets `Content-Type`, `Content-Length` and `Last-Modified` (from the file mtime) and no `Cache-Control` or `ETag`, and answers no conditional request with 304 (`@hono/node-server/dist/serve-static.mjs`, version 2.1.6). Nothing in `src/` adds cache headers.
- Vite writes content-hashed file names under `dist/ui/assets/` (for example `index-<hash>.js`); `dist/ui/index.html` and `dist/ui/licenses/` (copied from `src/ui/public/`) keep fixed names.
- A global npm install writes the package files with the install time as mtime (checked on a local global install of 0.5.0).

Inferences:

- With `Last-Modified` and no `Cache-Control`, browsers may reuse a response for a heuristic lifetime (RFC 9111 section 4.2.2; commonly 10% of the time since `Last-Modified`). A cached `index.html` points at the old hashed bundle, which is also cached, so the old UI runs until a hard refresh. Browser-specific heuristic values were not verified against browser source.

Unknowns:

- None that block the work.

### Acceptance Criteria

- `index.html`, the SPA fallback and other unhashed files are served with `Cache-Control: no-cache`, so the browser checks with the server on every load. Verified by API tests in `test/server/api/app.test.ts`.
- Files under `assets/` are served with `Cache-Control: public, max-age=31536000, immutable`. Verified by the same tests.
- A request under `assets/` for a missing file, which falls back to `index.html`, gets `no-cache`, never `immutable`. Verified by test.
- `/api/*` responses are unchanged (no `Cache-Control` added by this change). Verified by test.
- The built app sends these headers (manual `curl -I` against `node bin/jobtrack.js --no-open --port 0`).

## Analysis

Sources checked:

- `src/server/app.ts`, `src/server/index.ts` (`uiDir` resolution), `vite.config.ts`, `src/ui/public/`.
- `@hono/node-server` 2.1.6 `dist/serve-static.mjs` and `dist/serve-static.d.mts` (`onFound(path, c)` runs after the file is found, before the response is built, with the resolved file path).
- `test/server/api/app.test.ts` (static UI tests).
- `.agents/sow/specs/product-v1.md` (Runtime section; no current rule on caching).
- Pending SOWs: only SOW-0005 (v1 hardening backlog), which has no caching item.

Current state:

- No cache policy: browsers guess, and the guess keeps a stale `index.html`.

Risks:

- Users who already have a heuristically cached `index.html` from a version before this fix need one more hard refresh after upgrading to it; the old cached copy carries no `Cache-Control`. Unavoidable from the server side.
- `serveStatic` sends no 304, so `no-cache` re-sends `index.html` (about 1 KB) on every load. Negligible on loopback.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The static UI responses have no `Cache-Control`, only `Last-Modified`, so browsers apply heuristic freshness to `index.html`. After an upgrade, the cached `index.html` still references the previous hashed bundle, and the browser runs the old UI until a hard refresh bypasses the cache. Evidence: `src/server/app.ts` (`serveStatic` calls with no header options), `@hono/node-server` 2.1.6 `serve-static.mjs` (sets `Last-Modified`, no `Cache-Control`), RFC 9111 section 4.2.2.

Evidence reviewed:

- `src/server/app.ts`, `src/server/index.ts`, `vite.config.ts`, `src/ui/public/licenses/`, `test/server/api/app.test.ts`, `.agents/sow/specs/product-v1.md`, `.agents/skills/project-local-api/SKILL.md`, `.agents/skills/project-testing/SKILL.md`, pending SOW-0005, `@hono/node-server` 2.1.6 from npm (`dist/serve-static.mjs`, `dist/serve-static.d.mts`).

Affected contracts and surfaces:

- HTTP response headers for static UI files and the SPA fallback. No API route, schema, UI code or CLI flag changes.
- Spec `product-v1.md` Runtime section gains the cache rule.
- Skill `project-local-api` static-serving line gains the cache rule.

Existing patterns to reuse:

- `serveStatic`'s own `onFound` hook, so the header is set from the resolved file path (the fallback resolves to `index.html`, so a missing asset never gets `immutable`).
- The static UI test setup in `test/server/api/app.test.ts` (temporary `uiDir` with `index.html` and `assets/app.js`).

Risk and blast radius:

- Limited to static responses. `/api/*` is answered before `serveStatic` (the middleware in `app.ts` returns 404 JSON for unknown `/api` paths and the routers answer the rest), so no API response is touched.
- If a non-hashed file were ever placed under `assets/`, it would be cached for a year. Vite hashes everything it writes there; `src/ui/public/` files are copied to the root, not `assets/`. Recorded in the spec so later changes keep it true.
- No security impact: loopback only, no new routes, the traversal guard is unchanged.

Sensitive data handling plan:

- No user data is involved. Tests use invented file contents; the SOW cites file paths and header names only.

Implementation plan:

1. Add failing tests in `test/server/api/app.test.ts` for the headers on `/`, a client route, `/assets/app.js`, a missing `/assets/` file, a `licenses/` file, and an `/api` path.
2. In `src/server/app.ts`, pass an `onFound` hook to both `serveStatic` calls that sets `Cache-Control` to `public, max-age=31536000, immutable` when the resolved path is inside `<root>/assets/`, else `no-cache`.
3. Update `product-v1.md` (Runtime) and `.agents/skills/project-local-api/SKILL.md` (static UI line).

Validation plan:

- `npx vitest run test/server/api/app.test.ts` fails before step 2 and passes after.
- `npm run typecheck`, `npm test` (summary line recorded).
- `npm run build`, then `node bin/jobtrack.js --no-open --port 0 --data-dir .tmp/dev` and `curl -sI` on `/`, `/assets/<built js>` and `/api/health`.
- Independent reviewer pass on the diff (project rule: once per SOW).
- Same-failure search: `grep -rn "serveStatic\|Cache-Control" src bin` for other static responses.

Artifact impact plan:

- AGENTS.md: no change expected; no workflow or command changes.
- Runtime project skills: `project-local-api` static UI line updated with the cache rule.
- Specs: `product-v1.md` Runtime section gains the cache rule.
- End-user/operator docs: README has no section on browser caching or hard refresh (to be confirmed by grep at close).
- End-user/operator skills: none exist in this project.
- SOW lifecycle: single SOW; close as completed in `done/` with the work in one commit.

Open-source reference evidence:

- `@hono/node-server` 2.1.6, the published npm tarball (as locked in `package-lock.json`), `dist/serve-static.mjs` (header handling, `onFound` call after the file is found) and `dist/serve-static.d.mts` (`onFound?: (path, c) => void | Promise<void>`). Read from the installed package, not a git mirror; the lockfile's integrity hash pins it.

Open decisions:

- Resolved: 1A and 2A (see below).

## Implications And Decisions

1. How to fix the stale UI (2026-11-24): user chose **A**, cache headers: `no-cache` for `index.html`, the SPA fallback and other unhashed files; `public, max-age=31536000, immutable` for the content-hashed files under `assets/`. Rejected: B (`no-store` on everything, re-downloads fonts and JS on every load) and C (`Clear-Site-Data`, fragile and needs upgrade-state tracking).
2. Detecting a tab left open across an upgrade (2026-11-24): user chose **A**, not now. A normal reload is enough once 1A ships; a version check against `/api/health` is not part of this SOW.

## Plan

1. Tests first, then the `onFound` hook, then spec and skill.

## Execution Log

### 2026-11-24

- SOW created with decisions 1A and 2A.
- Tests first: five tests in `test/server/api/app.test.ts` failed (header `null`) before the change.
- Deviation in mechanism, not design: setting the header inside `onFound` did not work, because `@hono/node-server` 2.1.6 calls `onFound` after `c.body()` (`dist/serve-static.mjs`), and the header did not reach the response in `app.request` tests. `onFound` now records the resolved file in a `WeakMap` keyed by the context, and a middleware wrapping both `serveStatic` calls sets the header after `next()`. Header values and file rules are as decided in 1A.
- `README.md` update step now says to reload any app tab still open from before (decision 2A: a normal reload suffices once this ships).
- Reviewer findings handled (see Validation): code comment, spec and skill wording corrected; real-server test and two more API tests added.

## Validation

Acceptance criteria evidence:

- `no-cache` on `/`, `/index.html`, a client route, `/licenses/font.txt`, `/assets-other/b.js` and the fallback for `/assets/gone-1234.js`: `test/server/api/app.test.ts` ("static UI cache headers").
- `public, max-age=31536000, immutable` on `/assets/app.js` for GET, HEAD and a 206 range response: same file.
- No `Cache-Control` on `/api/health` and `/api/nope`: same file, and over a real connection in `test/server/index.test.ts` ("sends the UI cache headers over a real connection").
- Built app: see Real-use evidence.

Tests or equivalent validation:

- `npx vitest run test/server/api/app.test.ts`: 4 failed before the change (and the API test passed), all passed after.
- The real-server test was proven able to fail: with the header line disabled for one run it failed with `expected null to be 'no-cache'`; the file was restored byte for byte (`cmp`).
- `npm run typecheck`: exit 0.
- `npm test`: `Test Files  88 passed (88)`, `Tests  1512 passed (1512)`.
- `npm run build`: exit 0; its only warning is Vite's chunk-size notice for the UI bundle, which this change does not touch.

Real-use evidence:

- `node bin/jobtrack.js --no-open --port 0 --data-dir .tmp/sow-0056/data` (with `NO_UPDATE_NOTIFIER=1`), then `curl -sI`: `/` and `/profiles/x/jobs` gave `cache-control: no-cache`; `/assets/index-<hash>.js` gave `public, max-age=31536000, immutable`; `/assets/gone.js` gave the HTML shell with `no-cache`; `/licenses/manrope-OFL.txt` gave `no-cache`; `/api/health` had no `cache-control`. The server was stopped by its recorded PID.
- Not checked in a real browser across an actual upgrade; the header semantics are standard (RFC 9111 `no-cache` and `immutable`), and the curl check shows the headers on the wire.

Reviewer findings:

- Independent reviewer (subagent, fresh context) ran a real-server smoke test over GET, HEAD, 206, 416, the fallback, `assets-other/`, a different-case path, an encoded path and `/api`; no blocker.
- Should-fix 1: the comment, spec and skill said a header set in `onFound` is lost, but on the real server node-server's own `Response` keeps it. Fixed: all three now say it is lost under the standard `Response` and survives only through a node-server internal, which is why the middleware sets it.
- Should-fix 2: tests never reached node-server's `Response` path. Fixed: real-connection test in `test/server/index.test.ts`.
- Nit 3: a 416 on an asset carries the immutable header. Rejected: the file never changes under its hashed name, so the 416 is stable too.
- Nit 4: no test for the `+ sep` guard or for HEAD and range. Fixed: two tests added.

Same-failure scan:

- `grep -rn "serveStatic\|Cache-Control\|cache-control" src bin`: no other static response or cache header outside `src/server/app.ts`.
- `grep -rn "0.0.0.0" src bin`: one hit, `src/ui/format.ts:19`, a regex false positive (`1_000_000`); no bind address.

Sensitive data gate:

- The SOW, spec, skill, README and code comments contain file paths, header names and invented test contents only. Real-use evidence uses a throwaway `.tmp/` data folder and quotes no data from it.

Artifact maintenance gate:

- AGENTS.md: no change; no workflow, command or guardrail changed.
- Runtime project skills: `.agents/skills/project-local-api/SKILL.md` gains the "Static cache headers" rule and the `onFound` hazard.
- Specs: `.agents/sow/specs/product-v1.md` Runtime section gains the static UI cache rule.
- End-user/operator docs: `README.md` update instructions now say to reload a tab still open from before. No other README text covers caching or refreshing (`grep -n -i "refresh\|cache\|reload" README.md`).
- End-user/operator skills: none exist in this project (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: single SOW; `Status: completed` and the move to `done/` go in the same commit as the work.

Specs update:

- `product-v1.md` Runtime: cache rule, the `assets/` hashed-only constraint and the one-time hard refresh after upgrading from 0.5.0 or earlier.

Project skills update:

- `project-local-api`: cache rule and the `onFound` timing hazard, with both tests as evidence. `project-testing` unchanged: the existing "prove it can fail" rule was followed and no new harness was added.

End-user/operator docs update:

- `README.md` line on updating (reload a tab still open from before).

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- A library hook named `onFound` is not necessarily a hook that can change the response; `@hono/node-server` 2.1.6 calls it after `c.body()`, and whether a header set there survives depends on which `Response` class is global. Recorded in `project-local-api`.
- `app.request` tests run on the standard `Response`, the real server on node-server's own; response-header behaviour needs one real-connection test.

Follow-up mapping:

- Decision 2A (open-tab version check): rejected for now by the user, not deferred work.
- A missing `/assets/...` file is answered with the HTML shell and status 200 (pre-existing SPA fallback behaviour, unchanged here). Reported to the user as an opportunity; not tracked unless the user asks for it.

## Outcome

The static UI is served with `no-cache` on `index.html`, the SPA fallback and unhashed files, and `immutable` on the content-hashed files under `assets/`, so a new version shows on a normal load after an upgrade.

## Lessons Extracted

See Validation, Lessons; both are recorded in `.agents/skills/project-local-api/SKILL.md`.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
