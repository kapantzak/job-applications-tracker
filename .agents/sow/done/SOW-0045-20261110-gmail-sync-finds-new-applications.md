# SOW-0045 - Gmail sync finds new applications

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: implemented, validated and committed with the work on 2026-11-18 on branch `Fix-Gmail-sync`; the user asked for a PR.

## Requirements

### Purpose

Let Gmail sync work on its own: a user who never entered an application in the app can sync mail they already received and get their applications proposed from it, then keep getting status changes as before. Nothing is created or changed until the user accepts.

### User Request

The user installed v0.1.0, set the profile's custom Gmail search to a label search, and pressed "Sync from Gmail". The run succeeded at once and found nothing. After the investigation the user chose option C ("import applications from Gmail") and added: "I want this to work as standalone feature also. So, users could sync already received emails." Decisions 1-9 were answered "all recommended, but 6.A" (2026-11-10).

### Assistant Understanding

Facts:

- The run never reached the agent: `createMailSyncHandler` returns `no open applications` when the profile has no open application (`src/server/services/mail-sync.ts:25-29`). The user's data folder had no applications and no jobs; all three sync runs logged "No open applications to check" (run logs read locally, not copied here).
- The sync prompt only asks about listed open applications (`prompts/sync_mail.md`, v4); the output has `findings` keyed by `application_id` only (`src/server/tasks/schemas.ts:38-52`).
- A proposal must reference an existing application (`proposals.application_id TEXT NOT NULL`, `src/server/db/migrations.ts:106-117`); ownership, the pending list and the reviewed message ids all join through `applications` (`src/server/db/proposals-repo.ts:34-48`).
- Scheduled sync enqueues only profiles with open applications (`src/server/index.ts:174`, `applicationsRepo.profileIdsWithOpen`).
- Creating an application writes no `status_history` row, and the Dashboard relies on that: "the starting status is the earliest row's from_status" (`src/server/domain/dashboard.ts:91-94`).
- The agent only sees open applications, so a `saved` application (no applied date, excluded from sync, spec line 89) is invisible to it.
- Profile delete removes rows table by table in one transaction (`src/server/db/profiles-repo.ts:112-121`).

Inferences:

- A first sync over a label that holds months of mail can return many applications at once, hence the per-run cap and Accept all.
- ATS emails often carry job titles that differ from the posting title, so exact job linking (decision 6) will link only some applications.

Unknowns:

- How well real agents (Claude Code with the claude.ai Gmail connector, Codex) separate "I applied" mail from job alerts and recruiter outreach. This can only be measured in real use; the design keeps every result behind review.

### Acceptance Criteria

- With zero applications and a Gmail scope, Sync from Gmail calls the agent and stores pending new-application proposals from the mock agent (service test, e2e test, `npm run sandbox:mock` check on the empty profile).
- With zero applications and no scope, sync still runs, and the prompt limits new-application search to ATS domains and the last 90 days (prompt render test).
- Status findings for open applications behave exactly as before (existing mail-sync tests unchanged except for intended wording).
- Accepting a new-application proposal creates one application with the proposed company, role, status, applied date, sender domains and (when linked) job, and no history row (service and API tests).
- Accept all accepts every pending new-application proposal of the profile in one transaction, only after a confirmation dialog (API test, UI test with Cancel case).
- Rejected or accepted messages are never proposed again; duplicates of tracked applications or pending proposals are dropped (service tests).
- Another profile's new-application proposal is 404 on every route (API test).
- Profile delete removes the profile's new-application proposals (repo test).
- Scheduled sync includes profiles with a Gmail scope and no open applications (scheduler/index test).
- The output schema stays strict and is accepted by real `claude -p --json-schema` and `codex exec --output-schema` probes with a trivial prompt.

## Analysis

Sources checked:

- `src/server/services/mail-sync.ts`, `src/server/mail/agent-source.ts`, `src/server/domain/mail-filter.ts`, `prompts/sync_mail.md`, `src/server/tasks/schemas.ts`
- `src/server/db/proposals-repo.ts`, `applications-repo.ts`, `jobs-repo.ts`, `profiles-repo.ts`, `migrations.ts`
- `src/server/services/proposals.ts`, `src/server/api/proposals.ts`, `src/server/api/jobs.ts`, `src/server/api/dashboard.ts`, `src/server/runs/scheduler.ts`, `src/server/index.ts`
- `src/ui/pages/ReviewPage.tsx`, `src/ui/components/Layout.tsx`, `src/ui/components/dashboard/AttentionCard.tsx`, `src/ui/log-format.ts`, `src/ui/labels.ts`
- `scripts/sandbox-mock/mock-agent.mjs`, `scripts/sandbox-mock/seed.ts`
- `.agents/sow/specs/product-v1.md`, `README.md` ("How Gmail sync works")
- `.agents/skills/project-agent-adapter/`, `project-testing/`, `project-local-api/`

Current state:

- See Facts. Sync is a status-change tool for applications the user already entered; it has no path to create an application.

Risks:

- Noise: the agent may propose job alerts or cold outreach as applications. Mitigated by prompt rules, server-side duplicate checks and review before anything is created.
- Volume and time: a first sync over a large label can be slow; the run timeout is 20 minutes (`src/server/db/settings-repo.ts:25`). Cap of 50 new applications per run.
- Token cost: scheduled sync now also runs for scoped profiles without open applications (decision 9).

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Sync can only update applications that exist, and quits before calling the agent when none are open. The product needs a second outcome from the same sync run: proposals for applications the mail shows but the app does not track. Evidence: Facts above.

Evidence reviewed:

- Code and specs listed under Sources checked; the user's local run logs and database counts (read only, nothing copied into this file).

Affected contracts and surfaces:

- Prompt `sync_mail` v4 → v5; output schema adds `new_applications` (strict JSON schema; parse defaults it to `[]`).
- Database: migration 12 adds table `application_proposals`.
- API (new, profile-scoped, state-changing): `GET /api/profiles/:pid/application-proposals`, `POST .../application-proposals/:id/accept`, `POST .../application-proposals/:id/reject`, `POST .../application-proposals/accept-all`.
- `GET /api/profiles/:pid/dashboard` adds `pending_new_applications`.
- Run summary text of sync runs (also matched by `src/ui/log-format.ts`).
- Scheduler profile selection.
- UI: Review page, Layout badge, Dashboard Needs attention card, help text, empty-state wording.
- Mock sandbox: mock agent and seed.
- Docs: README "How Gmail sync works", spec `product-v1.md`, project skills `project-agent-adapter` and `project-local-api`.

Existing patterns to reuse:

- `createProposalsRepo` / `createProposalService` shape (transactional accept, `ProposalNotPendingError` → 409).
- `requireProposal` ownership check pattern in `src/server/api/proposals.ts`.
- `applicationsRepo.create` (no history row), `inferSenderDomain`, `ATS_DOMAINS`.
- `ctx.beginSaving()` before writes in the handler; migration runner conventions (`test/server/db/migrations.test.ts`).
- AlertDialog confirmation pattern from Jobs dismiss / Settings purge, with Cancel tests.
- Mock agent reading the rendered prompt (`scripts/sandbox-mock/mock-agent.mjs:100-135`).

Risk and blast radius:

- Status-change behaviour must not regress: the existing `findings` path stays as is; tests pin it.
- New table plus one nullable column on `proposals` (no rebuild), so existing rows and the `status_history.proposal_id` link are untouched.
- Profile delete gains one `DELETE` before `applications`, `jobs` and `runs` (foreign keys).
- `DELETE /api/runs/logs` removes log files only (`logStore.purge`, `src/server/api/runs.ts:65`), not run rows, so the new `run_id` reference is safe.
- The schema change reaches real agents: Codex rejects any non-strict schema with HTTP 400, so the strict-shape test and real probes are mandatory.

Sensitive data handling plan:

- The feature reads the user's real Gmail through their agent. Tests, mock data, seed and this SOW use invented companies (`Acme`), `example.com` addresses and ids like `msg-001` only.
- Real-use validation records counts and pass/fail only; never sender names, subjects, snippets, message ids or log lines from the user's mailbox.

Implementation plan:

1. Schema and prompt: `new_applications` item = `company`, `role`, `status` (`applied|screening|interview|offer|rejected`), `applied_at` (YYYY-MM-DD, earliest message), `sender_domain` (company domain or `''` when only an ATS wrote), `confidence`, `reason`, `evidence` (same shape as findings, latest message). Prompt v5 adds a "New applications" section and rules (any mail that shows the user applied; not job alerts, newsletters or recruiter outreach; at most 50; skip listed applications and reviewed ids). With a scope the whole scope; without a scope ATS domains and `after:<today-90d>`. The "Open applications" list renders `(none)` when empty; application line format and `# Task:` heading unchanged (the mock reads them). Files: `prompts/sync_mail.md`, `src/server/tasks/schemas.ts`, `src/server/mail/agent-source.ts`, `src/server/mail/types.ts`.
2. Storage: migration 12 `application_proposals` (`id`, `profile_id`, `run_id`, `company`, `role`, `status`, `applied_at`, `job_id` nullable, `url` nullable, `sender_domains` JSON, `confidence`, `reason`, `evidence` JSON, `state`, `application_id` nullable (set on accept), `decided_at`, `created_at`; index on `(profile_id, state)`). New `src/server/db/application-proposals-repo.ts`; `proposalsRepo.reviewedMessageIds` callers get the union with this table (decided and pending); profile delete updated.
3. Handler: remove the early exit; process `new_applications` after `beginSaving()`: trim and collapse whitespace, drop empty names, drop matches (case-insensitive company + role) against the profile's applications and pending new-application proposals, drop repeated message ids, keep at most 50, link `job_id` (decision 6) when exactly one job of the profile has the same normalized company and title and that job has no application, taking the job's URL. A match with a `saved` application becomes a status proposal for it (decision 10A); a match with any other existing application is dropped and logged. Summary: `N proposals created, M new applications found, K skipped` (+ scope note); `log-format.ts` regex updated. Files: `src/server/services/mail-sync.ts`, `src/server/domain/types.ts`.
4. Accept/reject service and API: transactional accept creates the application (no history row) and records `application_id`; if the linked job got an application meanwhile, the link is dropped; accept-all runs every pending one of the profile in one transaction and returns the count. Routes in a new router mounted from `src/server/api/profiles.ts`; ownership 404; client functions in `src/ui/api/client.ts`.
5. Scheduler: profiles with open applications or a non-empty Gmail scope (`src/server/index.ts`, new repo query).
6. UI: Review page section "New applications" above status changes (card: "Company - Role", "New application · <Status> · applied <date> (<n>%)", reason, evidence, Accept, Reject, Open in Gmail) and "Accept all new applications" with an AlertDialog; empty state mentions both kinds; Layout badge counts both; Dashboard card line "N new applications found"; help text in `src/ui/help-text.ts`.
7. Mock sandbox: mock agent returns two invented new applications (one linkable to a seeded job) and nothing for `nomatch` scopes; seed adds pending new-application proposals for the main profile; `test/server/sandbox-mock/` updated.
8. Docs and artifacts: README, spec, project skills, then validation and close.

Validation plan:

- TDD per chunk: `test/server/tasks/{schemas,prompts}.test.ts`, `test/server/mail/agent-source.test.ts`, `test/server/db/{migrations,application-proposals-repo,profiles-repo}.test.ts`, `test/server/services/{mail-sync,application-proposals}.test.ts`, `test/server/api/application-proposals.test.ts` (including other-profile 404 and 409 on a decided proposal), `test/server/runs/scheduler.test.ts`, `test/ui/{ReviewPage,Layout,dashboard-cards,log-format}.test.tsx`, `test/server/sandbox-mock/*`, e2e sync path in `test/e2e/discovery-flow.test.ts`.
- `npm run typecheck`, `npm test` (summary line recorded).
- Real schema probes: `claude -p` with `--json-schema` and `codex exec --output-schema`, trivial prompt, stdin from `/dev/null`.
- Manual: `npm run sandbox:mock`, sync the empty profile, accept one, Accept all, check Dashboard and badge.
- Real-use: with the user's permission, a real sync on a throwaway data dir with the user's label; record counts only.
- Independent reviewer per the project rule; same-failure scan for other places that assume "proposal ⇒ application" (`grep -rn "proposals" src`).

