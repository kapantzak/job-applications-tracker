# SOW-0024 - Replace or add a CV on an existing profile, with a review screen

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered on branch `replace-cv` (2026-11-08); decisions 16-20 and 30-39 implemented.

## Requirements

### Purpose

Let the user keep a profile current with their CV: upload a newer CV (or a first one for a profile that has none), see what the agent would change, and choose field by field. Second half of GitHub issue #12 as scoped on 2026-11-07.

### User Request

Decisions given on 2026-11-07 during SOW-0023 planning: "11.B" (Replace CV re-analyses and suggests changes to the existing profile), "15.B, 16.A, 17.A, 19.A, 20.A". Started on 2026-11-08: "merge it and then start with the next SOW".

### Assistant Understanding

Facts:

- SOW-0023 shipped the pieces this reuses: extraction (`src/server/cv/extract.ts`), the `analyse_cv` task and prompt v1 (`prompts/analyse_cv.md`), one global analysis row (`cv_analyses`, `src/server/db/cv-analyses-repo.ts`), the service (`src/server/cv/service.ts`), the upload card, the analysis card and the polling hook (`src/ui/components/CvUploadCard.tsx`, `CvAnalysisCard.tsx`, `src/ui/hooks/use-cv-analysis.ts`).
- The analysis row has no link to a profile (`src/server/db/migrations.ts:165-176`); `service.start()` refuses a second analysis of any kind (`service.ts:82-86`).
- `service.createProfile()` moves `cv.<type>` and `cv-text.txt` from `cv-analyses/<id>/` to `profiles/<id>/` with a move-back on failure (`service.ts:213-245`). Replacing needs the same, plus keeping the old files until the database write succeeds; the old file may have another extension (PDF replaced by DOCX).
- `PUT /api/profiles/:pid` takes the strict `ProfileBody` with no analysis id (`src/server/api/profiles.ts:36,101-106`).
- `ProfileCvCard` renders nothing when the profile has no CV (`src/ui/components/ProfileCvCard.tsx:28`); the Profile page is the card plus `ProfileForm` keyed by the profile id (`src/ui/pages/ProfilePage.tsx:18-34`).
- The prompt asks for empty lists, empty seniority and `remote: any` when the CV says nothing (`prompts/analyse_cv.md:22-24`); discovery passes the profile fields to the agent as text (`src/server/services/discovery.ts:95-105`) and a field left open counts as a pass in the fit checks (spec, Agent integration).
- Name, notes and excluded companies are never suggested on an existing profile (decision 17.A); the draft still carries `name` and `notes` from the same prompt and they are ignored.

Inferences:

- Comparing whole lists exactly would flag a list whose items only moved or changed case; a list the user curated would be replaced wholesale unless a merge choice exists (decision 36).

Unknowns:

- None that investigation can settle; the open product choices are decisions 30-36.

### Acceptance Criteria

- From the Profile page, "Replace CV" (or "Add CV" when the profile has none) runs the same upload, analyse and progress flow as SOW-0023.
- A review screen lists only fields whose suggestion differs from the current value, current and suggested side by side, each with Keep current / Use suggested; Apply copies the choices into the form; Save persists them (decision 16.A).
- Only target roles, locations, remote, seniority and keywords can be suggested; name, excluded companies and notes are never touched (decision 17.A).
- The new CV replaces the old one only when the user applies and saves; Cancel or leaving keeps the old CV (decision 19.A).
- For a profile without a CV, only empty fields are filled, listed for review (decision 20.A).

## Analysis

Flow as understood (subject to decisions 30-36):

1. Profile page: the CV card shows Download / Replace CV / Remove CV, or "No CV" with Add CV.
2. Replace or Add opens the SOW-0023 upload card in place; Analyse CV starts an analysis tied to this profile.
3. The card shows the progress state, then "Review changes".
4. The review lists the differing fields (Replace) or the empty fields the CV can fill (Add), each with Keep current / Use suggested.
5. Apply returns to the profile form with the chosen values filled in and a note that Save keeps them and the new CV.
6. Save sends the form plus the analysis id; the server swaps the CV files, writes the profile and deletes the analysis in one transaction, restoring the old files on any failure.

