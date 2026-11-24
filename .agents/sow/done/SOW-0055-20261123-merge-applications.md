# SOW-0055 - Merge duplicate applications

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered; the user asked for the pull request on 2026-11-24, so the SOW closes with the work in one commit.

## Requirements

### Purpose

Gmail sync sometimes creates several applications for what the user knows is one application, because the emails name the role differently. The user wants to fix that by hand: pick the applications that are the same and merge them into one, so that the app, the Dashboard and later syncs treat them as one.

### User Request

"If AI cannot correlate them, I want to allow users to merge multiple applications to one if they think it's the same application." (2026-11-23)

### Assistant Understanding

Facts:

- New-application matching is exact on company and role, ignoring only case and extra blanks (`matchKey`, `src/server/domain/new-application.ts:11`). A role written two ways in two emails becomes two applications.
- The user's own data (read only, not copied here) holds four applications for one company with four role spellings, three at Interview and one at Screening, each from an accepted new-application proposal.
- There is no way to delete or merge an application today (`src/server/api/applications.ts`: list, create, history, get, patch, status).
- Three tables reference `applications(id)` with foreign keys on (`src/server/db/connection.ts:10`): `proposals.application_id`, `status_history.application_id`, `application_proposals.application_id`. `applications.job_id` references `jobs`. `mail_threads` has no application reference (migration 13).
- A Gmail sync reads the profile's open applications when it starts (`src/server/services/mail-sync.ts:223`) and writes status proposals for those ids when it saves. An application removed in between makes that insert fail its foreign key and the whole save fail.
- Decided and pending new-application proposals block their company and role from being proposed again, keyed by `profile_id`, not by application (`mail-sync.ts:119`, `application-proposals-repo.ts` `names`).
- Sync matches mail to applications by name in four places: `groupThreadRecords` (`thread-grouping.ts:62,89`, open applications; `:95-104` company-only for mail without a role), `collectNewApplications` (`mail-sync.ts:114-117`, every application), `trackedNames` (`mail-sync.ts:91-100`, the prompt's "Already tracked" list), and accepting a new-application proposal (`services/application-proposals.ts:44-45`). The prompts list open applications one per line (`renderApplications`, `src/server/mail/agent-source.ts:35-43`) and the agent links mail by the listed id.
- Accepting a status proposal does not check the stage (`services/proposals.ts:39-46`); only sync's creation does (`mail-sync.ts:303`, `FINDING_STAGE` at `:45-53`).

Inferences:

- Without more, a merge would make sync lose mail that uses a removed application's name: that name no longer matches an open application, and its old proposal blocks it as "already proposed" (builder check, verified in `thread-grouping.ts:89` and `mail-sync.ts:119,175`). An application added by hand would instead be proposed again. Decision 6C (aliases) exists to close this.
- A role spelling never seen before can still produce a new proposal after a merge; the user rejects it or merges again.

Unknowns:

- None that investigation can resolve.

### Acceptance Criteria

- On Applications, the user selects two or more rows, presses Merge, picks the one to keep and confirms; afterwards one row remains. Verified by UI tests and a manual run on the mock sandbox.
- The kept application keeps its company, role, status, applied date and status-changed time; empty URL, job link and applied date are filled from the others; sender domains are the union; notes are joined. Verified by repository tests.
- Every `status_history`, `proposals` and `application_proposals` row of the removed applications points to the kept one afterwards, and nothing else is lost. Verified by repository tests counting rows.
- Moved pending status proposals that would not move the kept application past its current stage are recorded rejected. Verified by repository tests.
- Each removed application's company and role, and its own aliases, become aliases of the kept one. Verified by repository tests.
- An alias counts wherever the application's own name counts in sync: name grouping, company-only grouping, "Already tracked", the new-application dedupe, and accepting a new-application proposal; both sync prompts list it on the application's line. Verified by unit tests of each site and a prompt test.
- A merge is all or nothing (one transaction). Verified by a test that forces a failure part-way.
- Ids from another profile, unknown ids, duplicates, a keep id inside the merge list, or fewer than one id to merge are rejected before any write (404 or 400). Verified by API tests.
- A merge is refused with 409 while a Gmail sync of the profile is queued or running. Verified by an API test.
- Deleting a profile also deletes its aliases. Verified by the profile delete test.
- The Dashboard summary after a merge counts the kept application once, with the stages its moved history shows. Verified by a test through `summarizeDashboard`.
- README screenshot `docs/images/applications.png` and the demo video are re-taken; the user uploads the new video. Verified by viewing them.

## Analysis

Sources checked:

- `.agents/sow/specs/product-v1.md` (applications, status pipeline, new applications from sync, scoped sync, dashboard, user interface).
- `src/server/db/migrations.ts`, `applications-repo.ts`, `proposals-repo.ts`, `application-proposals-repo.ts`, `jobs-repo.ts`, `runs-repo.ts`, `profiles-repo.ts`, `connection.ts`.
- `src/server/api/applications.ts`, `src/server/api/profiles.ts` (profile delete refuses with active runs), `src/server/api/proposals.ts`.
- `src/server/services/mail-sync.ts`, `src/server/services/proposals.ts`, `src/server/services/application-proposals.ts`, `src/server/mail/agent-source.ts`, `src/server/domain/new-application.ts`, `src/server/domain/thread-grouping.ts`.
- `prompts/sync_mail.md` (v6), `prompts/sync_mail_read.md` (v1), `scripts/sandbox-mock/mock-agent.mjs` (reads open-application lines with `^- id: (\S+) \| company: (.*?) \| role: (.*?) \|`).
- `src/ui/pages/ApplicationsPage.tsx`, `src/ui/components/TableView.tsx`, `src/ui/components/ui/` (checkbox, dialog, radio-group, alert-dialog exist).
- `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` (no merge or delete item; line 42 lists duplicate applications from double Save as an open product question, a different cause).
- `README.md` (Applications section and screenshot), AGENTS.md README screenshot and demo-video rules.
- Project skills loaded: `project-local-api`, `project-testing`, `project-agent-adapter`.

Current state:

- Duplicates arise when sync sees role spellings that differ; the user can only edit each one.

Risks:

- Data loss: a merge removes rows. Mitigated by moving every referencing row, one transaction, a confirmation, and tests.
- Sync race: see Facts; mitigated by the 409 guard.
- Lost mail after a merge: mitigated by aliases (decision 6C).
- Journey reach: an application created at Interview by an accepted proposal has no history row for Interview. Merging it into one kept at Screening loses that stage from the Dashboard, because only the kept status and the moved history rows count. Mitigated by preselecting the furthest-stage application as the one to keep (assistant call below).
- A job linked to a removed application, when the kept one has its own job, shows as not tracked afterwards (one application per job link).
- Prompt change: wording changes for both sync prompts; agents may ignore the alias field. The app-side matching works regardless for scoped sync; for unscoped sync the agent's linking is the only path for status findings, as today.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Exact company-and-role matching (`new-application.ts:11`) splits one real application into several when emails spell the role differently; the app offers no way to join them. A manual merge joins them, and aliases keep later syncs matching mail that uses any merged name.

Evidence reviewed:

- Specs, code, prompts, SOWs and skills listed under Analysis. No external open-source references were relevant: the change uses only this repository's patterns.

Affected contracts and surfaces:

- Database: migration 14, table `application_aliases`.
- Repositories: `applicationsRepo.merge`, alias reads; `profilesRepo` delete.
- API: new `POST /api/profiles/:pid/applications/merge`; `GET /:id` and the merge response add `aliases`.
- Sync: `trackedNames`, `collectNewApplications`, `groupThreadRecords`, `renderApplications`, application-proposal accept; prompts `sync_mail` v7, `sync_mail_read` v2; mock agent and seed if their drift tests fail.
- UI client: `mergeApplications(profileId, keepId, mergeIds)`; `ApplicationDetail` type gains `aliases`.
- UI: Applications table selection column, selection bar, merge dialog; application page "Also known as" line.
- Spec `product-v1.md`: applications, sync, prompts, destructive actions, UI.
- README: Applications paragraph; `docs/images/applications.png`; demo video (`docs/video/demo.mp4`, poster, both attachment links).
- Skills: `project-local-api` (merge route, 409), `project-agent-adapter` (prompt versions and alias field), `project-testing` if a new test pattern appears.

Existing patterns to reuse:

- Ownership checks: `requireApplication` in `src/server/api/applications.ts`; 404 for another profile's id.
- Active-run refusal: `DELETE /api/profiles/:pid` (`profiles.ts:139`), `runsRepo.hasActive(kind, profileId)`.
- Strict zod bodies and `readJson`; `HttpError`.
- Transactions: `db.transaction(...)` as in `setStatus`.
- Stage rule: `FINDING_STAGE` / `stageOf` in `mail-sync.ts:45-53`, moved to a shared domain module and reused.
- Name rule: `matchKey` and `cleanName` in `new-application.ts`.
- Migration tests: `test/server/db/migrations.test.ts`; profile delete tests; prompt version pin in `test/server/tasks/prompts.test.ts`; sandbox drift tests in `test/server/sandbox-mock/`.
- Confirmation pattern for destructive actions (spec line 184); Radix dialog tests scoped with `within(screen.findByRole('dialog'))`.
- Checkbox and RadioGroup from `src/ui/components/ui/`; no new shadcn component needed.

Risk and blast radius:

- One additive migration (new table, no rebuild). Existing rows unchanged.
- Sync changes are additive: an application without aliases matches exactly as before; tests pin that.
- Prompt wording changes bump both versions; older runs keep their recorded version.
- Every consumer of the three referencing tables reads by application or by profile; moving rows to another application of the same profile keeps profile-scoped reads (`reviewedMessageIds`, `listPending`, `historyForProfile`) correct.
- The Applications screen changes (selection column), which touches its tests, the README screenshot and the demo video.

Sensitive data handling plan:

- The user's data was read locally to diagnose and is not copied into this SOW, tests or docs (company named only as "one company"). Tests use invented companies (`Acme`, `Globex`) and invented ids. Screenshots and video come from the mock sandbox and demo data only; frames are checked for personal data.

Implementation plan:

1. Migration 14 and alias reads in the repository; profile delete removes aliases. Tests first.
2. `applicationsRepo.merge` with field rules, row moves, alias writes, 7B rejections, transaction rollback. Tests first.
3. Sync: shared stage rule; aliases in `trackedNames`, `collectNewApplications`, `groupThreadRecords`, application-proposal accept, `renderApplications`; prompt wording and version bumps; mock agent and seed if needed. Tests first.
4. API route and `GET /:id` aliases; client function. Tests first.
5. UI: selection column, selection bar, merge dialog, state update after merge, "Also known as" on the application page. Tests first.
6. Spec, README, skills; screenshot and demo video re-taken; real-use check on `npm run sandbox:mock`; independent review; user uploads the video.

Validation plan:

- `npm test`, `npm run typecheck`; new tests in the repository, API, sync, prompt, migration, profile delete, client and Applications page test files.
- Manual: mock sandbox, create two applications with one company, merge, check the row, the detail page history and aliases, the Review page and the Dashboard; run a mock sync and check the prompt file lists the alias.
- Same-failure scan: every `REFERENCES applications`, every `matchKey(` call site, every query joining `applications`.
- Independent reviewer once for the SOW (AGENTS.md override).

Artifact impact plan:

- AGENTS.md: likely unaffected (no new command or workflow); the sandbox-mock note already covers prompt line changes; confirm at close.
- Runtime project skills: `project-local-api` and `project-agent-adapter` as listed; `project-testing` if needed.
- Specs: `product-v1.md` updated as listed above.
- End-user/operator docs: README Applications paragraph, `docs/images/applications.png`, demo video and its links.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: move to `current/` when the design is approved; one commit at close with the SOW in `done/`. The video upload is a user step before close.

Open-source reference evidence:

- None checked: the work reuses only local patterns.

Open decisions:

- None. Decisions 1-8 recorded below; assistant calls listed under Design for the user to correct.

## Implications And Decisions

User decisions, 2026-11-23 (answer "1.A, 2.A, 3.A, 4.A, 5.A"):

1. Approach: **A. Merge.** The user picks one application to keep; the others fold into it and are removed. Rejected: B, add Delete (loses history and frees old role names for re-proposal); C, mark as duplicate (every count, the Dashboard and sync would have to skip hidden rows).
2. Where a merge starts: **A. Applications table**, a checkbox per row and a "Merge selected" action opening a dialog to pick the one to keep. Rejected: B, a picker on the application page.
3. Field rules: **A.** The kept application's company, role, status and applied date stay; empty URL, job link and applied date are filled from the others; sender domains are combined; notes are joined. The user can edit afterwards. Rejected: B, a field-by-field picker; C, automatic earliest date and furthest status.
4. History and proposals of removed rows: **A. Move them all to the kept application.** Rejected: B, drop them.
5. Which applications: **A. Any applications of the same profile**, with a warning in the dialog when company names differ.

User decisions after the builder check, 2026-11-23 (answer "All recommended"):

6. Mail that uses a removed application's name: **C. Aliases.** Every removed name is remembered on the kept application; sync matching and both sync prompts use it. Rejected: A, accept and document (status changes silently lost); B, derive names from moved new-application proposals only (misses hand-added names and leaves the agent unaware in unscoped sync).
7. Moved pending status proposals that would not move the kept application past its stage: **B. Reject them during the merge**, by the rule sync uses when creating a proposal. Rejected: A, move as is (accepting would move the application backwards); C, a stage check on every accept (changes behaviour beyond merging).
8. Demo video: **A. Re-record**, as the AGENTS.md rule requires; the user uploads the new video. Rejected: B, skip and record an exception.

User decisions on the final review's minors, 2026-11-24 (answer "All recommended"):

9. M2, an alias equal to another application's own name: **A. Fix.** Own names are registered first, aliases second, at every matching site. Rejected: B, leave it.
10. M4, UI polish: **A.** Clear the "Merged …" line on the next selection change, and make "<n> selected" a polite status so screen readers announce it. Rejected as not worth doing: a hint for the disabled Merge button (the count beside it explains it), a 50-row cap in the UI (the API already answers 400; ticking 51 rows by hand is unrealistic), naming the missing application on a 404 (the error only follows a change made in another tab). Rejected: B, fix nothing; C, fix everything.
11. M3, M5, M6: **A.** M6 implemented: the mock-agent drift test renders a line with a real alias. M3 rejected: the sidebar Review count is re-read on navigation for every change (spec "User interface"), and a merge is no different. M5 rejected: the UI stores applied dates only as ISO strings (`dayToIso`), so an unparseable stored date needs a hand-made API call. Rejected: B, a new SOW for all three.

## Design

Intent: let the user turn several applications they know are one into a single application, without losing what the app knows about any of them, so the Dashboard and later syncs see one application.

Goals:

- One merge joins two or more applications of one profile into the one the user keeps.
- Nothing the removed applications carried is lost: history, status proposals, new-application proposals, notes, sender domains, a URL or job link the kept one lacks, and their names.
- Later syncs match mail under any merged name to the kept application.

Non-goals:

- Fuzzy or automatic matching of names.
- Undo or unmerge.
- Merging across profiles.
- A general Delete application action.
- Editing or removing aliases by hand.

Anti-goals (a failure even if it works):

- A merge that removes an application while leaving rows pointing at it, or that half-completes.
- A merge that makes the next sync fail, lose mail under a merged name, or re-propose a merged application.
- A merge started without the user seeing which application is kept and confirming.

Constraints:

- Server binds loopback only; state changes go through the request guard; strict zod bodies (project-local-api skill).
- UI composed from `src/ui/components/ui/` only (AGENTS.md).
- `status_history.source` allows only `user` and `proposal`, so the merge writes no history row.
- Prompts: bump `version:` on wording change; agent output stays untrusted (project-agent-adapter skill).

Data:

- Migration 14: `application_aliases (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications (id), company TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL)`, index on `application_id`. Additive, no rebuild.
- Profile delete removes the profile's aliases before its applications, in the same transaction.

Merge (`applicationsRepo.merge(keepId, mergeIds): Application`, one transaction):

- All ids must exist and share the kept application's `profile_id` (else throw; the route has already checked).
- Kept fields stay: `company`, `role`, `status`, `applied_at`, `status_changed_at`, `created_at`.
- Filled when the kept value is null or empty, each on its own: `url` from the first removed application, in `mergeIds` order, that has one; `job_id` likewise; `applied_at` from the earliest non-null `applied_at` among the removed ones, except when the kept status is `saved` (saved has no applied date, spec "Status pipeline").
- `sender_domains`: kept ones first, then the others', without repeats.
- `notes`: the non-blank notes of the kept application, then of each removed one in `mergeIds` order, joined with a blank line; identical notes are kept once. Null when all are blank.
- Aliases: the removed applications' existing aliases move to the kept one; each removed application's company and role is added as an alias. A name whose `matchKey` equals the kept application's own name or an alias it already has is not added.
- `UPDATE status_history`, `proposals`, `application_proposals SET application_id = keepId WHERE application_id IN (mergeIds)`.
- Pending status proposals now on the kept application whose proposed stage is not past the kept status's stage (`stageOf(proposed) <= stageOf(kept.status)`, the sync rule) are recorded `rejected` with `decided_at` now.
- `DELETE FROM applications WHERE id IN (mergeIds)`.
- Returns the kept application.

Aliases in sync (an alias counts wherever the application's own name counts):

- `groupThreadRecords`: an open application's aliases join `openByKey`; company-only matching (`:95-104`) compares alias companies too, for open applications and for all applications.
- `collectNewApplications`: alias keys join `tracked`, pointing at their application (so a saved application's alias still becomes a status proposal, and others are "already tracked").
- `trackedNames`: closed applications contribute their aliases to "Already tracked".
- Accepting a new-application proposal (`services/application-proposals.ts:44-45`): an application whose name or alias matches counts as the same application.
- `renderApplications` adds `| also_known_as: <company> - <role>; <company> - <role>` after `role` (`(none)` without aliases); `sync_mail` v7 and `sync_mail_read` v2 add a rule that mail about any of an application's names belongs to that application and is reported with its id. The mock agent's line regex still matches (it stops at the first `|` after role); its tests confirm.

API:

- `POST /api/profiles/:pid/applications/merge`, registered before `/:id`:
  - Body, strict: `{ keep_id: string, merge_ids: string[] }`, `merge_ids` 1 to 50 distinct ids, none equal to `keep_id` (400 otherwise).
  - Every id checked through `requireApplication` before any write (404 "Application not found" for unknown or another profile's id).
  - 409 "A Gmail sync of this profile is queued or running; wait for it to finish" when `runsRepo.hasActive('sync_mail', profileId)`. Check and merge stay synchronous in one handler, as in profile delete, so the queue cannot start a sync between them.
  - 200 with the kept application, its history and its aliases (same shape as `GET /:id`).
- `GET /api/profiles/:pid/applications/:id` adds `aliases: { company, role }[]`.

UI:

- Applications page: a new first column with a checkbox per row, named "Select <Company> - <Role>"; no select-all.
- With one or more rows selected, a bar above the table reads "<n> selected" with "Merge" (enabled at two or more) and "Clear selection". Rows the filters hide are dropped from the selection, so the dialog lists only rows the user can see.
- Merge opens a dialog "Merge <n> applications": a radio list, one option per selected application, "<Company> - <Role>", with its status and applied date; a text: "The others are removed. Their history and proposals move to the one you keep, and their names are kept so Gmail sync still matches their mail. Empty details are filled from them, sender domains are combined and notes are joined. This cannot be undone."; when company names differ (case- and blank-insensitive), a warning "These applications name different companies: <A>, <B>."; buttons Cancel and "Merge applications".
- After success: the removed rows leave the table, the kept row is replaced with the returned one, the selection clears, and a status line reads "Merged <n> applications into <Company> - <Role>." A failure shows the error in the dialog and changes nothing.
- Application page: when the application has aliases, a read-only line "Also known as" lists them as "<Company> - <Role>".

Assistant calls (the user may correct any):

- The dialog preselects the application with the furthest stage by `stageOf` (ties: the newest by `created_at`). Reason: Journey reach counts only the kept status plus history, so keeping the furthest stage keeps the stage the user reached.
- Merging is refused during a Gmail sync of the profile (409). Reason: the sync's save would fail its foreign key on a removed application id and lose the whole sync result.
- Two pending status proposals that end up on the kept application with the same proposed status, both past its stage, are both kept; accepting the second is a no-op (`setStatus` returns when the status is unchanged).
- A job linked to a removed application, when the kept one has its own job, shows as not tracked afterwards. Reason: one job link per application; the Jobs page offers Save again.
- The merge dialog has its own description text and no ⓘ help button, like the existing confirmation dialogs.
- The application page shows aliases read-only, so the user can see why mail under another name lands there.
- The list-navigation state on the application page may hold ids of removed applications; a removed id leads to the existing "Application not found" handling.

Left to the builder:

- Component structure (dialog as its own component or inside the page), the exact status-line component, test layout, where the shared stage rule lives.

Approaches considered: Merge (chosen), Delete application, Mark as duplicate; see decision 1. For later syncs: aliases (chosen), names from moved proposals, accept and document; see decision 6.

## Plan

Design approved by the user on 2026-11-24 ("yes"). Executors read the Design section above with this plan.

**Goal:** merge two or more applications of one profile into the one the user keeps, moving everything the others carry and remembering their names as aliases that Gmail sync matches.

**Architecture:** pure domain rules (`stage.ts`, `merge.ts`) decide fields and aliases; `applicationsRepo.merge` applies them in one transaction; sync reads aliases through one repository call and treats each alias like the application's own name; the API adds one route; the UI adds row selection and a dialog.

**Tech stack:** TypeScript, better-sqlite3, Hono, zod, React with shadcn/ui (Checkbox, Dialog, RadioGroup, Alert), vitest.

### Global Constraints

- No commit per task: AGENTS.md "SOW Completion And Commit" asks for one commit with the work, the artifacts and the SOW move, unless the user asks otherwise. Never `git add -A`; name each file.
- Invented data only in tests, seed, screenshots and video (`Acme`, `Globex`, `example.com`, ids like `app-1`).
- Server binds `127.0.0.1` only; every new body is a strict zod schema read with `readJson`.
- UI uses only `src/ui/components/ui/`; no raw `button`/`input`/`table` outside it; match surrounding style by hand, never `prettier --write`.
- Prompt wording change bumps `version:` (`sync_mail` 6 → 7, `sync_mail_read` 1 → 2) and the pins in `test/server/tasks/prompts.test.ts`.
- Copy fixed by the Design: dialog title "Merge <n> applications", button "Merge applications", warning "These applications name different companies: <A>, <B>.", status line "Merged <n> applications into <Company> - <Role>.", 409 text "A Gmail sync of this profile is queued or running; wait for it to finish", page label "Also known as".
- `npm test` and `npm run typecheck` pass with no warnings (no `act(...)` warnings) before the close.

### Review Focus

1. Merging applications whose ids appear twice, or where the kept id is also in `merge_ids` → 400, nothing written. Test in Task 5.
2. An application without aliases must match in sync exactly as before (no behaviour change for users who never merge). Tests in Task 4 run each changed site with and without aliases.
3. A kept application at `saved` merging others with applied dates → `applied_at` stays null. Test in Task 2.
4. Selection when the user filters rows out after ticking them → hidden rows leave the selection; Merge counts only visible ones. Test in Task 6.
5. A merge whose kept application is `rejected` or `withdrawn` and a moved pending proposal to `offer`: `stageOf('withdrawn')` is 0, so the proposal stays pending; `rejected` (5) rejects it. Test in Task 3 pins both.

### Task 1: Alias table, reads and profile delete

**Files:** modify `src/server/db/migrations.ts` (migration 14), `src/server/domain/types.ts`, `src/server/db/applications-repo.ts`, `src/server/db/profiles-repo.ts`; tests `test/server/db/migrations.test.ts`, `test/server/db/applications-repo.test.ts`, `test/server/db/profiles-repo.test.ts`.

**Interfaces produced:**
- `type ApplicationAlias = { company: string; role: string }` in `domain/types.ts`.
- `applicationsRepo.aliases(applicationId: string): ApplicationAlias[]` (oldest first, rowid tiebreak).
- `applicationsRepo.aliasesForProfile(profileId: string): Map<string, ApplicationAlias[]>` keyed by application id; applications without aliases are absent.

- [ ] Write failing tests: "migration 14 adds the application aliases table with its index" (table columns, `idx_application_aliases_application_id`, foreign key to `applications`); "aliases and aliasesForProfile read only that application's and profile's rows" (insert rows with SQL); "deleting a profile removes its application aliases" (profiles-repo).
- [ ] Run `npx vitest run test/server/db` → the three fail.
- [ ] Add migration 14 with the table from the Design; add the two reads; add `DELETE FROM application_aliases WHERE application_id IN (SELECT id FROM applications WHERE profile_id = @id)` to `deleteSteps` before the applications delete.
- [ ] Re-run → pass.

### Task 2: Shared stage rule and merge rules

**Files:** create `src/server/domain/stage.ts`, `src/server/domain/merge.ts`; modify `src/server/services/mail-sync.ts` (import `stageOf`, remove `FINDING_STAGE`); tests `test/server/domain/stage.test.ts`, `test/server/domain/merge.test.ts`.

**Interfaces produced:**
- `stageOf(status: string): number` (applied 1, no_response 1, screening 2, interview 3, offer 4, rejected 5, anything else 0).
- `mergedFields(kept: Application, removed: Application[]): { url: string | null; job_id: string | null; applied_at: string | null; sender_domains: string[]; notes: string | null }`.
- `aliasesToKeep(kept: Application, keptAliases: ApplicationAlias[], removed: { app: Application; aliases: ApplicationAlias[] }[]): ApplicationAlias[]` — the aliases to add (each removed application's existing aliases first, then its own name), skipping any whose `matchKey` equals the kept name, an alias it already has, or one added earlier in the list.
- `keepCandidate(apps: Application[]): string` — id with the highest `stageOf`, ties by newest `created_at` (used by the UI, Task 6).

- [ ] Write failing tests with the Design's values: stage ranks table; `mergedFields` keeps kept URL, fills null URL and `job_id` independently from the first removed one that has each, takes the earliest removed `applied_at` only when kept has none, keeps null `applied_at` for a `saved` kept application, unions domains kept-first without repeats, joins non-blank notes with `\n\n` and drops identical repeats, returns null notes when all blank; `aliasesToKeep` drops a name equal to the kept one ignoring case and blanks, and drops repeats; `keepCandidate` picks interview over screening and the newer of two interviews.
- [ ] Run `npx vitest run test/server/domain` → fail.
- [ ] Implement; `mail-sync.ts` uses `stageOf` from `stage.ts` with unchanged behaviour.
- [ ] Re-run `npx vitest run test/server/domain test/server/services/mail-sync.test.ts` → pass.

### Task 3: `applicationsRepo.merge`

**Files:** modify `src/server/db/applications-repo.ts`; test `test/server/db/applications-repo.test.ts`.

**Interfaces:** consumes Task 1 reads and Task 2 rules. Produces `applicationsRepo.merge(keepId: string, mergeIds: string[]): Application`; throws `Application not found: <id>` for an unknown id and `Applications belong to different profiles` for a mixed set.

- [ ] Write failing tests: fields follow `mergedFields`; every `status_history`, `proposals` and `application_proposals` row of the removed ones now has `application_id = keepId` (counts before and after equal); removed rows are gone; aliases moved and added per `aliasesToKeep`; a moved pending proposal to `screening` on a kept `interview` becomes `rejected` with `decided_at` set, one to `offer` stays pending; kept `rejected` rejects a pending `offer`, kept `withdrawn` leaves it pending; a mixed-profile set throws and changes nothing; "the Dashboard counts a merged application once": `summarizeDashboard` over `list(pid)` and `historyForProfile(pid)` after merging an interview-reaching application into a screening one gives `total` 1 and `funnel.interview` 1; "a failure part-way changes nothing": create `CREATE TEMP TRIGGER stop BEFORE DELETE ON applications BEGIN SELECT RAISE(ABORT, 'stop'); END` and assert every table is unchanged after the throw.
- [ ] Run the file → fail.
- [ ] Implement in one `db.transaction`, the order in the Design.
- [ ] Re-run → pass.

### Task 4: Aliases in Gmail sync

**Files:** modify `src/server/mail/types.ts` (`applications[].aliases: ApplicationAlias[]`), `src/server/mail/agent-source.ts` (`renderApplications`), `src/server/domain/thread-grouping.ts` (`open[]` and `applications[]` gain `aliases: ApplicationAlias[]`), `src/server/services/mail-sync.ts` (`trackedNames`, `collectNewApplications`, request building), `src/server/services/application-proposals.ts` (`existingFor`), `prompts/sync_mail.md`, `prompts/sync_mail_read.md`; scripts `scripts/sandbox-mock/*` only if their tests fail; tests `test/server/domain/thread-grouping.test.ts`, `test/server/services/mail-sync.test.ts`, `test/server/services/application-proposals.test.ts`, `test/server/mail/agent-source.test.ts`, `test/server/tasks/prompts.test.ts`, `test/server/sandbox-mock/*`.

**Interfaces:** consumes `aliasesForProfile`. The application line becomes `- id: <id> | company: <c> | role: <r> | also_known_as: <c1> - <r1>; <c2> - <r2> | applied_at: <d> | sender_domains: <ds>`, with `also_known_as: (none)` when empty.

- [ ] Write failing tests:
  - grouping: a record named by an alias goes to that open application; company-only mail matches an open application by an alias company; without aliases results equal today's (existing tests unchanged).
  - `collectNewApplications` via the sync handler: an entry under a closed application's alias is skipped "already tracked"; under a saved application's alias becomes a status proposal for it.
  - `trackedNames`: a closed application's alias appears in the "Already tracked" lines of the rendered prompt.
  - application-proposal accept: a proposal whose name equals an application's alias returns `already_tracked` with that application.
  - `renderApplications` renders `also_known_as` for both prompts; prompt versions are `7` and `2`, and each prompt carries the new rule.
- [ ] Run the files → fail.
- [ ] Implement. Rule text for `sync_mail.md` (Rules, after the `application_id` line) and `sync_mail_read.md` (Rules, after its `application_id` line): "An application's `also_known_as` names are the same application under other names: mail about any of them belongs to that application and uses its `id`."
- [ ] Re-run those files and `npx vitest run test/server/sandbox-mock test/e2e` → pass; fix the mock agent or seed only if they fail.

### Task 5: Merge route and client

**Files:** modify `src/server/api/applications.ts`, `src/ui/api/client.ts`; tests `test/server/api/applications.test.ts`, `test/ui/client.test.ts`.

**Interfaces:** `POST /api/profiles/:pid/applications/merge` as in the Design; `GET /:id` returns `{ ...application, history, aliases }`. Client: `ApplicationDetail = Application & { history: StatusHistoryEntry[]; aliases: ApplicationAlias[] }`; `mergeApplications(profileId: string, keepId: string, mergeIds: string[]): Promise<ApplicationDetail>` posting `{ keep_id, merge_ids }`.

- [ ] Write failing tests: 200 merges and returns history and aliases (DB rows checked); 400 for empty `merge_ids`, 51 ids, a repeated id, `keep_id` inside `merge_ids`, an unknown key; 404 for an unknown id and for another profile's id with nothing changed; 409 with the Design text while a `sync_mail` run of the profile is queued, and allowed while one of another profile is queued; 415 without JSON content type; `GET /:id` includes `aliases`; client posts the right URL and body.
- [ ] Run → fail.
- [ ] Implement; register the route before `/:id`.
- [ ] Re-run → pass.

### Task 6: Applications selection, merge dialog, aliases on the application page

**Files:** create `src/ui/components/MergeApplicationsDialog.tsx`; modify `src/ui/pages/ApplicationsPage.tsx`, `src/ui/pages/ApplicationDetailPage.tsx`; tests `test/ui/ApplicationsPage.test.tsx`, `test/ui/ApplicationDetailPage.test.tsx`.

**Interfaces:** consumes `mergeApplications`, `keepCandidate`. `MergeApplicationsDialog` props: `{ profileId: string; applications: Application[]; open: boolean; onOpenChange: (open: boolean) => void; onMerged: (kept: ApplicationDetail, removedIds: string[]) => void }`.

- [ ] Write failing tests: each row has a checkbox named "Select <Company> - <Role>"; one selected shows "1 selected" with Merge disabled; two enable Merge; the dialog lists both with `keepCandidate` preselected; differing companies show the warning, same company ignoring case does not; Cancel calls nothing; confirming calls `mergeApplications(pf1, keepId, [otherId])`, removes the other row, updates the kept row, clears the selection and shows the status line; an API error shows in the dialog and keeps both rows; filtering a selected row out drops it from the count; the application page shows "Also known as" with "<Company> - <Role>" items only when aliases exist.
- [ ] Run → fail.
- [ ] Implement with Checkbox, Dialog, RadioGroup and Alert from `src/ui/components/ui/`.
- [ ] Re-run → pass; then `npm test` and `npm run typecheck`.

### Task 7: Artifacts, real use, review, close

**Files:** `.agents/sow/specs/product-v1.md`, `README.md`, `.agents/skills/project-local-api/SKILL.md`, `.agents/skills/project-agent-adapter/SKILL.md`, `docs/images/applications.png`, `docs/video/demo.mp4`, `docs/video/demo-poster.png`, this SOW.

- [ ] Spec: applications merge contract, aliases and where they count, migration 14, prompt versions and line format, 409, destructive-action list ("Merge applications"), UI items, profile delete removes aliases.
- [ ] README Applications paragraph mentions merging duplicates; skills updated as the gate lists.
- [ ] Real use: `npm run sandbox:mock`, add two applications for one invented company, merge, check table, application page (history, Also known as), Review, Dashboard; run Sync from Gmail and check the run's prompt file lists `also_known_as`.
- [ ] Re-take `applications.png` (1440×900 light, Playwright under `.tmp/`) and re-record the video with `npm run demo:video`; watch it and check frames for personal data.
- [ ] Independent review of the whole change; handle findings; same-failure scans from the gate.
- [ ] Fill Validation, move SOW to `done/` with `Status: completed`, one commit naming each file; the user uploads the video and both README attachment links are replaced before close.

## Execution Log

### 2026-11-23

- Investigation and design; decisions 1-5 recorded.
- Builder check by an independent subagent raised three questions (mail under removed names, backwards proposals, demo video); verified in code and answered by decisions 6-8.

### 2026-11-24

- Design and plan approved; native execution chosen (user answer "A"). SOW moved to `current/`. Baseline before any change: `npm test` 85 files, 1442 tests passed.
- Task 1: migration 14 (`application_aliases`), `aliases` / `aliasesForProfile`, profile delete step. The "applies the remaining migrations" counts in `migrations.test.ts` rose by one and the new index joined the index list, as when migration 13 landed.
- Task 2: `src/server/domain/stage.ts` (`stageOf`, moved out of `mail-sync.ts` unchanged) and `src/server/domain/merge.ts` (`mergedFields`, `aliasesToKeep`, `keepCandidate`).
- Task 3: `applicationsRepo.merge`. Ruling: the 7B rejection covers every pending proposal on the kept application after the move, its own older ones included, as the Design says ("now on the kept application").
- Task 4: aliases in `groupThreadRecords` (optional field), `trackedNames`, `collectNewApplications`, the request built for the mail source (required field; existing test fixtures got `aliases: []`), `existingFor` in the application-proposal service, `renderApplications`; `sync_mail` v7 and `sync_mail_read` v2 with the alias rule after each `application_id` rule. The mock agent needed no change.
- Task 5: `POST /applications/merge`, `aliases` on `GET /applications/:id`, `mergeApplications` in the client. Ownership (404) is checked before the sync guard (409).
- Task 6: selection column, selection bar, `MergeApplicationsDialog`, "Also known as" on the application page. Rulings: the different-companies warning lists names in the dialog's order, first spelling per company; radio names read "<Company> - <Role>, <Status> · applied <day>"; the `companies()` helpers in `ApplicationsPage.test.tsx` read cell 1 now that the checkbox column is first.
- Task 7: spec, README, `project-local-api` and `project-agent-adapter` skills; real use on the mock sandbox; `docs/images/applications.png` re-taken (1440×900, light, Frontend Platform profile, invented seed data only); demo video re-recorded with `npm run demo:video` (90.2 s), Applications frames checked (checkbox column visible, invented data only), poster checked.
- Independent final review (fresh reviewer, most capable model): "With fixes", no critical, one important, six minor. I1 (a kept saved application lost its own applied date, against decision 3A) fixed with test "keeps a saved kept application's own applied date" (failed first). M1 re-graded Important (the UI bundle reached `db/applications-repo.ts`: new `npm run build` warning that `node:crypto` was externalized, a latent browser failure if tree-shaking ever kept it, and an import cycle): `ATS_DOMAINS` moved to `src/server/domain/ats-domains.ts`, re-exported by `applications-repo.ts`; test "reach no module under src/server/db" failed first; the build no longer warns. M2-M6 wait for the user's decision.
- Decisions 9A-11A (2026-11-24): own names are registered before aliases in `groupThreadRecords`, `collectNewApplications` and `existingFor` (three tests, each failed first); "<n> selected" is an always-mounted `role="status"` and the "Merged …" line clears on the next selection change (test failed first); the mock-agent drift test renders lines with real aliases and compares ids, statuses and the company and role the mock read. That test passed at once, as a pin of working behaviour; a mutation check (alias field moved before `role`) showed the first version could not fail, so it was strengthened to compare names, and it then failed under the mutation and passed on the real code.
- Real use found one defect the jsdom tests could not show: after a merge the dialog re-rendered as "Merge 0 applications" while it animated closed, because the page clears its selection on success. The dialog now keeps the list it opened with; test "keeps the applications it opened with while it stays open" failed first, then passed; the browser re-check showed the title unchanged until the dialog closed.

## Validation

Acceptance criteria evidence:

- Select, Merge, pick, confirm, one row left: `test/ui/ApplicationsPage.test.tsx` "ApplicationsPage merging (SOW-0055)" (6 tests) and the browser walk-through on the mock sandbox (status line "Merged 2 applications into …", removed row gone).
- Field rules: `test/server/domain/merge.test.ts` (`mergedFields`, including the saved cases) and `test/server/db/applications-repo.test.ts` "keeps the kept application's own details and fills its gaps from the others".
- Rows moved: "moves history, status proposals and new-application proposals to the kept application" (counts per table).
- 7B: "rejects moved pending proposals that would not move the kept application forward" and "rejects a moved offer for a rejected application but keeps it for a withdrawn one".
- Aliases written: "remembers every removed name as an alias of the kept application".
- Aliases in sync: `test/server/domain/thread-grouping.test.ts` (4 alias tests), `test/server/services/mail-sync.test.ts` "aliases of merged applications" (4), `test/server/services/application-proposals.test.ts` alias accept, `test/server/mail/agent-source.test.ts` alias line, `test/server/tasks/prompts.test.ts` versions 7 and 2 with the rule.
- All or nothing: "changes nothing when it fails part-way" (temporary trigger aborts the delete).
- 400/404/409/415: `test/server/api/applications.test.ts` "POST applications/merge (SOW-0055)".
- Profile delete: `test/server/api/profiles.test.ts` counts `application_aliases`.
- Dashboard once: "counts a merged application once on the Dashboard, with the stages its moved history reached".
- Screenshot and video re-taken and checked; the user posted the new video as an attachment in an issue comment; the link answers 200 `video/mp4` without a login and its SHA-256 matches `docs/video/demo.mp4`; both README attachment links (lines 7 and 12) replaced.

Tests or equivalent validation:

- `npm test`: 88 files, 1504 tests passed (baseline 85 files, 1442). `npm run typecheck`: clean. `npm run build`: succeeds with no "externalized for browser compatibility" line.

Real-use evidence:

- Mock sandbox (`.tmp/sandbox-mock`, built app on port 0): API merge of two invented applications returned the kept one with the alias and filled notes and domains; the removed id answered 404; a mock Gmail sync succeeded and its prompt file listed `also_known_as: <company> - <role>` on the kept application's line. Browser walk-through (Playwright under `.tmp/`): selection bar, dialog preselecting the Interview application, merge, status line, "Also known as" on the application page, no console errors.

Reviewer findings:

- Builder check (design): three questions, answered by decisions 6-8.
- Final review: I1 and M1 fixed (see Execution Log); M2-M6 decided by the user (decisions 9-11) and handled as recorded there; the reviewer's declined-to-judge items (journey reach when keeping a lower stage, job shown as not tracked, duplicate pending proposals, interleaved history rows on the application page, a dropped selection not coming back, `|` or `;` in names, `stageOf` on prototype keys, no undo or alias editing) are Design calls, user decisions or pre-existing behaviour and stand.

Same-failure scan:

- `REFERENCES applications` in `migrations.ts`: `proposals`, `status_history`, `application_proposals`, `application_aliases`; the merge moves or removes all four, profile delete removes all four.
- Every `matchKey(` and `companyKey(` call in `src/server`: each one that compares an application name now includes aliases; the rest compare proposal or job names.
- `grep -rnE "shell: *true" src/server`: none. The `0.0.0.0` grep matches only `1_000_000` in `src/ui/format.ts` (regex dots), no bind address.

Sensitive data gate:

- The user's own data was read locally to diagnose and appears nowhere in durable artifacts (this SOW says "one company"). Tests, seed additions and screenshots use invented companies (Acme, Globex, Initech, Contoso Pharma, Northwind Health, Fabrikam) and invented ids.

Artifact maintenance gate:

- AGENTS.md: no change needed; no new command or workflow, and its sandbox-mock note already covers prompt line changes (the mock agent's drift tests pass unchanged).
- Runtime project skills: `.agents/skills/project-local-api/SKILL.md` (merge route, 409), `.agents/skills/project-agent-adapter/SKILL.md` (alias line, prompt versions, `stageOf`), `.agents/skills/project-testing/SKILL.md` (dialog exit animations in jsdom, UI imports never reaching `db/`, proving a pinning test can fail).
- Specs: `.agents/sow/specs/product-v1.md` (new "Merge applications (SOW-0055)" section, profile delete, prompt versions, destructive actions, `ATS_DOMAINS` location).
- End-user/operator docs: README Applications paragraph; `docs/images/applications.png`; `docs/video/demo.mp4` and `demo-poster.png`. Both README attachment links point to the new upload.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: in `current/`, `in-progress`; closes in one commit with the work once the video links are replaced and the minors are mapped.

Specs update:

- Done, as listed above.

Project skills update:

- Done, as listed above, including the three lessons in `project-testing`.

End-user/operator docs update:

- Done, including both README attachment links to the new upload.

End-user/operator skills update:

- None exist.

Lessons:

- jsdom has no exit animations, so a dialog whose props change on success can look right in tests and flash wrong content in a browser; the browser walk-through caught it.
- A UI import of a server domain module can pull in a `db/` module transitively; `npm run build` warnings are the signal, and the build belongs in validation whenever the UI imports server code.

Follow-up mapping:

- M2: implemented (9A). M4: status region and line clearing implemented; disabled-Merge hint, UI 50-row cap and naming the missing application rejected with reasons (10A). M3 and M5 rejected with evidence, M6 implemented (11A). Nothing deferred remains.

## Outcome

Users can merge applications they know are one. On Applications they tick two or more rows, press Merge, pick the one to keep (the furthest stage is preselected) and confirm. The kept application keeps its own details, fills its gaps from the others, takes over their history and proposals (backward-moving pending proposals are rejected), and remembers their names as aliases. Gmail sync, both prompts and the new-application checks treat an alias like the application's own name, own names first. A merge is refused while a Gmail sync of the profile is active, and it is all or nothing. Spec, README, screenshot, demo video and project skills are updated. 1504 tests pass, the typecheck is clean and the build has no warning.

## Lessons Extracted

- jsdom has no exit animations, so dialog content that changes on success is invisible to tests; the browser walk-through caught it. Recorded in `.agents/skills/project-testing/SKILL.md`.
- A UI import of a server domain module can reach `db/` transitively; `npm run build` warns, and a guard test now walks the imports. Recorded in `.agents/skills/project-testing/SKILL.md`.
- A test that pins working behaviour needs a deliberate break to prove it can fail; the first mock-agent alias test could not. Recorded in `.agents/skills/project-testing/SKILL.md`.
- The builder check before planning found a real design gap (mail under merged names would be lost), which became decision 6C; checking a design against the code with a fresh reader paid off before any code was written.

## Followup

None. Every review minor is implemented or rejected with its reason in decisions 9-11; the video upload is done.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
