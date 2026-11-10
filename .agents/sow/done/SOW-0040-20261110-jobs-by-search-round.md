# SOW-0040 - Jobs grouped by search round

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: completed 2026-11-10; work, artifacts and SOW move committed together.

## Requirements

### Purpose

Let the user see what each job search found, and keep the jobs from earlier searches accurate when a later search sees them again.

### User Request

The user asked what happens when a second job search runs on the same profile, chose to "group jobs by search round", and asked which of the gaps found in the analysis should be fixed. The user accepted every recommendation (decisions 1-7 below, 2026-11-10).

### Assistant Understanding

Facts:

- Every job stores the run that first found it: `jobs.run_id TEXT NOT NULL REFERENCES runs (id)` (`src/server/db/migrations.ts:299`). Runs are deleted only together with their profile (`src/server/db/profiles-repo.ts:118`).
- A later search drops a job it finds again as a duplicate and records nothing about it (`src/server/services/discovery.ts:240-242`).
- Links are checked before the duplicate check (`discovery.ts:226-232`), so a found-again job's link is already checked on every search and the result is thrown away.
- The Jobs page is one flat table with a Found date column and no run filter (`src/ui/pages/JobsPage.tsx`); the Run page's "View jobs" opens the whole list (`src/ui/pages/RunPage.tsx:198`).
- The verifier reports `dead` for 404/410, the Greenhouse soft 404 and the network errors `ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN`; anything else that fails is `unverified`; `httpStatus` is `null` when the site never answered (`src/server/verify/links.ts:68-77`).
- Table filters are client-side `values`/`text`/`date` specs over loaded rows, with state in the page URL keyed by column id (`src/ui/table-view.ts:6-26`). A values filter sorts options by label unless a static `order` is given.

Inferences:

- Sorting run options by their formatted label would not be chronological, so the values filter needs an option order taken from the rows (newest search first).

Unknowns:

- None; decisions 1-11 are recorded below.

### Acceptance Criteria

- The Jobs page can be filtered to the jobs one search first found; the Run page's "View jobs" opens the Jobs page with that filter set. Verified by UI tests and a sandbox check.
- A search that finds a known job again records when and in which search it was seen, and stores the fresh link check only when the site answered with a conclusive result (decision 10). Verified by discovery service tests on an in-memory database.
- Existing jobs get a last-seen value from their first search by the migration. Verified by a migration test with invented rows.
- Spec, README and the mock sandbox match the shipped behaviour.

## Analysis

Sources checked:

- `src/server/services/discovery.ts`, `src/server/db/jobs-repo.ts`, `src/server/db/migrations.ts`, `src/server/verify/links.ts`, `src/server/verify/canonicalize.ts`, `src/server/runs/queue.ts`, `src/server/api/jobs.ts`, `src/server/api/runs.ts`, `src/server/domain/types.ts`.
- `src/ui/pages/JobsPage.tsx`, `src/ui/pages/RunPage.tsx`, `src/ui/table-view.ts`, `src/ui/api/client.ts`.
- `scripts/sandbox-mock/seed.ts`, `scripts/sandbox-mock/mock-agent.mjs`, `test/server/sandbox-mock/`.
- `.agents/sow/specs/product-v1.md` (lines 25, 92, 99, 104, 114, 133), design document section on the run queue.
- Pending SOW-0005 (unrelated verifier hardening item) and SOW-0039 (labels); no overlap.

Current state:

- See Facts. A second search while one is active is handled by the queue (`queue.ts:196-210`) and is unchanged by this SOW.

Risks:

- A found-again job whose fresh check says `dead` leaves the default Jobs list (dead links are hidden, spec line 99). A network failure during link checks (`EAI_AGAIN`, `ENOTFOUND`) would mark every found-again job dead; decision 10 keeps the stored status unless the site answered.
- Migration on user databases: additive columns plus a backfill; no table rebuild.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Jobs from every search land in one list, and the app keeps only the first sighting of each job, so the user cannot see what a given search found, and a job's link status reflects only the day it was first found. Evidence: Facts above.