Assistant calls (not product decisions; told to the user on 2026-11-08, no objection):

- C1. Routes: the global `/api/cv-analysis` routes keep serving the new-profile analysis (`profile_id` null). A profile's analysis lives under `/api/profiles/:pid/cv-analysis` (`GET`, `POST` upload, `POST /retry`, `DELETE`), so the ownership middleware applies and another profile's analysis is never reachable.
- C2. Save: `PUT /api/profiles/:pid` accepts an optional `cv_analysis_id`; it must name a `succeeded` analysis of that profile (409 otherwise). `POST /api/profiles` refuses an analysis tied to a profile (409).
- C3. Deleting a profile stops its running analysis and deletes the analysis row (in the same transaction as the profile) and its files.
- C4. File swap without touching the old CV before the database points at the new one: the new files move into the profile folder as `cv.<type>.new` and `cv-text.txt.new`; one transaction updates the profile fields, the CV columns and deletes the analysis; then the `.new` files are renamed over the final names and a `cv.<other type>` left from the old CV is deleted. A failure before the commit moves the `.new` files back to the analysis folder. At start-up, `.new` files whose analysis row still exists (and lacks its files) go back to that analysis; otherwise the rename is completed.
- C5. For Add CV, "empty" means an empty list, empty seniority and `remote: any` (the default).
- C6. When nothing differs, the panel says the profile already matches the CV; Apply is still offered so Save stores the new CV.
- C7. Seniority is compared as the form saves it (`joinSeniority(splitSeniority(...))`).
- C8. A profile's analysis is shown on its Profile page; the Profiles list shows a badge on that profile's row (running, ready to review, failed); the New profile screen shows only the new-profile analysis.
- C9. The form exposes a small handle (`values()`, `apply(patch)`) so the panel can read the form's current values and write the choices back without moving the form state out of `ProfileForm`.

## Pre-Implementation Gate

Status: ready (decisions 16-20 and 30-38 recorded)

Problem / root-cause model:

- Not a defect: new behaviour. The SOW-0023 analysis only knows how to become a new profile. It needs an owner (a profile or none), a comparison with that profile, a review screen, and a save path that replaces the stored CV atomically.

Evidence reviewed:

- SOW-0023 (done) decisions 11-29 and A-calls; spec `.agents/sow/specs/product-v1.md` "Profiles from a CV (SOW-0023)".
- Code: `src/server/cv/service.ts`, `src/server/cv/draft.ts`, `src/server/db/cv-analyses-repo.ts`, `src/server/db/profiles-repo.ts`, `src/server/db/migrations.ts` (migration 6), `src/server/api/cv-analysis.ts`, `src/server/api/profiles.ts`, `src/server/services/discovery.ts`, `prompts/analyse_cv.md`, `src/ui/pages/ProfilePage.tsx`, `src/ui/pages/ProfilesPage.tsx`, `src/ui/components/{ProfileCvCard,ProfileForm,CvUploadCard,CvAnalysisCard,CreateProfileFlow}.tsx`, `src/ui/hooks/use-cv-analysis.ts`, `src/ui/api/client.ts`.
- Project skills loaded: project-local-api, project-testing, project-agent-adapter.
- SOW-0005 (pending backlog): no overlap; its profile round-trip note concerns `created_at` on PUT, which this SOW does not change.

Affected contracts and surfaces:

- DB: migration 7 adds `cv_analyses.profile_id` (nullable, references `profiles(id)`); `NULL` is the new-profile analysis.
- API: new `/api/profiles/:pid/cv-analysis` routes (C1); `PUT /api/profiles/:pid` gains optional `cv_analysis_id`; `POST /api/profiles` refuses a profile-tied analysis; analyses return `profile_id`; profile list items gain `cv_analysis_status`; profile delete discards its analysis.
- Service: every method takes the owner (profile id or null); several agents may run (one per owner); new `applyToProfile()`; start-up recovers `.new` files (C4).
- UI: `ProfileCvCard` (Replace / Add), a new review component, `ProfilePage` modes, `CvAnalysisCard` and `PendingCvAnalysis`/`CreateProfileFlow` showing where a tied analysis belongs, client functions.
- Docs: README CV section, spec section, project-local-api skill (routes), project-testing skill if the harness changes.

Existing patterns to reuse:

- `CreateProfileFlow` modes (choose / review) and its stale-refresh on 404/409; `createProfile()` move-and-move-back; `requireUsableAgent`; `bodyLimit` and `X-File-Name` parsing in `cv-analysis.ts`; `splitSeniority`/`joinSeniority`; the harness `agentRun` stub and `waitFor`; in-memory CV fixtures.

Risk and blast radius:

- Data loss: the swap must never leave a profile pointing at a missing file or delete the old CV before the new one is committed (C4; tested with an injected failure).
- Regression of SOW-0023: the new-profile path must keep working; existing tests stay and a profile-tied analysis must never become a new profile.
- Migration 7 is add-column only; existing rows get `NULL` (a new-profile analysis).
- URL stability: name is never changed by the review (17.A), so the slug does not move.
- Discovery quality: field values the user applies reach the next discovery prompt; decision 31 controls whether a CV that is silent on a field can loosen it.

Sensitive data handling plan:

- Same as SOW-0023: invented CVs built in memory by `test/fixtures/cv-files.ts`; no real CV text, names or run logs in durable artifacts. Real-use checks use an invented CV under `.tmp/`.

Implementation plan (assuming the recommended options; revised after decisions):

1. Migration 7 and repos: `cv_analyses.profile_id`; repo queries by owner; profile delete removes the profile's analysis rows; list items carry `cv_analysis_status`.
2. Service: owner-aware `current/start/retry/discard`, a map of running agents (37.B), `applyToProfile()` with the C4 swap and start-up recovery, `detachProfile()` for profile delete; Create profile refuses a tied analysis.
3. API: profile-scoped analysis router (shared code with the global one), PUT with `cv_analysis_id`, delete path; client functions.
4. Comparison helper `src/ui/cv-review.ts` (pure): rows for Replace (differs, 31.A, 32.A) or Add (empty fields, C5), choices Keep / Use suggested / Add the new items (36.B), defaults (38.A), and the merge into form values.
5. UI: `ProfileCvCard` with Replace / Add CV and the analysis card, `CvReviewSheet` (side panel, 33.B), `ProfileForm` handle (C9), Profile page wiring and the applied-changes note, Profiles list badge.
6. Tests at each step; docs, spec, skills; real-use run in the browser with Claude Code.

Validation plan:

- Server: migration 7 test; service tests for tied start, one-at-a-time, apply with a type change (PDF to DOCX), failure injection during the swap (old CV intact), discard on profile delete, sweep of `*.old`; API tests for the new route, ownership 404, PUT with a wrong or foreign analysis (409), POST refusing a tied analysis.
- Comparison helper unit tests (order, case, empty, `any`, seniority).
- UI tests: Replace and Add flows, review choices, Apply into the form, Save sends the analysis id, Cancel keeps the old CV, tied analysis shown on the Profiles screen.
- `npm run typecheck`, `npm test`, `npm run build`; browser walkthrough on a sandbox data dir with a real agent and an invented CV; same-failure search for other callers of `cvAnalysesRepo.current()` and `createProfile`.

Artifact impact plan:

- `AGENTS.md`: no workflow change expected; re-check at close.
- Skills: project-local-api (new route, PUT field); project-testing (only if the harness changes); project-agent-adapter (only if decision 35 changes the prompt).
- Spec: extend "Profiles from a CV".
- README: "Creating a profile from your CV" gains Replace / Add CV.
- SOW lifecycle: move to `current/` once decisions are recorded.

