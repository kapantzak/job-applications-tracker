# SOW-0059 - Default profile

## Status

Status: completed

Sub-state: delivered with decisions 1A-6A; reviewed, validated and closed.

## Requirements

### Purpose

Let the user land on the profile they use most when the app starts, instead of the profiles screen every time.

### User Request

GitHub issue #50 "Default profile": "The user should be able to set their default profile, which would be opened by default on launch. If only one profile exists, this would be the default one."

### Assistant Understanding

Facts:

- `bin/jobtrack.js:139` opens the browser at the bare app URL, so a launch always loads `/`.
- `/` renders `StartupRedirect` (`src/ui/App.tsx`), which runs once per page load (module flag `startupChecked`), sends the user to `/setup` when the chosen agent is not installed and otherwise shows the profiles screen.
- `/` is also the target of the sidebar "Profiles" link and of Setup's continue link (comment in `App.tsx`), so anything that leaves `/` must run once per page load, or the profiles screen becomes unreachable.
- Global choices live in the key/value `settings` table (`src/server/db/settings-repo.ts`); `DEFAULT_SETTINGS` is the allow-list of keys; each Settings section PATCHes only its own keys (`src/ui/components/SettingsSection.tsx`).
- Profile cards (`src/ui/pages/ProfilesPage.tsx`) show Open, Edit and Delete; nothing marks a default.
- `profilesRepo.remove` deletes every row a profile owns in one transaction (`src/server/db/profiles-repo.ts`).

Inferences:

- A stored id can go stale only if a profile disappears; deleting through the app clears it, so a stale id means a hand-edited database and is ignored on read.

Unknowns:

- None.

### Acceptance Criteria

- A stored default (`default_profile_id`) that names an existing profile makes the first load of `/` open that profile's Dashboard (`/profiles/<slug>`), after the Setup check. Verified by `test/ui/App.test.tsx`.
- With no valid stored default and exactly one profile, the first load of `/` opens that profile. With no valid stored default and two or more profiles, `/` shows the profiles screen. Verified by `test/ui/App.test.tsx` and `test/ui/default-profile.test.ts`.
- After the jump, the sidebar Profiles link shows the profiles screen (no trap). Verified by `test/ui/App.test.tsx`.
- A missing agent still goes to Setup first, and no jump follows. Verified by the existing Setup test plus a default set.
- The profiles screen shows a "Default" badge on the effective default, "Set as default" on the other profiles when there are two or more, and "Remove default" on the stored default when there are two or more. Verified by `test/ui/ProfilesPage.test.tsx`.
- `PATCH /api/settings` accepts `default_profile_id` as `''` or an existing profile id, and answers 400 for an unknown id. Verified by `test/server/api/settings.test.ts`.
- Deleting the stored default profile clears the setting in the same transaction; deleting another profile keeps it. Verified by `test/server/db/profiles-repo.test.ts`.

## Analysis

Sources checked:

- `src/ui/App.tsx`, `src/ui/pages/ProfilesPage.tsx`, `src/ui/profile-route.ts`, `src/ui/api/client.ts`, `src/ui/components/SettingsSection.tsx`.
- `src/server/db/settings-repo.ts`, `src/server/api/settings.ts`, `src/server/db/profiles-repo.ts`, `src/server/api/profiles.ts`, `src/server/api/errors.ts`, `src/server/domain/types.ts`.
- `bin/jobtrack.js`, `scripts/sandbox-mock/seed.ts`.
- `test/ui/App.test.tsx`, `test/ui/ProfilesPage.test.tsx`, settings and profile repo/API tests.
- `.agents/sow/specs/product-v1.md` (Profiles, Routes), pending SOW-0005 (no overlap).

Current state:

- No default concept exists; launch always shows the profiles screen.

Risks:

- Redirect loop or trap on `/`: mitigated by the existing once-per-load flag and a test.
- Settings consumers that build a full `Settings` object (tests, seed) need the new key; typecheck finds them.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The app has no notion of a preferred profile; `StartupRedirect` only knows about Setup, so launch always shows the profiles screen.