Evidence reviewed:

- The files under Sources checked. No external open-source references were needed: the change is local to this app's data model and UI.

Affected contracts and surfaces:

- Database: migration 9 adds two columns to `jobs`.
- `Job` / `JobListItem` types and `GET /api/profiles/:pid/jobs` (additive fields).
- `services/discovery.ts` save path, `jobs-repo.ts`.
- Jobs page filter and Found cell; Run page "View jobs" link.
- Spec `product-v1.md`; README Jobs section and `docs/images/jobs.png` if the table changes visibly; mock sandbox seed.

Existing patterns to reuse:

- Additive `ALTER TABLE` migrations (migrations 7 and 8).
- `insertMany` transaction in `jobs-repo.ts` for the save step.
- SOW-0029 table filters (`ColumnDef`, `values` filter, URL query state), and the filter-only `application` column in `JobsPage.tsx`.
- `formatTime` (`src/ui/format.ts`) and the effort mode labels used on the Run page.

Risk and blast radius:

- Discovery save path: found-again updates run inside the saving step, after `beginSaving()`, so cancel semantics do not change.
- Jobs API gains fields only; the UI is the only client.
- No change to the prompt, the queue, the agent adapters or mail sync.

Sensitive data handling plan:

- Tests, seed data and this SOW use invented companies and `example.com` URLs only. No run logs are copied.

Implementation plan:

1. Migration 9: `jobs.last_seen_at TEXT`, `jobs.last_seen_run_id TEXT REFERENCES runs (id)`, backfilled from `created_at` and `run_id`; new jobs write both on insert. Migration test.
2. `jobs-repo`: a key-to-job lookup and a `markSeenAgain` update (last seen, plus the link status when decision 10 allows it), run in the same transaction as the insert of new jobs. Repository tests.
3. `discovery.ts`: split duplicates into found-again (key already stored) and repeats within this run; update found-again jobs; keep the summary text as it is (assistant's call, see Implications). Service tests, e2e test still green.
4. Jobs list API: add the first search's `started_at` and `effort_mode` to each item for the filter labels. API test.
5. Jobs page: the "Found in" filter (decisions 9 and 11) with newest-first options; "Seen again <date>" under the Found date (decision 8). `table-view.ts` gains an option order taken from the rows if needed. UI tests.
6. Run page: "View jobs" links to the Jobs page filtered to that run. UI test.
7. Mock sandbox seed (last-seen values, at least one job seen again), spec, README and screenshot if the Jobs table changed visibly.

Validation plan:

- `npx vitest run` on each touched test file first, then `npm test` and `npm run typecheck` with the summary line in this SOW.
- Real use: `npm run sandbox:mock`, start a Default search, open "View jobs", check the filter and the Found cell; a found-again check through a discovery service test, because the mock agent returns new URLs on every call.
- Independent review of the diff before close.
- Same-failure search: every reader of `jobs.created_at` or `run_id` (`grep -rn "created_at\|run_id" src/server/db/jobs-repo.ts src/server/domain src/ui/pages`) to confirm none assumes first-found means last-seen.

Artifact impact plan:

- AGENTS.md: likely unaffected (no workflow or command change); the sandbox note already covers seed drift.
- Runtime project skills: `project-testing` gains a line if a new test helper or pattern appears; otherwise unaffected.
- Specs: `product-v1.md` jobs data model, discovery save rules, Jobs page and Run page lines.
- End-user/operator docs: README Jobs section; `docs/images/jobs.png` re-taken if the table looks different.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: one SOW, moved to `current/` on 2026-11-10 after decisions 8-11.

Open-source reference evidence:

- None checked; the work does not depend on external projects.

Open decisions:

- None; all decisions are recorded under Implications And Decisions.

## Implications And Decisions

Decided by the user on 2026-11-10 (all recommendations accepted):

1. A search round is one Find jobs run (1A). No new entity.
2. A found-again job keeps its first search and also records when and in which search it was last seen, with that search's link check (2C).
3. The Jobs page gets a filter for the search, and the Run page's "View jobs" opens the Jobs page with that filter set (3A). No group headers.
4. Gap "Known urls capped at 200": rejected. Repeats are dropped on save and each summary reports the duplicate count; raising the cap costs prompt tokens on every search, five times for Max (4A).
5. Gap "stale link status": fixed only for found-again jobs, through decision 2 (5B). A re-check of all jobs or a manual "Re-check links" button is not part of this SOW.
6. Gap "reposts appear as new jobs": rejected. Matching on company, title and location would merge distinct openings and lose one silently (6A).
7. Gap "jobs from before a profile edit stay": rejected. The search filter lets the user look at the latest search; re-judging fit needs an agent run (7A).

Decided by the user on 2026-11-10 (found by the review, finding 2):

12. A found-again job whose link now redirects is also matched by the link the agent returned, before redirects (12B). The usual case: a closed posting that now redirects to the company's board is no longer saved as a new "board page" job; the stored job gets "Seen again" and, when the site answered, status "Redirected". No schema change. Not covered: a job stored after a redirect whose original link now gives 404 (it needs the original link stored; option 12C, not chosen). Accepted risk: a known link that now redirects to a different posting does not create a new job.
    - Assistant's call: when both the link the agent returned and the page it redirects to are known jobs, the link the agent returned wins, because the check describes that exact link and a "board page" row saved by an earlier search must not keep the original stale.

Assistant's calls (the user can override):

- Run summary text stays "N new, M duplicates, X dead, Y unverified"; duplicates keep counting both found-again jobs and repeats inside one search.
- Dismissed jobs found again are updated (last seen, link status) and stay dismissed.
- The Jobs list API adds the first search's start time and mode to each item instead of the page loading the Runs list, which is capped at 200 runs.

Decided by the user on 2026-11-10 (all recommendations accepted):

8. Last seen shows as a second line "Seen again <date>" in the Found cell, only when the job was seen after its first search (8B). No new column; not sortable or filterable.
9. The search filter matches the jobs a search found first (`jobs.run_id`), so "View jobs" shows the "N new" of that search's summary (9A). Review note (2026-11-10): the Jobs page hides dead and dismissed jobs by default, so it shows N minus those; a search with "0 new" opens to "No rows match your filters". Accepted as the existing list rules, not a change of decision 9.
10. A found-again job takes the fresh link status only when the site answered (`httpStatus` not null) and the result is not `unverified`; otherwise its stored status and `verified_at` stay. Last seen is updated either way (10B). Network errors therefore never hide a known job.
11. The filter is named "Found in"; options read "<start time> · Default" or "<start time> · Max effort", newest search first (11A).

## Plan

See the Implementation plan in the gate.

## Execution Log

### 2026-11-10

- SOW created from the analysis; decisions 1-7 recorded.
- Decisions 8-11 recorded; SOW moved to `current/`, gate ready.
- Worktree had no `node_modules`; ran `npm ci` (lockfile unchanged).
- Migration 9 (`src/server/db/migrations.ts`) with test; existing migration count assertions bumped by one (`test/server/db/migrations.test.ts`).
- `Job` gains `last_seen_at`/`last_seen_run_id`, `JobListItem` gains `run_started_at`/`run_effort_mode` (`src/server/domain/types.ts`).
- `jobs-repo.ts`: inserts write last seen; `insertMany(runId, jobs, seenAgain)` updates found-again jobs in the same transaction; `list()` joins `runs`.
- `discovery.ts`: found-again jobs (key already stored, first time in this search) become sightings; the fresh check is kept only when `httpStatus !== null` and the status is not `unverified`.
- `table-view.ts`: values filters accept `rowLabel`/`rowRank` (labels and order from a row carrying the value), used by the Jobs "Found in" filter.
- `JobsPage.tsx`: "Found in" filter (URL key `run`) and "Seen again" line. `RunPage.tsx`: "View jobs" links to `jobs?run=<id>` for succeeded discovery runs.
- Deviation found during real use (not a design change): the values filter popover was a fixed 256 px and cut "Max effort" off the decision-11 labels; it now grows to at most 384 px (`TableView.tsx`). Reported to the user.
- `scripts/sandbox-mock/seed.ts`: last seen backdated with each job; Acme Robotics and Globex Analytics seen again by the Max search (its seeded summary already counted 2 duplicates). Seed test added.
- README (Tour Jobs line, Discovery notes, Interface table note), spec `product-v1.md`, `docs/images/jobs.png` re-taken.
- Independent review (general-purpose subagent, read-only, given the diff and the decisions). Findings and handling:
  1. Bug, fixed: `verifyLink` kept an earlier hop's status when a later hop failed with a network error, so a redirect followed by `EAI_AGAIN` read as a site answer and could hide a known job against decision 10. The catch path now returns `httpStatus: null` (`src/server/verify/links.ts`); test in `test/server/verify/links.test.ts`.
  2. Risk, open (decision 12): a known job is matched by the key after redirects, so a posting that now redirects elsewhere is stored as a new row instead of being found again.
  3. Fixed: one sighting per job per search, with the first conclusive check winning when several links lead to it (`discovery.ts`); test added.
  4. Fixed: migration 9 indexes `last_seen_run_id`, like `idx_jobs_run_id`, so the profile delete does not scan `jobs` per run.
  5. Fixed in wording: decision 9 note and spec; the Jobs page hides dead and dismissed jobs, so "View jobs" can show fewer than "N new".
- Implementation paused for decision 12 (Pre-Implementation Gate rule: a design question found during implementation goes to the user).
- User chose 12B; recorded under Implications And Decisions before code.
- Two failing tests first (`discovery.test.ts`: a known link that now redirects to an unknown page; both the returned link and its target known), then the fix in `discovery.ts`: the key of the returned link is used when it is a stored job, else the post-redirect key as before.
- Spec Search rounds bullet and README Discovery bullet updated for 12B; `project-testing` skill gains the `verdictHandler` note.

## Validation

Acceptance criteria evidence:

- Filter and "View jobs": `test/ui/JobsPage.test.tsx` (Found in via `?run=r1`, label of a search with no jobs listed, Seen again line) and `test/ui/RunPage.test.tsx` (`jobs?run=r1` for a succeeded run, unfiltered for a failed one). Sandbox check: "View jobs" on the seeded Max search opened `?run=<id>` with its 7 jobs; the Found in popover listed searches newest first with counts.
- Found-again jobs: `test/server/services/discovery.test.ts` (last seen with first search kept; fresh status when the site answered; kept on a network error or `unverified`; first conclusive check across links of one search; dismissed job updated and still dismissed; a known link that now redirects matched to the stored job; returned link preferred over a known redirect target) and `test/server/verify/links.test.ts` (redirect then `EAI_AGAIN` gives `httpStatus: null`).
- Migration backfill: `test/server/db/migrations.test.ts` "migration 9" (backfill from `created_at`/`run_id` on invented rows, index, foreign key).
- Spec, README and mock sandbox: updated; `test/server/sandbox-mock/seed.test.ts` checks the seeded sightings.

Tests:

- `npm run typecheck`: clean.
- `npx vitest run`: `Test Files 76 passed (76)`, `Tests 1093 passed (1093)` on 2026-11-10 after the 12B change.

Real-use evidence:

- `npm run sandbox:mock` with the built app: the Jobs list API returned `run_started_at`, `run_effort_mode`, `last_seen_at`, `last_seen_run_id`; a new Default search reported "5 new, 0 duplicates, 1 dead, 0 unverified" and "View jobs" listed its 4 visible jobs; Playwright screenshots of the Found in popover, the Seen again lines and the filtered list were inspected (not committed, except `docs/images/jobs.png`).
- Decision 12B: a scratch script (`.tmp/sow40/redirect-check.ts`, not committed) ran the real `verifyLink` and the discovery save step against a local `127.0.0.1` server whose job link starts answering 302 to `/board` between two searches. Result: "1 new, 0 duplicates, 0 dead, 0 unverified" then "0 new, 1 duplicates, 0 dead, 0 unverified"; one stored job, status `redirected`, first search kept, last seen by the second search.

Reviewer findings:

- Independent review (read-only subagent): five findings, all handled; see the Execution Log. Finding 2 became user decision 12 (12B, implemented).

Same-failure search:

- Readers of `jobs.created_at` and `jobs.run_id` (`grep -rn "created_at\|run_id" src/server/db/jobs-repo.ts src/server/domain src/ui/pages`): none assumes first found means last seen; profile delete removes jobs before runs.
- Dedupe key derivation (`grep -rn "dedupeKey(\|existingDedupeKeys" src scripts`): the discovery save step is the only lookup against stored keys; `scripts/sandbox-mock/seed.ts` writes keys from the canonical link, matching how stored jobs are keyed.
- Earlier-value-carried-into-a-failure-path (finding 1): `verifyLink` is the only loop that carries `httpStatus` across requests.

Sensitive data gate:

- SOW, spec, README, skill, tests, seed and code comments use invented companies (`Acme`, `Example Co`), `example.com` URLs and loopback addresses only. `docs/images/jobs.png` shows the mock sandbox's invented data and no Settings → Agent or Data screen. No run logs from `~/.job-applications-tracker/runs/` were read into any artifact.

Artifact maintenance gate:

- `AGENTS.md`: unchanged; no workflow, command or guardrail changed, and the existing sandbox note already requires seed updates when a migration changes (followed here).
- Runtime project skills: `project-testing` gains the `verdictHandler` note (discovery rules depend on `httpStatus`/`finalUrl`). `project-local-api`: unchanged, no route or guard change (the Jobs list response only gains fields). `project-agent-adapter`: unchanged, no prompt, adapter or parsing change.
- Specs: `product-v1.md` updated (JobListItem fields, Search rounds rules including 12B, Jobs and Run page UI, filter list, popover width).
- End-user/operator docs: README Tour, Discovery and Interface notes updated; `docs/images/jobs.png` re-taken. `src/ui/help-text.ts` checked: no wording about duplicates, search history or the Found column, so unaffected.
- End-user/operator skills: none exist (`AGENTS.md`: "Output/reference skills: none").
- SOW lifecycle: one SOW; status `completed` in `done/`, moved in the same commit as the work.

## Outcome

- Each job keeps the search that first found it and records the latest search that saw it again (migration 9).
- The Jobs page has a "Found in" filter, the Found cell shows "Seen again <date>", and "View jobs" on a successful search opens that search's jobs.
- Found-again jobs take the fresh link check only when the site answered; a known job whose link now redirects is matched instead of saving the redirect target as a new job.
- The verifier no longer reports an earlier hop's status after a later network error.

## Lessons Extracted

- A rule that matches new results to stored rows must check how the key is built on both sides. Here the stored key and the lookup key both used the post-redirect URL, which made a closed posting look like a new one; the analysis missed it and the review caught it.
- A value carried across loop iterations (`httpStatus` across redirect hops) must be reset on every failure exit, or a later failure reads as the earlier success.
- Captured in the `project-testing` skill (driving discovery with `[status, httpStatus, finalUrl]` verdicts); the key-derivation lesson is specific to this code and is recorded in the spec's Search rounds bullet.

## Followup

- Gap "known URLs capped at 200": rejected by user decision 4A (cost per search; duplicates are dropped and counted).
- Gap "stale link status" beyond found-again jobs, including a manual "Re-check links": rejected for this work by user decision 5B.
- Gap "reposts appear as new jobs": rejected by user decision 6A (would merge distinct openings).
- Gap "jobs from before a profile edit stay": rejected by user decision 7A.
- A job stored after a redirect whose original link later answers 404 is not matched: rejected by user decision 12 (12B over 12C; needs a new column).
- No other deferred items; the search for defer/later/follow-up/future/TODO/pending finds only these, the pending SOW-0005/SOW-0039 notes and template text.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