Open-source reference evidence:

- None used.

Open decisions:

- None. 30-38 answered on 2026-11-08.

## Implications And Decisions

16. Review screen: **A** - side-by-side list of differing fields with Keep current / Use suggested; Apply into the form; Save to persist.
17. Fields a re-analysis may change: **A** - target roles, locations, remote, seniority, keywords; never name, excluded companies or notes.
19. When a new CV replaces the old: **A** - only when the user applies and saves.
20. Profiles without a CV: **A** - "Add CV" runs the same flow and fills only empty fields, listed for review.
30. Analyses and profiles: **B** - one analysis per profile plus one for a new profile (user, 2026-11-08). Supersedes SOW-0023 decision 24.A ("one at a time") for analyses tied to different profiles; the new-profile slot keeps its single analysis.
31. Suggestions where the CV says nothing: **A** - an empty list, empty seniority or `remote: any` is never offered as a change.
32. When a list counts as different: **A** - the same items in any order or case are no change.
33. Review placement: **B** - a side panel over the profile form, compared with the form's current (possibly unsaved) values; Apply writes into the open form and keeps unsaved edits.
34. Cancel or leaving: **A** - the analysis stays until Save or Discard.
35. Agent input: **A** - the agent sees only the CV (prompt `analyse_cv` v1 unchanged); the app compares the draft with the form.
36. List fields: **B** - a third choice "Add the new items" (current plus suggested, current order first) next to Keep current / Use suggested.
37. Analyses for different profiles at the same time: **B** - side by side, one agent per analysis; no queued state.
38. Default choice on a Replace CV review row: **A** - Keep current is pre-selected. On Add CV, Use suggested is pre-selected (decision 20.A fills empty fields).
39. Applied values whose analysis is discarded (raised by the review, 2026-11-08): **A** - the values stay in the form and the note becomes a warning that Save keeps them without the new CV, or a reload drops them; other unsaved edits are kept.

## Plan

See the Pre-Implementation Gate implementation plan (steps 1-6).

## Execution Log

### 2026-11-07

- Created as the second half of SOW-0023 (decision 15.B).

### 2026-11-08