Evidence reviewed:

- Code and tests listed under Analysis; the spec's Profiles and Routes sections; GitHub issue #50.

Affected contracts and surfaces:

- Settings API and table: new key `default_profile_id` (string, default `''`).
- Profile delete transaction: also clears the setting when it names the profile.
- UI: `StartupRedirect` (first load of `/`), profiles screen cards.
- Spec (Profiles, Routes), README (profiles section), README screenshot of the profiles screen if it shows cards.

Existing patterns to reuse:

- `DEFAULT_SETTINGS` and the strict zod `SettingsPatch`; `HttpError(400, ...)` with the `field: message` format.
- `deleteSteps` in `profiles-repo.ts`.
- `profilePath()` for the redirect target; `Badge` and `Button` from `src/ui/components/ui/`.
- `test/ui/App.test.tsx` fresh-module-per-test pattern for the once-per-load flag.

Risk and blast radius:

- No migration; the new key falls back to `''` for every existing database.
- The profiles repo now touches one `settings` row; kept inside its delete transaction so it can never point at a deleted profile.
- A reload of `/` (or typing the bare URL) also jumps to the default; accepted with decision 3A, the same as the Setup check today.
- After Setup's continue link (same page load) no jump happens; consistent with once-per-load.

Sensitive data handling plan:

- No personal data involved; tests use invented profile names and ids.

Implementation plan:

1. Server: `default_profile_id` in `Settings`, `DEFAULT_SETTINGS`, `SettingsPatch`; existence check in the PATCH handler; delete step in `profiles-repo.ts`. Tests first.
2. UI: pure `defaultProfile(profiles, storedId)` in `src/ui/default-profile.ts`; `StartupRedirect` loads profiles and settings after the Setup check and redirects; ProfilesPage loads settings and shows the badge and actions. Tests first.
3. Spec, README, sandbox seed check, screenshot check.

Validation plan:

- `npm run typecheck`, `npm test`, `npm run build`.
- Real use: `npm run sandbox:mock`, set a default, reload a new tab at `/`, check jump and Profiles link.
- One independent review before close; same-failure scan for other code that builds a full `Settings` object.

Artifact impact plan:

- AGENTS.md: no change expected (no new command or workflow).
- Runtime project skills: no change expected unless a new test hazard shows up.
- Specs: `product-v1.md` Profiles and Routes sections.
- End-user/operator docs: README profiles section.
- End-user/operator skills: none exist (AGENTS.md lists none).
- SOW lifecycle: single SOW, closes with the work in one commit.

Open-source reference evidence:

- None checked; the change is internal to this app.

Open decisions:

- Resolved, see below.

## Implications And Decisions

User decisions, 2026-11-28:

1. Storage: **A**, a server setting `default_profile_id` (`''` = none), validated against existing profiles, cleared when that profile is deleted.
2. Single profile: **A**, computed: the stored id when it names an existing profile, else the only profile when exactly one exists; nothing is written.
3. When the jump happens: **A**, in the UI on the first load of `/` per page load, after the Setup check, to the profile's Dashboard.
4. Where it is set: **A**, on the profile cards: "Default" badge, "Set as default", "Remove default".

User decisions after the independent review, 2026-11-28:

5. When the jump may happen: **A**, only when the page load starts at `/` (a launch or the bare address). The review found that the once-per-load flag is set only when `/` renders, so a load that started on an inner page jumped on the first click of Profiles or "← name". The Setup check keeps its existing behaviour (option B, changing it too, was declined as outside this issue).
6. Screenshot reproducibility: **A**, the AGENTS.md screenshot note gains the extra step (Set as default on Backend Engineering before capturing `profiles.png`); the sandbox seed stores no default, so `sandbox:mock` still opens on the profiles screen.

## Plan

1. Server setting, validation, delete cleanup (tests first).
2. UI helper, startup redirect, profile cards (tests first).
3. Docs, spec, sandbox and screenshot checks, review, close.

