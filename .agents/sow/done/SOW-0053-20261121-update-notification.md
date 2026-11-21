# SOW-0053 - Notify when a newer npm version is available

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered with the 0.3.0 version bump in the same pull request (decision 10B).

## Requirements

### Purpose

Users run the app from a global npm install or `npx` and leave it running. They should learn that a newer release exists without watching the repository, so fixes such as the scoped Gmail sync reach them.

### User Request

"I want to show a notification to the UI when a new version of the npm package is available." Requested before the 0.3.0 release, on the 0.3.0 line. The user picked the recommended option for decisions 1-6 and 7B (also print a terminal notice).

### Assistant Understanding

Facts:

- The app knows its own version (`src/server/version.ts`, `APP_VERSION`) and returns it from `GET /api/health` (`src/server/api/setup.ts:12`); the Help & about menu shows it (`src/ui/components/HelpMenu.tsx`).
- The server's only outbound HTTP today is the job link check (`src/server/verify/links.ts`). The spec rules out the GitHub API (`product-v1.md`, Help & about), toasts and network UI assets.
- `https://registry.npmjs.org/job-applications-tracker/latest` answers 200 `application/json` (about 3 KB, `cache-control: max-age=300`) with a `version` field; an unknown package answers 404 (checked 2026-11-21).
- `NO_UPDATE_NOTIFIER` is the opt-out convention of `update-notifier` 7.3.1 (README: "setting the environment variable `NO_UPDATE_NOTIFIER` with any value").
- Settings are key/value rows with defaults (`src/server/db/settings-repo.ts`), so a new setting needs no migration.
- `docs/images/settings.png` shows the Runs and Server sections, where the new setting lives.

Inferences:

- Users on 0.2.0 are not told about 0.3.0; the notice first helps on the release after the one that ships it.
- A checkout whose version is older than npm's `latest` would show the banner in mock runs, screenshots and the demo video; those paths must turn the check off.

Unknowns:

- None that block implementation.

### Acceptance Criteria

- With the check on and npm's `latest` newer than the running version, the UI shows a dismissible banner and the Help & about menu shows the newer version; the terminal prints one notice. Verified by server and UI tests and a real run against a stub registry.
- Dismissing hides the banner until a still newer version appears; the Help & about line stays. Verified by UI tests.
- Unchecking "Check for updates" (Settings → Server) stops the checks and clears the notice; `NO_UPDATE_NOTIFIER` stops them regardless of the setting. Verified by server tests.
- A failed or slow request (offline, 404, bad JSON, timeout) shows nothing and never affects the rest of the app. Verified by server tests.
- Tests, `sandbox:mock` and `demo:video` make no request to npm. Verified by config and test evidence.

## Analysis

Sources checked:

- `src/server/version.ts`, `src/server/index.ts`, `src/server/app.ts`, `src/server/api/setup.ts`, `src/server/api/settings.ts`, `src/server/db/settings-repo.ts`, `src/server/domain/types.ts`, `src/server/runs/scheduler.ts`, `src/server/verify/links.ts`, `bin/jobtrack.js`.
- `src/ui/components/Layout.tsx`, `src/ui/components/HelpMenu.tsx`, `src/ui/pages/SettingsPage.tsx`, `src/ui/api/client.ts`, `src/ui/help-text.ts`.
- `vitest.config.ts`, `test/server/bin.test.ts` (`homeEnv` copies `process.env`), `test/server/index.test.ts`, `test/e2e/discovery-flow.test.ts`.
- `scripts/sandbox-mock/prepare.ts`, `scripts/demo-video/record.mjs`, `package.json` scripts and `engines` (`node >=22`).
- `.agents/sow/specs/product-v1.md` (User interface section), README (Settings screenshot, Security), pending SOW-0005 (no overlap).

Current state:

- No update awareness anywhere; the only cue is "Version x" in Help & about.

Risks:

- First self-initiated outbound request: must be documented and switchable.
- Test runs that start the real app (`startApp`, bin tests) could reach npm unless the env opt-out is set for them.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Nothing in the app compares its version with the published one, so users learn about releases only from GitHub or npm.

Evidence reviewed:

- Files listed under Analysis; registry endpoint probed with `curl` (status, content type, size only); `update-notifier` README via `npm view update-notifier readme` (version 7.3.1). No mirrored open-source repository was needed.

Affected contracts and surfaces:

- New `GET /api/update` (global, read-only).
- New setting `update_check` (boolean, default `true`) in `Settings`, `DEFAULT_SETTINGS`, the settings PATCH allow-list and Settings → Server.
- `startApp` option for the terminal notice; `bin/jobtrack.js` prints it.
- UI: `Layout` (banner), `HelpMenu` (dot and line), `SettingsPage`, `client.ts`, `help-text.ts`.
- Scripts: `sandbox:mock` (via `node --env-file`), `demo:video` (spawn env).
- Tests: vitest server project env; Layout, App, HelpMenu, Settings tests; new server tests.
- Docs: spec, README, `docs/images/settings.png`, `AGENTS.md`, `project-local-api` skill.

Existing patterns to reuse:

- `createSyncScheduler` (unref'd timer, `start`/`stop`/`refresh`, refresh after a settings PATCH).
- `verifyLink`'s injectable `fetchImpl` and `AbortSignal.timeout`.
- `ThemeMenu`'s `localStorage` use guarded by try/catch; `Alert` component; `WithInfo`/`FIELD_HELP` for the setting's help; `ExternalItem` links in Help & about.

Risk and blast radius:

- Regression risk is low: the checker is isolated; every failure path resolves to "no update known".
- Settings fixtures in tests gain a key (typecheck finds them).
- `Layout` gains one client call; every test that mocks the client for `Layout` must mock `getUpdate`.
- Privacy: the request carries no user data (no version, no id); npm sees the IP address and the package name.
- Windows: an inline `VAR=1` in npm scripts would break `cmd.exe`, so `sandbox:mock` uses `node --env-file` (Node >= 20.6; the package needs >= 22).

Sensitive data handling plan:

- No personal data involved. Tests use invented versions and a local stub registry. No real run logs.

Implementation plan:

1. Server module `src/server/update-check.ts`: `isNewerVersion` (plain x.y.z only), `fetchLatestVersion` (5 s timeout, zod-checked body, prerelease ignored), `createUpdateChecker` (first check 10 s after start, then every 24 h, unref'd; honours the setting and `NO_UPDATE_NOTIFIER`; `onUpdateAvailable` once per newer version; `refresh()` after settings change; `stop()` in shutdown).
2. Setting `update_check`, settings router allow-list and refresh; `GET /api/update` router; wiring in `startApp` (stop first in shutdown, also on bind failure); `formatUpdateNotice` printed by `bin/jobtrack.js`.
3. UI: `getUpdate` client; `UpdateBanner` in `Layout` (dismiss stored under `localStorage` `update-dismissed`); Help & about dot and line plus "What's new" link; Settings → Server checkbox with help.
4. Opt-outs for tests (`vitest.config.ts` server env), `sandbox:mock`, `demo:video`.
5. Tests, docs, spec, skill, screenshot, review.

Validation plan:

- Unit tests for compare, fetch (local `http.createServer` stub on 127.0.0.1) and checker timing (fake timers, injected fetch).
- API test for `GET /api/update` and the settings key; UI tests for banner, dismiss, Help & about and Settings.
- `npm test`, `npm run typecheck`, `npm run build`.
- Real run: built app with the registry URL pointed at a local stub, to see banner, menu and terminal notice; and a real run against npm to confirm no notice for the current version.
- Independent review once for the SOW.

Artifact impact plan:

- AGENTS.md: sandbox and demo notes say the update check is off there.
- Runtime project skills: `project-local-api` lists `/api/update` as global; `project-testing` notes the server env opt-out and the `getUpdate` mock for `Layout`.
- Specs: `product-v1.md` gains the update check (Help & about, banner, Settings, outbound request, terminal notice).
- End-user/operator docs: README (privacy note, Settings, `NO_UPDATE_NOTIFIER`), `docs/images/settings.png` retaken.
- End-user/operator skills: none exist (AGENTS.md: "Output/reference skills: none").
- SOW lifecycle: one SOW; closes with the work in one commit.

Open-source reference evidence:

- None checked; the `update-notifier` convention comes from its published README (npm, 7.3.1).

Open decisions:

- None. See Implications And Decisions.

## Implications And Decisions

User decisions, 2026-11-21:

1. A - The server checks `https://registry.npmjs.org/job-applications-tracker/latest`; the UI reads the result from the local API.
2. A - 10 s after start, then every 24 h while running; the result lives in memory; a failure shows nothing.
3. A - On by default; Settings → Server "Check for updates" (`update_check`); `NO_UPDATE_NOTIFIER` turns it off; `sandbox:mock`, `demo:video` and tests set it.
4. C - A dismissible banner on every page (dismissal per version in `localStorage`) plus a line in Help & about that stays.
5. A - "Version X is available (you have Y)", `npm i -g job-applications-tracker@latest` or `npx job-applications-tracker@latest`, restart, and a "What's new" link to the GitHub release tag.
6. A - Only npm's `latest` dist-tag, compared as plain x.y.z with a small tested function; no new dependency; prerelease versions ignored.
7. B - Also print a terminal notice when a newer version is found.

User decisions after implementation and review, 2026-11-21:

8. A - Commit the work with this SOW closed, push the branch and open a pull request.
9. A - Keep "a prerelease on either side is never offered" (review item 4): it matches decision 6A, and no prerelease has been published.
10. B - Bump the version to 0.3.0 in this pull request instead of a separate release pull request. After merge: tag `v0.3.0` on the merge commit, the GitHub pre-release, then the user's `npm publish`.

## Plan

See Implementation plan in the gate.

## Execution Log

### 2026-11-21

- SOW opened on branch `update-notification` from `main` at `052f050`.
- Server: `src/server/update-check.ts` (`isNewerVersion`, `fetchLatestVersion`, `formatUpdateNotice`, `createUpdateChecker`); `update_check` in `Settings`, `DEFAULT_SETTINGS` and the PATCH allow-list (PATCH also refreshes the checker); `GET /api/update` in `src/server/api/setup.ts`; `UpdateStatus` in `src/server/domain/types.ts` so the UI imports no Node types; `startApp` starts the checker after the scheduler and stops it first on close and on a failed bind; options `onUpdateAvailable` and test-only `updateCheck`; `bin/jobtrack.js` prints the notice.
- UI: `getUpdate` in `client.ts`; `UpdateBanner` (`role="status"`, dismissal under `update-dismissed`) in `Layout`; Help & about dot and "Update available" line (`releaseUrl`); Settings → Server "Check for updates" checkbox with ⓘ help; Server section intro updated.
- Opt-outs: `vitest.config.ts` server project env; `scripts/sandbox-mock/no-update-check.env` via `node --env-file` in `sandbox:mock`; `NO_UPDATE_NOTIFIER` in the demo recorder's spawn env.
- Implementation detail chosen within the decisions (no design change): `sandbox:mock` uses `node --env-file`, because an inline `NO_UPDATE_NOTIFIER=1` breaks npm scripts under `cmd.exe`.
- Version bumped to 0.3.0 in `package.json` and `package-lock.json` (decision 10B); nothing else names the version. The real-use runs in Validation were made at 0.2.0, before the bump.
- Review fixes (see Validation): `check()` catches everything; the in-flight guard is per generation; `Layout` also re-reads 16 s after load and on window focus; banner title not clipped; spec wording; gate names `isNewerVersion`.

## Validation

Acceptance criteria evidence:

- Newer version → banner, Help & about line, one terminal notice: `test/server/index.test.ts` ("reports a newer version and calls onUpdateAvailable once"), `test/server/update-check.test.ts` (announce once, again for a still newer one), `test/ui/Layout.test.tsx` ("Layout update notice"); real run below.
- Dismissal per version, Help & about line stays: `test/ui/Layout.test.tsx` ("dismissal hides the banner for that version only…").
- Setting off stops and clears; `NO_UPDATE_NOTIFIER` wins: `test/server/update-check.test.ts`, `test/server/index.test.ts` (PATCH `update_check: false` through the real server; env set → stub registry never hit), `test/server/api/settings.test.ts`, `test/ui/SettingsPage.test.tsx`.
- Failures show nothing: `fetchLatestVersion` returns null for 404, 500, HTML, a body without `version`, a prerelease, a timeout and a connection error; the checker keeps the last known version; a throwing notice or setting read raises no unhandled rejection (the test fails when the `catch` is removed, checked).
- No npm requests from tests, `sandbox:mock` and `demo:video`: server project env; `test/server/package.test.ts` guards the script, env file and recorder; `sandbox:mock` run below.

Tests or equivalent validation:

- `npm test`: `Test Files  84 passed (84)`, `Tests  1407 passed (1407)`, no warnings.
- `npm run typecheck`: clean. `npm run build`: succeeds.

Real-use evidence:

- Built app via `startApp` from `dist/server` with `updateCheck.registryUrl` at a local stub answering an invented `9.0.0`: the stub was hit once, the terminal printed the notice (`Job Applications Tracker 9.0.0 is available (you have 0.2.0). …`), `GET /api/update` returned `{"current":"0.2.0","latest":"9.0.0","available":true}`. In headless Chromium (scratch `playwright-core@1.58.0` under `.tmp/shots`) the banner showed in light and dark, the Help & about menu showed "Update available: 9.0.0", dismissal survived a reload, and Settings → Server showed the checkbox. With a 10 s first delay and no navigation, the banner appeared about 17 s after start (after the review fix).
- `node bin/jobtrack.js` against the real npm registry (this checkout is 0.2.0, the published `latest`): `latest` null at start, `{"current":"0.2.0","latest":"0.2.0","available":false}` 11 s later, no terminal notice.
- `node --env-file=scripts/sandbox-mock/no-update-check.env bin/jobtrack.js --data-dir .tmp/sandbox-mock`: `latest` still null after 12 s, so no request was made.
- The bin's own `onUpdateAvailable` wiring cannot be pointed at a stub (no user-facing registry override by design); it is three lines, and `formatUpdateNotice` and the `startApp` callback are tested.

Reviewer findings:

- Independent reviewer (subagent, read-only), no high findings:
  1. Medium, banner missed first load (browser opens before the 10 s check; UI re-read only on navigation) → fixed: re-read 16 s after load and on window focus; tests added; verified in Chromium.
  2. Low, unticking the setting leaves the banner until the next navigation → rejected: it disappears on the next navigation or focus, and ticking it on cannot show anything sooner than the server's 10 s check anyway.
  3. Low, `check()` had no `catch` (unhandled rejection could end the process) → fixed, with a test.
  4. Low, a prerelease install is never told about a stable release → kept: matches decision 6A as written in the spec; no prerelease has been published (npm versions 0.1.0, 0.2.0). The user confirmed (decision 9A).
  5. Low, focus falls to `<body>` after dismissing; title `line-clamp-1` → title clamp removed; focus left as is (the banner is gone, nothing sensible to focus; same as other dismissible notices).
  6. Low, test gaps (bin wiring, fixed 100 ms negative wait, how the stub run was done) → bin wiring and stub method recorded honestly above; the fixed wait is a negative check and stays.
  7. Nit, a stale in-flight request could skip a new first check → fixed (per-generation guard), with a test.
  8. Nit, `npm run dev:server` asks npm → rejected: a source checkout is normally at or past `latest`, so it shows nothing; decision 3 does not list it.
  9. Nit, spec sentence contradicted itself; gate named `compareVersions` → fixed.

Same-failure scan:

- Other `startApp` callers: `test/server/index.test.ts` (env replaced → `NO_UPDATES`), `test/e2e/discovery-flow.test.ts` and bin tests (inherit the project env), `scripts/demo-video/record.mjs` (env set), `bin/jobtrack.js` (wired).
- Other `Layout` renderers mocking the client: `test/ui/Layout.test.tsx`, `test/ui/App.test.tsx` (both mock `getUpdate`).
- `grep -rn "0.0.0.0" src bin`: one false positive (`1_000_000` in `src/ui/format.ts`); no bind change.

Sensitive data gate:

- Durable artifacts hold invented versions (`9.0.0`, `10.0.0`, `999.0.0`) and public URLs only; no run logs, no personal data. The README screenshot `docs/images/settings.png` was inspected: Runs and Server sections only (no Agent command paths, no data directory).

Artifact maintenance gate:

- AGENTS.md: updated (`sandbox:mock` and `demo:video` notes).
- Runtime project skills: `.agents/skills/project-local-api/SKILL.md` (global `/api/update`, checker, shutdown order, update rule) and `.agents/skills/project-testing/SKILL.md` (env opt-out, stub pattern, `getUpdate` mock) updated.
- Specs: `.agents/sow/specs/product-v1.md` gains "Update check (SOW-0053)", the Help & about addition and the banner exception to "No toasts".
- End-user/operator docs: README (Install, Security, Command line, Interface) and `docs/images/settings.png` retaken; in-app help (`FIELD_HELP.updateCheck`, Server intro). The demo video needs no re-recording: its path never opens Settings, and with the check off the sidebar is unchanged.
- End-user/operator skills: none exist (AGENTS.md: "Output/reference skills: none").
- SOW lifecycle: single SOW; status and move to `done/` go in the closing commit with the work.

Specs update:

- See Artifact maintenance gate.

Project skills update:

- See Artifact maintenance gate.

End-user/operator docs update:

- See Artifact maintenance gate.

End-user/operator skills update:

- None exist.

Lessons:

- A background check that first runs after the browser opens needs the UI to read again later; "on load and on navigation" misses a user who stays on one page.
- Chromium puts a space before an absolutely positioned `sr-only` span in an accessible name ("Help & about , update available"); jsdom does not. Browser scripts should match such names with a pattern.

Follow-up mapping:

- Review items 2, 5 (focus), 6, 8: rejected with reasons above. Item 4: kept, confirmed by the user (decision 9A). No deferred work.

## Outcome

Implemented: the app checks npm 10 s after start and daily, shows a dismissible banner, a Help & about line and a terminal notice, and can be turned off in Settings → Server or with `NO_UPDATE_NOTIFIER`. Users on 0.2.0 are not told about 0.3.0; the notice first helps on the release after the one that ships it.

## Lessons Extracted

See Validation → Lessons.

## Followup

None.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