- SOW-0023 merged (PR #15). Investigation done; gate filled; decisions 30-36 asked.
- Answers: 30.B, 31.A, 32.A, 33.B, 34.A, 36.B; then 35.A, 37.B; 38.A. Gate and calls revised for 30.B and 33.B; moved to `current/`.
- Implemented in order: migration 7 and repos; owner-aware CV service with the `.new` swap and start-up recovery; profile-scoped analysis router and PUT `cv_analysis_id`; `src/ui/cv-review.ts`; review panel, form handle, Profile page, Profiles badge. Tests written with each step.
- Hazard found: running Prettier on existing files reformatted 13 files that were never Prettier-formatted (the earlier check had passed only because Prettier ignores the git-ignored `.tmp/`). Undone by a three-way merge onto the `origin/main` formatting (two conflicts resolved by hand); recorded in `AGENTS.md`.
- Real-use run with Claude Code 2.1.319 (below). Independent review: 0 high, 2 medium, 3 low; all handled (below). Decision 39 asked and implemented.

## Validation

Acceptance criteria evidence:

- Replace CV / Add CV run the same upload, analyse and progress flow: `test/ui/ProfilePage.test.tsx` ("Replace CV opens the upload card for this profile…", "says a profile without a CV has none and offers Add CV"); server `test/server/api/profile-cv-analysis.test.ts` ("runs for a profile beside the new-profile analysis…").
- Review lists only differing fields side by side with Keep current / Use suggested; Apply into the form; Save persists (16.A, 33.B, 36.B, 38.A): `test/ui/cv-review.test.ts` (9 tests) and the Profile page tests "lists only the differing fields…", "Apply writes the choices into the form and Save sends them with the analysis", "Apply updates the seniority chips".
- Only target roles, locations, remote, seniority, keywords (17.A): `reviewRows` order test; the panel never shows the draft's name or notes; the real run kept notes and excluded companies unchanged.
- New CV replaces the old only on Save (19.A): "a plain Save keeps the old CV and the analysis", "Cancel in the panel changes nothing and keeps the analysis for later"; swap tests including a PDF replaced by a DOCX.
- Add CV fills only empty fields (20.A): "Add CV lists only the empty fields, with Use suggested pre-selected" (UI and pure).
- Decisions 30-39: owners side by side (30.B, 37.B), silent suggestions never offered (31.A), set comparison (32.A), analysis kept after Cancel (34.A), prompt unchanged (35.A: `prompts/analyse_cv.md` untouched), warning after a discard (39.A: "Discard after Apply keeps the applied values…").

Tests or equivalent validation:

- `npm run typecheck`: clean.
- `npm test`: `Test Files  63 passed (63)`, `Tests  788 passed (788)` after both reviews; no warnings in the output.
- `npm run build`: server and UI built (the Vite chunk-size warning predates this SOW).
- Mutation checks, each restored afterwards: no transaction in Save, no owner check on Save, Create profile taking a profile's analysis, no rename after the commit, empty suggestions offered, Save without the analysis id, no SeniorityInput remount, profile delete not stopping the agent, delete not waiting for the agent, no finish of a pending swap before Save, start-up skipping a stale CV of another type. Every mutant failed at least one test.

Real-use evidence:

- Built app on a throwaway data dir (`.tmp/sandbox-0024`), Claude Code 2.1.319, invented CVs generated from `test/fixtures/cv-files.ts` (a PDF and a DOCX with invented people and companies).
- New-profile analysis of the PDF succeeded in about 7 s; a profile was created from it with hand-edited fields.
- Replace CV with the DOCX in the browser: progress card, real analysis ready in about 10 s, Review changes opened the side panel listing target roles, locations, remote, seniority and keywords with Keep current pre-selected; Add the new items, Use suggested and Apply filled the form (roles appended, Hybrid, Staff and Principal chips) with the note; Save stored the fields. On disk the profile folder held `cv.docx` and `cv-text.txt` only (the old `cv.pdf` deleted), `cv-analyses/` was empty, notes and excluded companies were unchanged, and the download was byte-identical to the uploaded DOCX.
- Add CV on a profile without a CV: the Profiles screen showed the "CV changes to review" badge; the panel listed only the empty fields (locations, remote, seniority, keywords) with Use suggested pre-selected.
- Not checked in real use: dark mode of the new panel (it uses the shadcn theme tokens only), Codex, Windows.

Reviewer findings:

- Independent reviewer (general-purpose subagent, read-only), 0 high:
  1. Medium: profile delete did not wait for the stopped agent, and one failed folder delete skipped the other. Fixed: `removeProfileFiles` is async, waits for the agent (bounded by the stop timeout) and removes each folder on its own; the delete handler still checks and deletes rows before its first await. Test: the hanging agent ends before its working folder is removed.
  2. Medium: after Apply, a discarded analysis left the applied values in the form with no hint. Asked as decision 39; implemented 39.A with two tests.
  3. Low: a crash right after the renames could leave the old CV of another type forever. Fixed: start-up finishes every profile with a stored CV, which deletes other-type files. Test added.
  4. Low (plausible): a failed rename while running could make a later Save lose the committed CV. Fixed: Save first puts pending `.new` files in place, and refuses with 409 when that still fails. Two tests (one with a folder blocking the rename).
  5. Low (plausible): when returning an unsaved CV failed at start-up, the sweep could delete it. Fixed: that profile's folder is kept.
  - Suggested tests added: a half-staged crash, profile switching resets the editor.
- Second independent review of those fixes (requested by the user before the PR): the fixes hold (the profile delete still checks and deletes in one tick; nothing can recreate the deleted profile's files while it waits). Three low, plausible findings, all fixed:
  1. A failed delete of the agent's working folder in `analyse` rejected `settled`; nothing awaits a running analysis, so the process could end on an unhandled rejection (also before this SOW). Fixed: `removeQuietly`, which logs.
  2. If moving the staged files back failed after a failed Save, the leftover `*.new` files were later taken for a committed CV (stored text overwritten, or a profile stuck on the 409). Fixed: such leftovers are deleted (the analysis then reports missing files), and `finishSwap` deletes staged files of another type. Tests: a Save whose rollback fails leaves the old CV intact; a stray staged file is dropped at start-up.
  3. Start-up returned `*.new` files to an analysis without checking they were that analysis's files. Fixed: all pending names must match the analysis's file names.
  - Mutation checks: removing either cleanup makes its test fail. `npm test`: `Tests  788 passed (788)`. Not added: Remove CV while a Replace review is applied (the mode becomes Add on the next review; Save then adds the CV, which is the intended result).

Same-failure scan:

- Other callers of `cvAnalysesRepo.current()` and `service.current/retry/discard`: all now pass an owner (`grep -rn "current(" src/server/cv src/server/api`).
- Other places that delete CV folders while an agent may run: `discard` already waited; `stop` waits; profile delete fixed (finding 1).
- `grep -rn "0.0.0.0" src bin`: none. `grep -rn "shell: true\|exec(" src/server`: only regex `.exec` and SQLite `db.exec`, unchanged.

Sensitive data gate:

- Durable artifacts (code, tests, SOW, spec, README, skills, AGENTS.md) contain only invented data (Alex Example, Acme, Globex, Initech, example.com). The real-use CVs were generated from the invented fixture lines and live under git-ignored `.tmp/`. No run logs, real CV text, credentials or personal data were written.

Artifact maintenance gate:

- `AGENTS.md`: Prettier hazard added under Project-specific commands.
- Runtime project skills: updated (below).
- Specs: updated (below).
- End-user docs: README updated (below).
- End-user/operator skills: none exist (AGENTS.md: "Output/reference skills: none").
- SOW lifecycle: completed and moved to `done/` in the same commit as the work.

Specs update:

- `.agents/sow/specs/product-v1.md`: new section "Replace or add a CV on a profile (SOW-0024)"; SOW-0023 section amended (one new-profile analysis, POST refuses a profile's analysis, profile delete removes its analysis).

Project skills update:

- `project-local-api`: profile-scoped analysis router, PUT `cv_analysis_id`, delete and shutdown changes.
- `project-agent-adapter`: several CV agents may run at once; shutdown aborts them all.
- `project-testing`: where profile CV analysis and review rules are tested; the Profile page mocks `getCvAnalysis`.

End-user/operator docs update:

- README: new section "Replacing or adding a CV on a profile"; profile delete and data-folder notes amended.

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- See Lessons Extracted.

Follow-up mapping:

- Search of this SOW for defer|later|follow-up|future|TODO|pending: "the analysis stays until Save or Discard" and "comes back once it is saved" describe shipped behaviour; decision 35.B (the agent also sees the profile) was rejected by the user in favour of 35.A, not deferred. No open follow-up.

## Outcome

Replace CV and Add CV ship on the Profile page. Each profile has its own CV analysis, running beside others. Its suggestions are reviewed in a side panel against the form's current values, applied into the form, and saved together with the new CV in one atomic swap that survives a crash at any step. The SOW-0023 new-profile flow is unchanged apart from refusing a profile's analysis.

## Lessons Extracted

- Prettier honours `.gitignore`: a `--check` on a copy under `.tmp/` passes without checking. Check style against `origin/main` content via `--stdin-filepath`, and never run `prettier --write` on existing files here (recorded in `AGENTS.md`).
- A component that copies its prop into state (`SeniorityInput`) ignores later external changes; writing into the form from outside needed a key remount, caught only by a UI test of the applied value.
- Deleting a folder right after aborting a process is unsafe on Windows; await the process first (review finding 1).

## Followup

None. Decision 35.B was rejected by the user (35.A), not deferred.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