## Execution Log

### 2026-11-28

- SOW created after the user's decisions 1A-4A. Numbered 0059: it was created as 0057, renamed to 0058 because a parallel worktree held an uncommitted SOW-0057, and renamed to 0059 when merging `main` into the PR branch after PR #52 landed SOW-0057 and a pending SOW-0058.
- Server: `default_profile_id` in `Settings` (`src/server/domain/types.ts`), `DEFAULT_SETTINGS` (`src/server/db/settings-repo.ts`) and the strict `SettingsPatch` (`src/server/api/settings.ts`), with an existence check that throws `HttpError(400, 'default_profile_id: Profile not found')` before any write; a delete step in `src/server/db/profiles-repo.ts` (`DELETE FROM settings WHERE key = 'default_profile_id' AND value = json_quote(@id)`, inside the existing `remove` transaction; values are stored with `JSON.stringify`).
- UI: `defaultProfile()` in `src/ui/default-profile.ts`; `StartupRedirect` (`src/ui/App.tsx`) looks up profiles after the Setup check; `ProfilesPage` loads the setting with the list and shows the badge and the Set/Remove buttons.
- Real-browser check on `npm run sandbox:mock`: the "Default" badge made its title row about 6 px taller than the others; `-my-1` on the badge keeps the card heights unchanged. `docs/images/profiles.png` re-taken with Backend Engineering as default.
- Independent review (general-purpose subagent, given the diff and the decisions, not my conclusions). Findings and handling below; finding 1 led to user decisions 5A and 6A, recorded before the fix: `App` now records the path the page load began at and passes `openDefault` to `StartupRedirect`.

## Validation

Acceptance criteria evidence:

- Stored default opens its Dashboard on a load that starts at `/`, after the Setup check: `test/ui/App.test.tsx` "opens the stored default profile on the first load of /, and the Profiles link then shows the list".
- Lone profile opens without a stored default, and several profiles without a valid default stay on the list: "opens the only profile when no default is stored", "shows the profiles screen for several profiles without a valid default"; `test/ui/default-profile.test.ts`.
- No trap: the Profiles and "← name" links reach the list after a jump, and loads that began on `/settings` or a profile page never jump (decision 5A): the two `it.each` cases "does not jump when the page load started on …".
- Missing agent goes to Setup and no jump follows: "sends a missing agent to Setup instead, and does not jump later in the same load".
- Cards: badge, Set as default, Remove default, failure message, lone profile, reload after delete, settings failure, error cleared on reload: `test/ui/ProfilesPage.test.tsx` "ProfilesPage default profile (SOW-0059)" (9 tests).
- API: `test/server/api/settings.test.ts` "default profile setting (SOW-0059)" (store and clear, unknown id 400 with nothing written, non-string 400).
- Delete cleanup: `test/server/db/profiles-repo.test.ts` (clears for its own profile, keeps for another).

Tests or equivalent validation:

- `npm test`: `Test Files  89 passed (89)`, `Tests  1536 passed (1536)`; no `act(...)` warnings.
- `npm run typecheck`: no errors. `npm run build`: built; its "chunks larger than 500 kB" warning was there before this change (the UI bundle is 688 kB, far over the limit regardless of this change).
- Tests proven able to fail: removing the delete step fails "clears the default profile setting when that profile is deleted"; removing `startupChecked = true` fails the two trap tests; the two deep-link tests failed before the decision-5A fix ("Unable to find role=\"heading\" and name \"Profiles\"").

Real-use evidence:

- `npm run sandbox:mock` (5 invented profiles) driven by Playwright (scratch install under `.tmp/pw`, cached Chromium): no default → stays on `/` with 5 Set as default buttons; Set as default stores the id; a new tab at `/` lands on `/profiles/backend-engineering`; "Back to profiles" and the sidebar Profiles link stay on `/`; Remove default stores `""` and the next launch stays on `/`; a load at `/settings` then Profiles stays on `/`; a load at another profile's Jobs then "Back to profiles" stays on `/`.

