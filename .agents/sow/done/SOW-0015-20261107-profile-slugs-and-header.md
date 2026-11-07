# SOW-0015 - Profile slugs in URLs, profile header, name rule

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered, validated and committed with the work (2026-11-07).

## Requirements

### Purpose

Make profile URLs readable and the current profile obvious, as a follow-up to SOW-0014 on the same unmerged branch (PR #7).

### User Request

"For each profile, create a slug (handle same profile slugs somehow), and use this slug to the url, not the id. Also, when user is in a profile, in the top left, show the profile name instead of "Job Tracker" (cap it if too long) and show a back icon." Then: "allow only letters and numbers for profile names (show relevant message under the input)".

### Assistant Understanding

Facts:

- Profile pages read the id from the URL (`src/ui/profile-route.ts:5-11`, `useProfileId` in 10 places, `profilePath` in 22).
- `ProfileScope` wraps all profile pages (`src/ui/App.tsx:54,66`).
- The sidebar header shows a briefcase and "Job Tracker" (`src/ui/components/Layout.tsx:140-142`); the profile name is a group label (149-151) and "Switch profile" a link (166).
- Profile names are any non-blank text up to 80 characters (`src/server/api/profiles.ts`), unique ignoring ASCII case; migration 3 named profiles after their first target role, so stored names may contain punctuation.

Inferences:

- A profile named "New" would get slug `new` and be shadowed by the `/profiles/new` route, so `new` must be reserved.
- ASCII-only `NOCASE` uniqueness lets names differing only in non-ASCII case or accents exist; their slugs collide, which decision 3 handles.

Unknowns:

- None blocking.

### Acceptance Criteria

- Every profile has a unique, stored slug; URLs are `/profiles/<slug>/...`; the API stays id-based and gains `GET /api/profiles/by-slug/:slug`. Verified by repo, API and UI tests.
- Slugs follow renames; clashes get `-2`, `-3`; `new` is never a slug; non-Latin letters are kept, accents dropped, empty results become `profile`. Verified by unit tests.
- Profile names allow letters and digits of any script and single spaces between words; the server answers 400 otherwise and the form shows the rule under the Name input. Existing invalid names are cleaned by migration 4. Verified by tests.
- Inside a profile the sidebar header is a link "← <profile name>" to the profiles screen, truncated to the sidebar width with the full name on hover; the profile group label and "Switch profile" are removed. Verified by Layout tests and a browser check.
- An unknown slug shows "Profile not found" with a link to the profiles screen; renaming on the edit page moves to the new slug. Verified by UI tests.

## Analysis

Sources checked:

- `src/ui/profile-route.ts`, `src/ui/App.tsx`, `src/ui/components/Layout.tsx`, `src/ui/components/ProfileForm.tsx`, `src/server/api/profiles.ts`, `src/server/db/profiles-repo.ts`, `src/server/db/migrations.ts`, SOW-0014.

Current state:

- See Facts.

Risks:

- Migration 4 changes stored names (only invalid ones) and adds a unique index; a bad backfill would block startup.
- Every UI link inside a profile changes from id to slug.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- URLs carry the profile UUID because SOW-0014 used the id as the route parameter. A stored, unique slug plus a slug lookup lets the UI use readable URLs while all data access stays on ids.

Evidence reviewed:

- Files under Analysis; SOW-0014 decisions and review findings; `project-local-api`, `project-testing` skills.

Affected contracts and surfaces:

- Schema (migration 4: `profiles.slug`, unique index; name cleanup), `Profile` type (`slug`), profiles repo (slug assignment, `getBySlug`), API (`GET /api/profiles/by-slug/:slug`, name rule 400), UI routes, `ProfileScope`, `Layout` header and nav, `ProfileForm` validation, every in-profile link, tests, spec, README, skills.

Existing patterns to reuse:

- Migration runner and JS `up` steps (SOW-0014); `ProfileShellContext` and `Layout` profile fetching; `HttpError`/zod bodies; `FieldDescription`/`FieldError` from `src/ui/components/ui/field.tsx`.

Risk and blast radius:

- Migration: computed in JS first (valid names kept, invalid ones cleaned and de-duplicated, then slugs), two-phase name update to avoid transient UNIQUE clashes, unique index created after backfill; tested on populated databases.
- Rename races: the API is id-based, so a rename never breaks an in-flight request.
- Bookmarks: a renamed profile's old URL shows "Profile not found" with a way back (decision 2A, accepted).

Sensitive data handling plan:

- Invented names only in tests and docs; no real data read.

Implementation plan:

1. Shared name and slug rules in `src/server/domain/profile-name.ts` (used by server and UI).
2. Migration 4, repo slug assignment and `getBySlug`, API lookup route and name validation.
3. UI: `Layout` resolves the slug and provides the profile; `ProfileScope` shows loading/not found; `useProfileId`/`useProfileHref`; links use slugs; rename navigates; header and nav changes; form validation.
4. Tests, spec, README, skills.

Validation plan:

- `npm test`, typecheck, build; migration tests (invalid names, clashes, slugs, reserved `new`); API tests (lookup, 400 rule, slug on create/rename); UI tests (slug links, not found, rename redirect, header, form message); browser check of the header and URLs.

Artifact impact plan:

- AGENTS.md: unaffected (no workflow change).
- Runtime project skills: `project-testing` (profile context in page tests, `insertTestProfile` slug), `project-local-api` (by-slug route ordering).
- Specs: `.agents/sow/specs/product-v1.md` Profiles and UI sections.
- End-user/operator docs: `README.md` Profiles section.
- End-user/operator skills: none exist.
- SOW lifecycle: close as completed in `done/` with the work, as a second commit on PR #7.

Open-source reference evidence:

- None; internal change.

Open decisions:

- All resolved; see below.

## Implications And Decisions

User answered "All recommended" twice on 2026-11-07.

1. **A** - API stays id-based; the UI resolves the slug once (`GET /api/profiles/by-slug/:slug`).
2. **A** - the slug follows the name on rename; old URLs fall back to "Profile not found".
3. **A** - clashes get `-2`, `-3`, ... in creation order.
4. **A** - slugs keep letters and digits of any script, lowercased, accents dropped; empty becomes `profile`.
5. **A** - the header is one link "← <name>" to the profiles screen, truncated by width with the full name on hover.
6. **A** - remove the profile group label and "Switch profile".
7. **A** - names allow letters, digits and single spaces between words.
8. **A** - letters and digits of any script.
9. **A** - migration 4 cleans invalid stored names (other characters become spaces, spaces collapse, empty becomes "Profile", clashes get " 2", " 3").

Assistant defaults stated and not objected to:

- Work goes in SOW-0015 on the same branch, added to PR #7.
- Hint "Letters, numbers and spaces only." always under Name; error "Use only letters, numbers and single spaces." under it while invalid; submit blocked; the server returns 400 with the same message.
- `new` is a reserved slug (found during analysis: it would be shadowed by `/profiles/new`).

## Plan

See Pre-Implementation Gate, Implementation plan.

## Execution Log

### 2026-11-07

- SOW created; baseline `npm test`: 500 passed.
- `src/server/domain/profile-name.ts`: name rule, cleaning, slug base, unique slug, reserved `new`; imported by the server and the UI (no Node imports).
- Migration 4 (`src/server/db/migrations.ts`): `slug` column, name cleanup with valid names kept first, two-phase rename through `~<id>` so the NOCASE unique index never trips, slugs in rowid order, `idx_profiles_slug`.
- `profiles-repo.ts`: `getBySlug`, slug on create and on rename; `profiles.ts`: `GET /by-slug/:slug` registered before the scoped router; zod name rule (NFC, trim, pattern).
- UI: `profile-route.ts` rewritten around `ProfileShellContext` (`useCurrentProfile`, `useProfileId`, `useProfileHref`, `profilePath(slug)`); `Layout` resolves the slug (decoded from the pathname), derives `status` so another slug's profile is never current, draws the header link and drops the group label and Switch profile; `ProfileScope` shows loading, "Profile not found" or the pages keyed by id; `ProfilePage` takes the profile from the shell and moves to the new slug; `ProfileForm` shows the hint/error under Name.
- Tests: `test/server/domain/profile-name.test.ts`, migration 4, repo and API slug tests, `test/ui/profile-shell.tsx` (`InProfile`), Layout, App, ProfilePage, ProfilesPage updates.
- Independent review (fresh reviewer, diff only):
  1. High, reproduced: renaming remounted the edit page and lost "Saved" because React Router 7 applies navigation in `startTransition` while the shell update was urgent. Fixed: both updates in one `startTransition`; the shell skips the lookup for a slug a page just handed over (tied to the version, so a later re-read still happens). `test/ui/App.test.tsx` "renames a profile in place" runs through the real shell and was confirmed to fail without the fix.
  2. Medium, reproduced: Indic names were rejected and would be damaged by migration 4 (vowel signs and viramas are combining marks). Fixed: marks allowed after a letter or digit; cleaning keeps them and drops only marks that start a word.
  3. Medium, reproduced: Hangul slugs were stored decomposed (NFKD), so typed URLs did not match; Japanese voiced marks were dropped. Fixed: only U+0300–U+036F accents are removed and the slug is recomposed to NFC.
  4. Low-medium: saving other fields could move a numbered slug. Fixed: the slug changes only when the name changes (an earlier "keep a numbered form of the base" idea was dropped because digits in a name look like clash numbers).
  5. Low, reproduced: cuts at 80 UTF-16 units could split a surrogate pair. Fixed: length and cuts count code points (`cutProfileName`), also in migration 4's clash suffix.
  6. Fixed: a 404 on re-reading the held profile's slug now clears it instead of staying `ready`.
  7. Rejected: case-insensitive slug lookup. The app only links to lowercase slugs; a mistyped capital shows "Profile not found" with a way back.

## Validation

Acceptance criteria evidence:

- Slugs stored, unique, used in URLs, API id-based with `by-slug`: `test/server/db/profiles-repo.test.ts`, `test/server/api/profiles.test.ts` ("profiles: slugs and names"), `test/ui/Layout.test.tsx`, `test/ui/App.test.tsx`, page tests asserting slug links and id calls.
- Rename, clash numbering, reserved `new`, scripts and accents: `test/server/domain/profile-name.test.ts`, repo tests (including "keeps the slug when other fields are saved"), migration 4 test.
- Name rule and message: domain tests, API 400 tests, `test/ui/ProfilePage.test.tsx` (hint as accessible description, error with `aria-invalid`, no submit).
- Header: `Layout.test.tsx` (back link name, href `/`, title with the full name, the truncated last span; "Job Tracker" only outside a profile; no Switch profile).
- Not found and rename navigation: `App.test.tsx` (unknown slug, percent-encoded Greek slug, in-place rename).

Tests or equivalent validation:

- `npm test`: `Test Files  52 passed (52)`, `Tests  544 passed (544)`; no warnings or `act(...)` lines.
- `npm run typecheck` clean; `--noUnusedLocals` clean apart from the pre-existing unused `Job` import (SOW-0005).
- `npm run build` succeeds.

Real-use evidence:

- Built app on a version-2 database file whose profile was named after the target role "SRE / Platform": migration 4 renamed it "SRE Platform" (slug `sre-platform`) with its 2 jobs, 1 application and 1 run intact. Over HTTP a Greek profile got slug `μηχανικος-λογισμικου`, "New" got `new-2`, and "SRE/Ops" was refused with the new message.
- Browser: opening the long-named profile went to `/profiles/a-very-long-profile-name-for-checking-how-the-sidebar-header-truncates-it`; the header showed "← A very long profile name for…" and the sidebar had no Switch profile; the percent-encoded Greek URL loaded that profile's edit form. Typing into the Name field was blocked by another installed browser extension's popup, so the live message was not checked in the browser; it is covered by the UI tests above.

Reviewer findings:

- See Execution Log: 1 high, 2 medium, 1 low-medium, 1 low fixed; 1 small fix; 1 rejected with reason.

Same-failure scan:

- `grep -rn "profilePath(\|useProfileId\|getProfile(" src/ui`: every in-profile link goes through `useProfileHref` or `profilePath(slug)`; `getProfile` by id is only exported by the client. No string slicing of names outside `cutProfileName`.

Sensitive data gate:

- Invented names only (`Platform roles`, `Data roles`, `Café`, Greek, Hindi, Tamil, Korean, Japanese sample words); the real data directory was not read.

Artifact maintenance gate:

- AGENTS.md: no update; workflow unchanged.
- Runtime project skills: `.agents/skills/project-local-api/SKILL.md` (by-slug route, ids for data routes, registration order), `.agents/skills/project-testing/SKILL.md` (`InProfile`, `TEST_PROFILE`, `insertTestProfile` slugs, App test re-import).
- Specs: `.agents/sow/specs/product-v1.md` (names, slugs, migration 4, by-slug route, UI routes, header, form message).
- End-user/operator docs: `README.md` Profiles section (name rule, addresses, header, upgrade note).
- End-user/operator skills: none exist.
- SOW lifecycle: status `completed`, moved to `.agents/sow/done/`, committed with the work as a second commit on PR #7.

Specs update:

- As listed above.

Project skills update:

- As listed above.

End-user/operator docs update:

- `README.md` as listed above.

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- React Router 7 applies navigation in a transition. A page that navigates and updates shared state at once must put both in one `startTransition`, or the urgent update renders first against the old URL.
- "Letters of any script" needs combining marks (`\p{M}`); accent stripping must be limited to the accent block and followed by NFC, or Indic and Hangul text breaks.
- Test pages that read shared shell state at least once through the real shell; the stub hid the rename remount.

Follow-up mapping:

- Implemented: all acceptance criteria and every confirmed review finding.
- Rejected: case-insensitive slug lookup (reason above).
- Tracked: nothing new; SOW-0005 still holds the profile GET/PUT round-trip item and the unused `Job` import.

## Outcome

Profile URLs use readable, unique slugs (`/profiles/platform-roles`), the API stays id-based, and inside a profile the top-left shows "← <profile name>" back to the profiles screen. Profile names allow letters, digits and single spaces in any script, with the rule shown under the Name field and enforced by the server; existing names were cleaned by migration 4.

## Lessons Extracted

See Validation, Lessons. The testing lesson is recorded in `project-testing` (pages are tested with `InProfile`, and `App.test.tsx` covers flows through the real shell).

## Followup

- None new. SOW-0005 (pending) keeps its existing items.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
