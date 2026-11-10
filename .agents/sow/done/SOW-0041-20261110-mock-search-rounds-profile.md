# SOW-0041 - Mock profile with grouped searches

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: completed 2026-11-10; work, artifacts and SOW move committed together on PR #31.

## Requirements

### Purpose

Let a user of the mock sandbox see search rounds (SOW-0040) clearly: several searches, jobs found again, link status changes, and a live search that finds a known job again.

### User Request

"Can we add in the mocked data, a profile with grouped searches?" The user then accepted all recommendations (1A, 2A, 3B, 4A).

### Assistant Understanding

Facts:

- The rich profile "Frontend Platform" already has two successful searches (Default and Max) and two jobs seen again (`scripts/sandbox-mock/seed.ts`, `RUNS` r1/r2, `JOBS` `seenAgainIn: 'r2'`).
- The mock agent gives every job a new random link (`scripts/sandbox-mock/mock-agent.mjs`, `?mock-job=${nonce}-N`), so a live mock search never finds a known job.
- The discovery prompt lists the profile's known links under `## Known urls` (`prompts/discover_jobs.md`), newest first (`recentCanonicalUrls` in `src/server/db/jobs-repo.ts`).
- The seeded run log always fails worker 4 of a Max run (`runLog` in `seed.ts`), which matches only a summary with the failed-worker note.

Inferences:

- A second seeded Max run with all workers succeeding needs the run log to follow the summary's failed-worker note.

Unknowns:

- None.

### Acceptance Criteria

- The sandbox has a fifth profile with four successful searches, jobs seen again, one found-again job now Redirected, one now Dead, and a newest search with "0 new". Verified by `test/server/sandbox-mock/seed.test.ts` and a browser check.
- A live mock search returns the newest known link of the profile, so it reports a duplicate and the job shows "Seen again". Verified by `test/server/sandbox-mock/mock-agent.test.ts` and a sandbox run.
- README, Profiles screenshot and alt text match the new sandbox.

## Analysis

Sources checked:

- `scripts/sandbox-mock/seed.ts`, `scripts/sandbox-mock/mock-agent.mjs`, `test/server/sandbox-mock/*.test.ts`, `prompts/discover_jobs.md`, `src/server/db/jobs-repo.ts`, `README.md` (screenshots, sandbox paragraph), `AGENTS.md` sandbox and screenshot notes, `.agents/sow/specs/product-v1.md` (no sandbox content), SOW-0040.

Current state:

- See Facts.

Risks:

- The extra profile card changes `docs/images/profiles.png`; other README images show Frontend Platform screens and stay valid.
- The mock agent's repeat link applies to every profile with jobs, so live Frontend Platform searches also report duplicates.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Search rounds are hard to see in the sandbox: only two rounds in a crowded profile, no status change on a found-again job, and live searches never repeat a link (evidence in Facts).

Evidence reviewed:

- Files listed under Sources checked; SOW-0040 decisions 9, 10 and 12.

Affected contracts and surfaces:

- Mock seed (`seed.ts`), mock agent (`mock-agent.mjs`), their tests, README sandbox paragraph and Profiles image with its alt text. No app code, schema, API or prompt change.

Existing patterns to reuse:

- `RUNS`/`JOBS` specs with `seenAgainIn`, `touch()` backdating, `runLog()`, `workersFailedNote`/`hasFailedWorkers`; Playwright scratch capture under `.tmp/shots` (SOW-0038, SOW-0040).

Risk and blast radius:

- Sandbox only; seed tests catch drift. Frontend Platform data is unchanged.

Sensitive data handling plan:

- Invented companies, `example.com`/`example.org` links and the label `Jobs/Backend` only. The Profiles screenshot shows mock data only.

Implementation plan:

1. Seed: `rounds` profile "Backend Engineering"; four runs; eleven jobs; `firstStatus` for a found-again job whose status changed; `runLog` fails a Max worker only when the summary says so. Tests first.
2. Mock agent: return the first known link as an extra job. Test first.
3. README sandbox paragraph and Profiles alt text; re-take `docs/images/profiles.png`.

Validation plan:

- `npm run typecheck`, `npm test`; `npm run sandbox:mock` with a live Find jobs on Backend Engineering; Playwright check of the Found in filter and Seen again lines.

Artifact impact plan:

- AGENTS.md: unchanged unless a command changes (none planned).
- Runtime project skills: `project-testing` sandbox line checked for accuracy.
- Specs: none expected; `product-v1.md` does not describe the sandbox data.
- End-user/operator docs: README sandbox paragraph, Profiles image and alt text.
- End-user/operator skills: none exist.
- SOW lifecycle: second commit on the SOW-0040 branch (PR #31), decision 4A.

Open decisions:

- None.

## Implications And Decisions

Decided by the user on 2026-11-10 (all recommendations accepted):

1. A new dedicated profile holds the grouped searches (1A); Frontend Platform is unchanged.
2. Four successful searches: Default 28 days ago "5 new", Max 16 days ago "4 new, 3 duplicates" with one found-again job now Redirected and one now Dead, Default 6 days ago with new and found-again jobs, Default 1 day ago "0 new, 3 duplicates" (2A).
3. The mock agent also returns one link from the prompt's known links, so a live search finds a known job again (3B).
4. Shipped as a second commit on PR #31 with this SOW (4A).

Assistant's calls (the user can override):

- Profile "Backend Engineering" (label `Jobs/Backend`), created 30 days ago; invented companies Aperture Systems, Black Mesa Labs, Nakatomi Trading, Oceanic Air, Gringotts Payments, Weyland Freight, Monarch Data, Bluth Homes, Sterling Cooper Digital, Prestige Worldwide, Krusty Logistics.
- The 6-day-old search reads "2 new, 3 duplicates, 0 dead, 0 unverified".
- The Max search has no failed worker, so the Runs list shows a Max run both with and without one.
- The mock agent repeats the newest known link (first in the list), with the job's fields left generic; the app keeps the stored job's own fields.

## Plan

See the Implementation plan in the gate.

## Execution Log

### 2026-11-10

- SOW created with decisions 1-4; gate ready.
- Tests first: seed tests for the fifth profile, its four searches, its status changes and both Max run logs; a mock-agent test for the repeated known link. Six failed before the change.
- `seed.ts`: profile `rounds` "Backend Engineering", runs b1-b4, eleven jobs; `firstStatus` keeps a job's own link when it was redirected or closed after it was first found; `runLog` fails a Max worker only when the summary has the failed-worker note (the second Max run has none).
- `mock-agent.mjs`: reads the `## Known urls` section and returns its first link as one more job. The first version of the pattern could read past the section; it now reads only that section.
- README sandbox paragraph and Profiles alt text; `docs/images/profiles.png` re-taken from a fresh sandbox; AGENTS.md sandbox note and `project-testing` skill name the new dependency on `## Known urls`.

## Validation

Acceptance criteria evidence:

- Fifth profile and its searches: `test/server/sandbox-mock/seed.test.ts` ("gives Backend Engineering four searches whose summaries match the jobs they first found", "shows Backend Engineering jobs whose status changed when a later search found them again", "logs one result per surviving worker of each Max run, as its summary says", profile and scope lists).
- Repeated known link: `test/server/sandbox-mock/mock-agent.test.ts` ("repeats the newest known url once and nothing else from the list"), through the real custom adapter and the real discovery prompt.
- README, Profiles image and alt text updated.

Tests:

- `npm run typecheck`: clean.
- `npx vitest run`: `Test Files 76 passed (76)`, `Tests 1096 passed (1096)` on 2026-11-10.

Real-use evidence:

- `npm run sandbox:mock`: the profiles API listed Backend Engineering with 11 jobs, 0 applications and 4 runs. A live Default search on it reported "5 new, 1 duplicates, 1 dead, 0 unverified"; the duplicate was Krusty Logistics, the newest known job, now last seen by that search.
- Fresh sandbox, Playwright at 1440x900, light, en-GB (images under `.tmp/`, not committed except `docs/images/profiles.png`): the Jobs page lists 10 jobs (Gringotts Payments is dead and hidden), with "Seen again" lines on six; Black Mesa Labs shows Redirected; the Found in popover lists three searches with counts 2, 4 and 4, newest first; "View jobs" on the "0 new" search shows "A search with no jobs listed" and "No rows match your filters", as SOW-0040 decision 9 describes.

Reviewer findings:

- No separate reviewer: the change is sandbox data and a mock script, covered by its own tests and a browser check. Self-review found the known-links pattern reading past its section; fixed before the final run.

Same-failure search:

- Other code that reads a prompt section by heading in the mock agent: `syncMail` reads `## Mailbox scope` with the same section-bounded pattern; no unbounded pattern remains.
- Other places that assumed one Max run in the seed: `runLog` (fixed) and the seed test (fixed); `grep -rn "effort_mode = 'max'" test scripts` finds only the updated seed test and an unrelated migration test that sets the column.

Sensitive data gate:

- Invented companies, `example.com`/`example.org` links and the label `Jobs/Backend` only. `docs/images/profiles.png` shows the five mock profiles and no workstation path.

Artifact maintenance gate:

- `AGENTS.md`: sandbox note now names the discovery prompt's `## Known urls` section as a drift source.
- Runtime project skills: `project-testing` mock sandbox line updated the same way. Other project skills unaffected (no adapter, API or route change).
- Specs: no update; `product-v1.md` does not describe the sandbox data (`grep -n "sandbox\|Scope Miss" .agents/sow/specs/product-v1.md` matches only Codex's `--sandbox read-only` flag).
- End-user/operator docs: README sandbox paragraph and Profiles alt text; `docs/images/profiles.png` re-taken. Other README images show Frontend Platform screens, whose data did not change.
- End-user/operator skills: none exist (`AGENTS.md`: "Output/reference skills: none").
- SOW lifecycle: one SOW, `completed` in `done/`, committed with the work as the second commit on PR #31 (decision 4A).

## Outcome

- The mock sandbox has "Backend Engineering": four searches, jobs seen again, a closed posting now Redirected, one now Dead, an inconclusive check kept, and a newest search with no new jobs.
- A live mock search returns the profile's newest known link, so "Seen again" can be tried by clicking Find jobs.

## Lessons Extracted

- A mock that parses a prompt section must bound the match to that section; the first pattern could have picked a link from a later section. Recorded in the `project-testing` skill line on prompt-reading in the mock agent.

## Followup

- None. No item was deferred.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