Reviewer findings:

- 1 (important) The jump fired on the first visit to `/` in a load that began elsewhere, so the first click on Profiles after a deep-link load opened the default profile. Confirmed; user decision 5A; fixed in `src/ui/App.tsx` with two regression tests; spec text corrected.
- 2 (nit) A settings failure blanked the profiles screen. Fixed: the setting falls back to `''` and the cards still render; test added.
- 3 (nit) A failed default change kept its error after a reload. Fixed: `load()` clears it; test added.
- 4 (nit) Default recomputed per card. Fixed: computed once per render.
- 5 (nit) Screenshot not reproducible from the seed alone. User decision 6A: AGENTS.md screenshot note gains the step; seed unchanged.
- 6 (nit) SOW named the helper `effectiveDefaultProfile`. Fixed to `defaultProfile`.

Same-failure scan:

- `grep -rnE "Settings = \{|: Settings( |\)|;|,)" src scripts test`: only `DEFAULT_SETTINGS` builds a full `Settings`; every other use reads single keys, and the UI saves settings per section (`SettingsSection.getPatch`), so no code re-sends a stale `default_profile_id`.
- Other redirects that run once per load: only `StartupRedirect` (`grep -n "startupChecked" -r src/ui`). Its Setup branch keeps the pre-existing first-visit behaviour (decision 5A, option B declined).
- Other profile delete paths: only `profilesRepo.remove` deletes profiles.
- `grep -rn "0.0.0.0" src bin`: nothing.

Sensitive data gate:

- Durable artifacts contain no secrets, credentials, personal data or customer data. Test data uses invented profile names and ids; `docs/images/profiles.png` shows only the sandbox's invented profiles (checked by eye). The SOW cites file paths only.

Artifact maintenance gate:

- AGENTS.md: updated, README screenshot note (how `profiles.png` shows a default; decision 6A).
- Runtime project skills: updated `.agents/skills/project-testing/SKILL.md` (Bad Practices: test startup redirects from a load that starts on an inner route). `project-local-api` unchanged: no new route, the guard and error mapping are unchanged (the 400 uses the existing `HttpError`). `project-agent-adapter` not affected (no agent code touched).
- Specs: `.agents/sow/specs/product-v1.md` Profiles (new Default profile bullet, delete bullet) and Routes (launch jump and cards).
- End-user/operator docs: README (Quick start step 3, Profiles section bullet, screenshot alt text) and `docs/images/profiles.png`.
- End-user/operator skills: none exist (AGENTS.md lists "Output/reference skills: none").
- SOW lifecycle: single SOW; `Status: completed` and the move to `done/` are committed with the work in one commit.

Specs update:

- `.agents/sow/specs/product-v1.md`, Profiles and Routes sections.

Project skills update:

- `.agents/skills/project-testing/SKILL.md`, as above.

End-user/operator docs update:

- README and `docs/images/profiles.png`. The demo video is unaffected: `scripts/demo-video/record.mjs` loads the page once with no profile and navigates inside the app.

End-user/operator skills update:

- None exist.

Lessons:

- A once-per-load check that lives in the component of one route also runs when a load that began elsewhere reaches that route later; test redirects from deep-link loads (recorded in project-testing).
- Check sibling worktrees for SOW numbers before naming a SOW: a parallel session can hold an uncommitted one.

Follow-up mapping:

- The Setup check's first-visit behaviour (decision 5A option B): explicitly rejected by the user as outside this issue; it predates this SOW and is not changed.
- No other deferred items.

## Outcome

Issue #50 delivered. The user marks a profile as default from its card; launching the app (a load that starts at `/`) opens that profile's Dashboard, a lone profile opens by default, and the profiles screen stays reachable from every link back. The setting is cleared with its profile.

## Lessons Extracted

- See Lessons above; the redirect-testing lesson is in `.agents/skills/project-testing/SKILL.md`.

## Followup

None. The only declined option (Setup check timing) is recorded under Follow-up mapping.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