Artifact impact plan:

- AGENTS.md: update the `npm run sandbox:mock` note to name the sync output's new field as something the mock must follow.
- Runtime project skills: `project-agent-adapter` (prompt v5, `new_applications`), `project-local-api` (new state-changing routes, accept-all).
- Specs: `product-v1.md` sync, proposals, scheduler, Review, Dashboard and API sections.
- End-user/operator docs: README "How Gmail sync works", the Applications and Review tour lines, the sandbox paragraph.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: single SOW; move to `current/` when the gate is ready; close with the work in one commit.

Open-source reference evidence:

- None checked: the work is internal to this app's prompt, storage and UI; no external implementation is being followed.

Open decisions:

- All decisions resolved (1-10, see Implications And Decisions).

## Implications And Decisions

Recorded 2026-11-10 (user: "All recommended, but 6.A").

1. Trigger: **A**, the same "Sync from Gmail" run returns status findings and new applications in one agent call.
2. Evidence: **A**, any mail that shows the user applied (confirmations, recruiter replies, interview invites, rejections); not job alerts, newsletters or cold outreach.
3. Lookback: **A**, with a scope the whole scope; without one ATS domains and the last 90 days. At most 50 new applications per run.
4. Storage: **A**, new table `application_proposals`; `proposals` untouched.
5. Initial status: **A**, the status from the latest message, the applied date from the earliest.
6. Job linking: **A**, link to a job of the profile when company and title match exactly (assistant detail: case-insensitive, trimmed, whitespace collapsed; only when exactly one job matches and it has no application).
7. Review card: **B**, read-only; edit on the application page after accepting.
8. Bulk: **B**, "Accept all new applications" with a confirmation dialog.
9. Scheduled sync: **A**, also profiles with a Gmail scope and no open applications.

Assistant calls (reported to the user, open to change):

- Prompt version 5; `# Task:` heading and application line format unchanged.
- Server-side duplicate checks as in Implementation plan step 3.
- Dashboard Needs attention shows "N new applications found" on its own line.
- Accepting writes no history row, like Add application (a first history row would change the Dashboard's starting-status rule in `src/server/domain/dashboard.ts:91-94`). This replaces the earlier suggestion of an "Added as … · Accepted from a Gmail sync proposal" entry.
- Pending new-application proposals' message ids are sent to the agent as already reviewed.

10. **A** (user, 2026-11-11). Mail about a job the user only saved. Context: Jobs → Save creates an application with status `saved`; the agent never sees saved applications, so a confirmation for that job comes back as a "new application" with the same company and role.
    - A. Turn it into a status proposal for the saved application (Saved → Applied, or the later status), and set its applied date from the mail when accepted. Pros: no duplicate, the saved row moves on as the user would expect. Cons: the status-proposal accept path learns to set `applied_at` when leaving `saved`, and `applied` becomes a proposable status there.
    - B. Drop the finding and log it; the user marks the job applied by hand. Pros: smallest change. Cons: the mail evidence is lost for that job; the user must notice on their own.
    - C. Create a second application anyway. Cons: duplicates; not recommended.
    - Recommendation: **A** (long-term-best). It is the only option where saved jobs behave like the rest of the feature. Matches with closed applications (rejected, withdrawn, old offers) are dropped and logged in every option.

### Review round 1 decisions (user, 2026-11-11: "All recommended, but 13.C")

An independent reviewer found no deviation from decisions 1-10 and these gaps (each verified against the code):

11. **C.** Accepting a new-application proposal when the profile already tracks that company and role (or the linked job got an application) creates nothing: a `saved` match moves on to the proposed status with the mail's applied date (as 10A); any other match is recorded as accepted against the existing application and reported as already tracked. Accept all does the same per row.
12. **A.** A company and role from any new-application proposal of the profile (pending, accepted or rejected) is never proposed again; rejecting sticks even when later mail carries a new message id.
13. **C.** Profiles without a Gmail scope that share a mailbox can propose each other's applications; documented in README and spec, no code change.
14. **A.** The prompt carries an "Already tracked" list (applications that are neither open nor saved, plus every new-application proposal of the profile); the agent must not report those, so they cannot use up the 50-entry cap. Saved applications stay off the list so 10A keeps working.
15. **A.** Accept all sends the ids the page showed; only those are accepted.
16. **A.** An accepted new application's `status_changed_at` is the latest email's date (never in the future, never before its applied date), not the accept time.
17. **A.** With no applications and pending new applications, the Dashboard empty state says how many were found and links to Review.

Small fixes approved with them (S): S1 one malformed `new_applications` entry is dropped and logged instead of failing the run; S2 message ids of this run's status findings and of reviewed status proposals count as seen; S3 status and new-application proposals are saved in one transaction; S4 free-mail domains are never stored as a company sender domain; S5 repeats for one saved application within a response are dropped; S6 logs use cleaned names and name each dropped entry; S7 applied dates are never in the future; S8 SOW wording on decision 4 and a README grammar slip. Not acted on: the reviewer's speculation that status proposals could go backwards after an accept (no evidence of agent behaviour; the status-change path is unchanged by this SOW).

### Review round 2 decisions (user, 2026-11-11: "All recommended, but 20.B")

18. **A.** One real Gmail sync with the user's label search on a throwaway data folder, using the user's Claude Code; only counts are recorded.
19. **A.** Accept and Accept all report what happened (added, moved on, already tracked), and the Review page reloads the status cards after an accept that moved a saved application, so no stale "Saved → X" card stays.
20. **B.** Add the missing ATS and job-board senders `myworkdayjobs.com`, `icims.com`, `jobvite.com` and `teamtailor.com` to `ATS_DOMAINS` in this SOW (they also widen the existing unscoped status search and keep those hosts out of sender domains). This extends the host list in the v1 implementation plan (`docs/superpowers/plans/2026-11-05-job-applications-tracker.md:144`), which stays as written as the v1 record; the spec holds the current list.
21. **A.** Accept all keeps its limit of 1000 ids per request, an accepted limit: more than 1000 pending proposals needs 20+ syncs at 50 each without a review.

Note on decision 4: migration 12 also adds the nullable column `proposals.applied_at` (an `ALTER TABLE ADD COLUMN`, no rebuild) for decision 10A; `proposals` rows and queries are otherwise unchanged.

## Plan

See Pre-Implementation Gate → Implementation plan, plus the review round 1 items above.

## Execution Log

### 2026-11-10

- Investigation of the instant "no applications" sync; decisions 1-9 recorded; SOW drafted.

### 2026-11-11

- Decision 10A recorded; SOW moved to `current/`, gate `ready`.
- Chunk 1 (schema/prompt): `new_applications` in `SyncMailOutput`, prompt `sync_mail` v5, `new_applications_since` in `MailSyncRequest`, `(none)` for an empty application list. Tests first (RED 7, then GREEN).
- Chunk 2 (storage): migration 12 (`application_proposals`, `proposals.applied_at`), `src/server/db/application-proposals-repo.ts`, profile delete step. The migration index snapshot test gained the new index.
- Chunk 3 (handler): early exit removed; `src/server/domain/new-application.ts` (cleaning, matching, dates; written together with its tests, not test-first); `collectNewApplications` in `mail-sync.ts` with saved-application conversion (10A), duplicate checks, job linking (6A), the 50 cap; summary `<n> proposals created, <m> new applications found, <k> skipped`. Handler tests first (RED 22).
- Chunk 4 (service/API): `src/server/services/application-proposals.ts` (accept, reject, acceptAll in one transaction; job link dropped when the job got an application), 10A applied-date rule in `services/proposals.ts`, router `src/server/api/application-proposals.ts`, AppDeps/harness/index wiring, `DashboardResponse` with `pending_new_applications` added in the route (keeps the 21 `summarizeDashboard` calls unchanged).
- Chunk 5 (scheduler): `profileIdsWithOpen` renamed `profileIdsToSync`, now also profiles with a non-blank scope.
- Chunk 6 (UI): Review page sections and shared `ProposalCard` (card headings are now `h3` under section `h2`s), Accept all with AlertDialog, `formatDay`, Layout badge counts both kinds, AttentionCard line, To review tile sums both, Dashboard empty state mentions Sync from Gmail, help text (Gmail sync, Status, Sync interval), Applications intro, log-format lines.
- Chunk 7 (mock): seed adds a Saved → Applied proposal with `applied_at` and two new-application proposals on the rich profile (one linked to the Umbrella Health job), r6 summary updated; mock agent returns two invented new applications unless listed or `nomatch`. Tests and implementation written together.
- e2e: the sync step now also accepts a new application over HTTP.
- Docs: README (tour lines, How Gmail sync works, Dashboard note, sandbox paragraph), spec section "New applications from Gmail sync (SOW-0045)" plus edits, AGENTS.md sandbox note, skills `project-agent-adapter` and `project-local-api`.
- Screenshots re-taken (sidebar badge 3 → 6 on every profile screen; review, dashboard, run, applications content changed): dashboard, jobs, applications, review, run, profile-help, from `npm run sandbox:mock` data via a scratch `playwright-core@1.58.0` in `.tmp/shots`, cached headless Chromium, 1440×900, light, `en-GB` locale (matches the earlier images). Server stopped by its saved PID.

### 2026-11-11 (review rounds)

- Review round 1 (independent general-purpose reviewer over the whole diff): no high findings, no deviation from decisions 1-10; 7 medium and 8 low findings, each checked against the code. User decided 11-17 and approved S1-S8 (see Implications And Decisions).
- Implemented 11C, 12A, 14A, 15A, 16A, 17A, 13C (docs only) and S1-S8. Handler, mail source, UI and helper tests were written first and seen failing; the service tests for 11C/15A/16A were written just before the code and run only after it (failure not observed first).
- Review round 2 (fresh reviewer over the fixes): every item correct; it found the 14A list hiding a saved application behind a proposal with the same company and role, S6 logs missing for the saved branch and the cap, S1 not covering a non-list value, and blank message ids counting as used. All four fixed test-first (RED 7, then GREEN). Its remaining points are listed under Followup.

- Review round 2 decisions 18-21 recorded. 20B: four hosts added to `ATS_DOMAINS` (tests first, RED 7). 19A: `acceptMany` returns counts per outcome, the Review page shows them and reloads the status changes after a saved application moved on (tests first, RED 4). Spec updated for both.

## Validation

Acceptance criteria evidence:

- Zero applications, with or without a scope, sync calls the agent and stores new-application proposals: `test/server/services/mail-sync.test.ts` ("calls the source with an empty list…", "stores cleaned new-application proposals…"), `test/e2e/discovery-flow.test.ts`, and the mock sandbox run below.
- Without a scope the prompt limits the search to ATS domains and 90 days: `test/server/mail/agent-source.test.ts`.
- Status findings unchanged: the pre-existing mail-sync tests pass with only the summary wording updated.
- Accept creates one application with the proposed fields and no history row, or nothing when tracked (11C): `test/server/services/application-proposals.test.ts`, `test/server/api/application-proposals.test.ts`.
- Accept all only after confirming and only the shown ids: `test/ui/ReviewPage.test.tsx` (confirm and Cancel), API and service tests.
- Rejected or accepted company and role never return; duplicates dropped: mail-sync tests (12A, S2, S5, cap).
- Other profile's proposal is 404 on every route: API tests.
- Profile delete removes new-application proposals: `test/server/api/profiles.test.ts`.
- Scheduler includes scoped profiles without open applications: `test/server/db/applications-repo.test.ts`.
- Strict schema accepted by real agents: probes below.

Tests or equivalent validation:

- `npm test`: `Test Files  81 passed (81)`, `Tests  1287 passed (1287)`; no warning, `act(` or stderr lines in the output.
- `npm run typecheck`: no errors.
- `npm run build`: succeeded; `npm pack --dry-run` lists `prompts/sync_mail.md`.

Real-use evidence:

- Schema probes 2026-11-11 with a trivial prompt and the generated `sync_mail` schema: Claude Code 2.1.322 `-p --json-schema` returned valid structured output (5.9 s); codex-cli 0.163.0 `exec --output-schema` returned valid output (8.7 s). The agent-facing schema did not change in the review rounds (only the app's own parse did).
- Mock sandbox (`.tmp/sandbox-mock`, built app on 127.0.0.1): profile with 0 applications and no scope → sync `0 proposals created, 2 new applications found, 0 skipped`; second sync `… 0 new applications found, 2 skipped`; accept-all `{"accepted":2}`; next sync proposed status changes for both and no new ones. (Run before the review rounds; the review-round behaviour is covered by tests.)
- Real Gmail run (decision 18A, 2026-11-11): built app on a fresh throwaway data folder, Claude Code with the default sync settings, one profile with no applications and the user's custom label search. Run succeeded in 254 s: `0 proposals created, 50 new applications found, 0 skipped`; 24 Gmail tool calls in the log; no malformed, dropped or skipped entries; the scope matched mail. Proposals by status: 23 applied, 23 rejected, 3 screening, 1 interview; 10 with a company sender domain; confidence 0.65-0.95. Exactly 50 means the agent stopped at the prompt's limit, so more applications likely remain for the next sync. Only counts are recorded here; whether each proposal is a real application is for the user to judge on the Review page.

Reviewer findings:

- Round 1 and round 2 as recorded in the Execution Log; every finding fixed or decided (18-21).

Same-failure scan:

- `grep -rn "0.0.0.0" src bin`: only `1_000_000` in `src/ui/format.ts` (false positive).
- `grep -rn "shell: true\|exec(" src/server`: no spawn with a shell.
- No `.only`/`.skip` added (two pre-existing platform `skipIf`).
- Other code assuming "every proposal has an application": `api/proposals.ts`, `RunPage` (Review button for every sync run), `labels.ts`, dashboard and Layout counts checked; only the counts needed changes, made.

Sensitive data gate:

- Tests, seed, mock agent, screenshots and this SOW use invented companies, `example.com` addresses and `msg-*` ids only. The user's run logs and database were read locally during the investigation and nothing from them was copied. The six screenshots were checked: sandbox data only, no paths, no mail.

Artifact maintenance gate:

- AGENTS.md: `npm run sandbox:mock` note names the sync output's `new_applications` as something the seed and mock must follow.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` (prompt v5, untrusted output cleaned in the handler, probe record), `.agents/skills/project-local-api/SKILL.md` (new routes, accept-all body, ownership). `project-testing` unchanged: no new test convention (new tests follow the harness, fake timers and portal patterns it already describes).
- Specs: `.agents/sow/specs/product-v1.md` new section "New applications from Gmail sync (SOW-0045)" plus profiles, status pipeline, Dashboard and scheduler edits.
- End-user/operator docs: README tour lines, "How Gmail sync works", Dashboard note, sandbox paragraph; `src/ui/help-text.ts` (Gmail sync, Status, Sync interval); six screenshots in `docs/images/`.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: single SOW; closed as `completed` in `done/`, committed with the work in one commit.

Specs update:

- Done (see Artifact maintenance gate).

Project skills update:

- Done (see Artifact maintenance gate).

End-user/operator docs update:

- Done (see Artifact maintenance gate).

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- A sync that "succeeds" without calling the agent hid the real problem from the user; outcomes that did nothing should say so.
- Two review rounds found dedupe gaps unit tests had not covered (rejections returning, races with Accept all, tracked lists hiding saved applications); new-proposal kinds need explicit "what happens next sync" tests.

Follow-up mapping:

- Accept all outcome reporting and stale status cards: implemented (19A).
- Missing ATS hosts: implemented (20B).
- Accept all limit of 1000 ids: rejected as an accepted limit (21A; needs 20+ unreviewed syncs at 50 each).
- Reviewer speculation on backward status proposals after an accept: rejected (no evidence; the status-change path is unchanged by this SOW).
- No item left deferred; no new SOW needed.

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

None. Every reviewer point was implemented in this SOW or rejected with a reason (see Follow-up mapping).

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
