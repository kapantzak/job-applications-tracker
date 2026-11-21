# SOW-0051 - Complete Gmail sync over a large label

## Status

Status: completed

Sub-state: delivered; decisions 1-15 implemented and validated.

## Requirements

### Purpose

A Gmail sync over the profile's label or search must find every application in that mail, not the first 50, without the user re-running sync until nothing new appears.

### User Request

The user syncs with a Gmail search (`label:<name>`). The first sync found 50 applications, but the label holds more than 100 from the last four weeks alone, and running sync again finds more. Another local tool the user has picks up applications more completely. "Please improve the Gmail sync."

### Assistant Understanding

Facts:

- The prompt and the handler cap new applications at 50 per run (`prompts/sync_mail.md` v5 "at most 50 entries in total"; `src/server/services/mail-sync.ts:29` `NEW_APPLICATION_MAX = 50`). It was a deliberate SOW-0045 decision (3), with "the next sync looks again".
- The user's two real runs on 2026-11-20 returned 50 new applications, then 49 plus 2 status proposals: both stopped at the cap.
- The claude.ai Gmail connector's `search_threads` returns at most 50 threads per call (`pageSize` max 50) and returned no `nextPageToken` for a label of about 320 threads, at page size 50 and 5 (probed 2026-11-20 with IDs-only views). `resultCountEstimate` drifted between calls (319, then 328).
- Without a page token, the agent splits by date on its own. In the first run, three date windows came back with exactly 50 threads (cut off) and a span of about eight weeks was never searched. In the second run, one window before late October came back cut off. Two windows returned exactly 49 threads, which may be a cut-off 50 with one message filtered (working theory).
- One run already took 94-126 turns, about 5 minutes and $2.30-2.80 for about 50 applications.
- The sync argv loads every built-in tool; the agent spent turns on `Bash`, which was refused ("This command requires approval").
- The user's other tool runs one `claude -p` per sync over mail since the last sync minus one day, has the agent classify each message, and groups messages into applications in its own code. Its prompt asks the agent to "follow pagination", which the probe above shows cannot work past 50 threads; it works because each window is small. Its first import of the label was done interactively, not by its sync button.

Inferences:

- Removing the cap alone would not make one run complete: enumeration in a single agent run is unreliable past 50 threads, and a run over about 320 threads would likely exceed the 20-minute timeout and the agent's context.

Unknowns:

- Codex's and custom agents' Gmail tools were never probed for paging; the design keeps the app in control so it does not depend on them.

### Acceptance Criteria

- A scoped sync lists every thread in the scope and reports when it cannot confirm that (tests with the fake/mock agent; real run on the user's label).
- Threads are read in batches; new applications and status proposals come from every batch (handler tests).
- A later sync reads only threads that are new or got new mail since they were read (ledger tests; second real run reads few or no threads).
- No 50 cap: at most 500 new-application proposals per sync (handler test).
- Claude sync argv loads only the built-ins it needs (preset test; probe recorded).

## Analysis

Sources checked:

- `prompts/sync_mail.md`, `src/server/mail/agent-source.ts`, `src/server/mail/types.ts`, `src/server/services/mail-sync.ts`, `src/server/domain/mail-filter.ts`, `src/server/tasks/schemas.ts`, `src/server/tasks/prompts.ts`, `src/server/agents/presets.ts`, `src/server/runs/queue.ts`, `src/server/services/discovery.ts` (Max fan-out, `mapLimit`, failure note), `src/server/db/migrations.ts`, `src/server/db/profiles-repo.ts` (delete steps), `src/server/db/settings-repo.ts`.
- `.agents/sow/specs/product-v1.md` sections "Gmail scope per profile", "New applications from Gmail sync", runs and cancel.
- `.agents/sow/done/SOW-0045-20261110-gmail-sync-finds-new-applications.md` (decisions 3, 14A, real run), `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` (summary singular item; not touched here).
- The user's run logs under the data folder, read locally; only counts and query shapes were extracted, nothing copied here.
- The user's other tool (a local, private project; not open source): its sync server, prompt and design notes, read for approach only.
- Gmail connector tool schemas (`search_threads`, `get_thread`).

Current state:

- One agent run per sync; the agent searches, reads, classifies, groups by company and role and dedupes, all in its own context.

Risks:

- See the gate.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- R1, certain: the 50 cap in prompt and handler stops each run at 50 (evidence above).
- R2, verified: the Gmail search tool returns at most 50 threads and no page token, so completeness depends on how the agent splits dates, and it leaves gaps.
- R3, measured scale: one run per sync does not scale to a few hundred threads.
- R4, measured: the sync argv loads more tools than needed (see decision 6 probe).

Evidence reviewed:

- As in Analysis. No open-source repository was used as evidence.

Affected contracts and surfaces:

- Prompts: new `prompts/sync_mail_list.md` and `prompts/sync_mail_read.md`; `prompts/sync_mail.md` v6 for the no-scope path (decision 7).
- Schemas: new list and read outputs in `src/server/tasks/schemas.ts` (strict agent shape).
- `src/server/mail/agent-source.ts`, `src/server/mail/types.ts`, `src/server/services/mail-sync.ts`, `src/server/domain/new-application.ts`.
- DB: migration 13, table `mail_threads` (ledger); profile delete step.
- Presets: Claude sync argv (`--tools`).
- Run record: prompt version string, usage (decision 10), summary text and `src/ui/log-format.ts` patterns.
- UI: Run page usage row for sync (decision 10); help text and README "How Gmail sync works" (cap sentence).
- Mock agent and seed (`scripts/sandbox-mock/`), `test/server/sandbox-mock/*`, e2e sync path.
- Spec, `project-agent-adapter` skill.

Existing patterns to reuse:

- `mapLimit`, `notRun`, `sumUsage`, the failure note and "fail only when all fail" from Max discovery (`src/server/services/discovery.ts`).
- `toAgentSchema`/`outputJsonSchema`, `renderPrompt`, `extractLastJsonObject` via the adapter.
- `collectNewApplications` cleaning, matching and dedupe rules in `mail-sync.ts`; `cleanName`, `matchKey`, `toAppliedAt`, `cleanSenderDomain`.
- Per-call working folders (`runs/<id>/worker-<n>/`) and log prefixes.

Risk and blast radius:

- Cost: a first import of about 320 threads is about 17 read calls plus a list call. Rough estimate $6-12 (speculation; measured after implementation). Later syncs list the scope and read only changed threads.
- Time: runs go one at a time across profiles; a first import can take 15-25 minutes and other runs wait.
- Agent output is untrusted: thread ids, application ids and window dates are validated app-side; unknown thread ids are dropped.
- Grouping moves from the agent to the app: titles that differ between threads of one application can create two proposals (the user rejects one). Mitigation: decision 9.
- Migration adds a table only; no rebuild.
- Prompt growth: the read prompt carries only its batch's thread ids and the open applications.

Sensitive data handling plan:

- Tests, mock and docs use invented companies, ids and addresses. Real run evidence is recorded as counts, durations and costs only.

Implementation plan:

1. Schemas and prompts (list, read, sync_mail v6) with prompt and schema tests.
2. Migration 13 and `mail-threads-repo`, profile delete step.
3. Agent source: list call with coverage check and gap retries; read batches with bounded concurrency; per-call folders and logs.
4. Handler: grouping of thread records into findings and new applications, ledger writes in the save transaction, 500 cap, summary, usage.
5. Preset `--tools` change (decision 6) with argv tests.
6. Mock agent and seed, e2e, UI usage row and log-format.
7. Spec, skill, README, help text.
8. Real run on the user's label; independent review.

Validation plan:

- TDD per chunk; `npm test`, `npm run typecheck`.
- Real probes: strict schemas through `claude -p --json-schema` and `codex exec --output-schema` with a trivial prompt.
- Real sync on the user's label with a throwaway data folder: counts, cost, duration, coverage log lines; then a second sync to prove the ledger.
- Same-failure search for other single-run caps and `--tools` use.

Artifact impact plan:

- AGENTS.md: sandbox-mock line lists what the mock reads; add the new prompt headings.
- Runtime project skills: `project-agent-adapter` (prompts, connector paging fact, `--tools` probe, multi-call sync).
- Specs: `product-v1.md` Gmail sync sections.
- End-user/operator docs: README "How Gmail sync works", in-app help.
- End-user/operator skills: none exist.
- SOW lifecycle: this SOW; SOW-0005 summary item untouched.

Open-source reference evidence:

- None used; the comparison tool is a private local project.

Open decisions:

- None; 1-11 resolved below.

## Implications And Decisions

User decisions, 2026-11-20 ("All recommended"):

1. **C**: list first, then classify in batches; the app groups threads into applications.
2. **B**: no 50 cap; a safety cap of 500 new-application proposals per sync.
3. **A**: a ledger of threads read (thread id, latest message id); a thread is read again only when it got new mail.
4. **A**: the first sync of a scoped profile covers the whole scope.
5. **A**: load fewer tools during sync, after a probe. The probe changed the flag; see decision 6.

Decisions from the real run and the review (user, 2026-11-21: "12.A, 13.B, 14.B"):

12. **A**: threads that name a company but no role, whose company has no group in the sync, no open application and no application at all, become one new application with the role "Not stated" (the user edits it after accepting). Evidence: real run, 70 of 216 application threads named no role; 18 were placed; 46 threads from 29 companies with no thread naming a role were lost. Companies with two or more groups, open applications or applications stay skipped as ambiguous.
13. **B**: the furthest stage wins across an application's threads (a rejection ranks furthest; same stage, newest wins), and no finding proposes a stage that is not past the application's current one, for every sync. Evidence: review M3 (a late acknowledgement labelled `applied` hid an interview) and H2.
14. **B**: cheaper routine syncs in this SOW: a scheduled sync lists only recent mail; a manual Sync lists the whole scope. Second real run: re-listing 220 threads cost $1.20 with nothing to read. Design confirmed by the user with 15A: the scheduler marks its runs with the run input `{ "trigger": "schedule" }`; a scheduled sync lists from the day before the profile's last complete listing (`mail_listings`, added to the unreleased migration 13), or everything when there is none or the scope changed. Refinement made during implementation and reported to the user: the mark moves only when the listing covered every date and every thread that needed reading was read and recorded (failed batches, cap, pending proposal), so instead of a whole-scope fallback after an incomplete listing the next scheduled sync lists from the unchanged mark, which covers the same dates more cheaply and keeps review H1's fix working under recent-only listing.
15. **A** (user, 2026-11-21): clicking Sync while a scheduled sync is queued or running opens that run, as for any active run; its log says "Listing mail since <day>".

Detail decisions, 2026-11-20 ("All recommended"):

6. **A**: Claude sync gets `--tools ToolSearch` plus any built-in named in `allowed_tools_sync`. Probe 2026-11-20, Claude Code 2.1.329, the app's sync argv, one Gmail search matching nothing: current argv 110,074 input tokens, $0.35; `--tools ""` 612,940 tokens, $2.66 (it removes `ToolSearch`, so every MCP tool loads up front; decision 5 as first proposed would have made sync dearer); `--tools ToolSearch` 58,563 tokens, $0.19. Never `--tools ""` for sync.
7. **A**: profiles without a scope keep the single-run prompt (`sync_mail` v6): cap 500 and the rule to split a cut-off search. Without a scope there is no single query whose coverage the app could check.
8. **A**: 20 threads per read call, up to 3 calls at a time.
9. **A**: a thread with a company but no role joins that company's only group in this sync; else the company's only open application (status finding); else the company's only application of the profile; else it is skipped and logged.
10. **A**: sync runs record usage summed over every call; the Run page shows Usage for sync runs.
11. **A**: as Max discovery: failed read calls are noted in the summary ("; k of n batches failed"), the run fails only when every read call fails (or the list call fails), and only threads actually read go into the ledger. Cancel and shutdown save nothing, as today.

Design (follows from the decisions):

- List call (`prompts/sync_mail_list.md`, `# Task: list Gmail threads`): the agent searches the scope in date windows (`(<scope>) after:A before:B`), splits any window that returns 45 or more threads, and returns `windows: [{after, before, thread_count}]` (`''` for an open end, else `YYYY/MM/DD`) and `threads: [{thread_id, last_message_id}]`. The app treats windows with `thread_count < 45` as covered and computes the uncovered date ranges; up to 2 follow-up list calls ask for exactly those ranges. Ranges still uncovered are logged and the summary ends with "; some mail may not have been listed".
- `scope_message_count` is no longer asked for on scoped syncs: the app counts distinct listed threads; 0 with full coverage gives the "matched no mail" note.
- Threads to read: listed threads with no ledger row or a different `last_message_id`.
- Read call (`prompts/sync_mail_read.md`, `# Task: read Gmail threads`): the batch's thread ids, the open applications (same line format as `sync_mail`), ATS domains; output `threads: [{thread_id, application_id, company, role, status, first_date, sender_domain, confidence, reason, evidence}]` for application mail and `not_applications: [thread_id]` for the rest. Records for thread ids outside the batch are dropped; batch threads in neither list are not marked read.
- Grouping in the app (`src/server/domain/thread-grouping.ts`): a valid `application_id` or a company-and-role match with an open application makes a status finding from its newest record (dated on or after `applied_at`; status `applied` means no change); other records group by company and role into new applications (earliest `first_date`, status and evidence from the newest record); role-less records follow decision 9. Findings and new applications then go through the existing handler rules unchanged, with the cap at 500.
- Ledger: migration 13 table `mail_threads (profile_id, thread_id, last_message_id, read_at)`, primary key `(profile_id, thread_id)`, written in the same transaction as the proposals; threads behind a new application skipped by the cap are left out so the next sync reads them again. Profile delete removes the profile's rows.
- Per-call folders `runs/<id>/list-<n>/` and `runs/<id>/batch-<n>/`, log prefixes `[list]` and `[batch <n>]`.
- Run prompt version for scoped syncs: `list <v> + read <v>`.

## Plan

See the gate's implementation plan.

## Execution Log

### 2026-11-20

- Analysis, probes and SOW draft. No code changed.
- Decisions 6-11 recorded; SOW moved to current.
- Implemented test-first in chunks: schemas and prompts (`sync_mail_list` v1, `sync_mail_read` v1, `sync_mail` v6); `mail-coverage.ts` and `thread-grouping.ts`; migration 13 and `mail-threads-repo.ts` with the profile delete step; agent source list/read flow (`mapLimit` moved to `src/server/runs/map-limit.ts` and shared with discovery); handler grouping, ledger, 500 cap, summary notes, usage; Claude sync `--tools`; Run page Usage row and log formatter; mock agent list/read tasks; spec, skill, AGENTS.md, README; `docs/images/run.png` retaken (the Run page of a sync run now shows Usage).
- Independent reviewer (fresh agent, code only). Findings and handling:
  - H1 (thread marked read although its entry was skipped while a new-application proposal for it is pending; accepting that proposal later would never see the thread's reply): fixed, such threads stay unread while the proposal is pending. The role-less part of H1 is decision 12.
  - H2 (a re-read thread proposes the application's current status): fixed, a finding equal to the current status is no change. Backward moves are part of decision 13.
  - M1 (blank `last_message_id` disables change detection): fixed, such threads are read every time.
  - M2 (coverage trusts the agent's `thread_count`): accepted risk; on the real run every reported count equalled what the tool returned (19 of 19 searches).
  - M3 (newest record `applied` hides an older further stage): decision 13.
  - L1 (names from the earliest-answered, not earliest-started thread): fixed. L2 (agent ids written raw to the log could forge a line): fixed by quoting, also in the older "Dropping finding for unknown application" line. L3 (listed thread ids unchecked before reaching the read prompt): fixed, `^[A-Za-z0-9_-]{1,128}$`. L4 (blank company dropped a record with a valid application id): fixed. L5 (no limit on a whole sync's duration): accepted, as Max discovery; each call keeps the run timeout.
  - Test gaps closed: H1, H2, M1, L1-L4, and cancel while batches wait.

### 2026-11-21

- Decisions 12A and 13B implemented test-first (`ROLE_NOT_STATED`, furthest-stage selection, no finding at or below the current stage for every sync).
- Decision 14B/15A implemented test-first: `SCHEDULED_SYNC_INPUT` from the scheduler, `mail_listings` in migration 13, `uncoveredRanges(windows, from)`, `list_since` in the request, `unread` in the thread result, mark rule in the save transaction, log lines and formatter patterns. A real scheduled-path run found that a recent-only listing with no mail said "the Gmail scope matched no mail"; fixed test-first (the note needs a whole-scope listing).
- Docs: spec, adapter skill, README, Sync interval help text; `docs/images/settings.png` retaken (the Sync interval help it shows changed), cropped so no part of Settings → Agent shows.

## Validation

Acceptance criteria evidence:

- A scoped sync lists every thread and reports when it cannot confirm that: `test/server/domain/mail-coverage.test.ts`, `test/server/mail/agent-source.test.ts` (retries, uncovered ranges, failed follow-up), handler notes in `test/server/services/mail-sync.test.ts`; real run below (contiguous windows, all under the cut-off).
- Threads read in batches, proposals from every batch: agent-source batch tests (20 per batch, 3 at a time, partial failure), grouping tests, handler tests; real run 220 threads in 11 batches.
- Later syncs read only new or changed threads: ledger repo and handler tests; real sync 2 read none.
- No 50 cap, 500 safety cap: handler tests; real run 107 new applications (136 with 12A, replayed).
- Claude sync loads only ToolSearch and allowed built-ins: `test/server/agents/cli-adapter.test.ts`; probe numbers in decision 6.
- Decisions 12A, 13B, 14B, 15A: grouping, handler, scheduler, coverage and agent-source tests named after them; real scheduled run below.

Tests or equivalent validation:

- `npm test`: Test Files 84 passed (84), Tests 1379 passed (1379). `npm run typecheck`: clean. No `.skip` or `.only` added.

Real-use evidence (built app or real modules, throwaway data folder under `.tmp/`, Claude Code 2.1.329 default model, the user's own label search; counts only, nothing from the mail):

- Sync 1 (manual, 2026-11-20): succeeded in 8 min 11 s, $7.60 estimated, 1,990,779 input tokens. One list call made 19 searches, all `pageSize` 50 and `THREAD_VIEW_SUMMARY`, kept 10 contiguous windows, each under 45 threads; no follow-up list call needed. Every reported `thread_count` equalled the threads the tool returned. Two searches returned 49 with an estimate of 49 and were split anyway; their halves held 66 threads, so 49 was a cut-off page and the cut-off of 45 is needed. 220 distinct threads listed (the tool's whole-label estimate said 319-328; the windows sum to 224 and a thread can span two windows, so the estimate is taken as unreliable). 220 read in 11 batches, none failed: 216 application threads, 4 not. 0 status proposals (empty profile), 107 new applications, 52 threads skipped for no role (decision 12 came from this), 4 for no company.
- Sync 2 (manual, same data): listed 220, read none, 0 proposals, 2 min 50 s, $1.20 (decision 14 came from this).
- Replay of sync 1's 216 records through the final grouping (no agent call): 136 new applications (58 applied, 8 screening, 12 interview, 1 offer, 57 rejected), 29 of them "Not stated" covering 46 threads; 6 role-less threads still skipped as ambiguous, 4 without a company.
- Scheduled path (2026-11-21, real handler and Claude adapter driven by a script with the schedule run input, mark set to today): "Listing mail since 2026/11/20", one search `(label:jobapplications) after:2026/11/20`, 0 threads, nothing read, 15 s, $0.21 and 58,210 input tokens (against $1.20 for a whole re-listing); mark advanced. It wrongly ended with "the Gmail scope matched no mail"; fixed and tested.
- Schema probes (trivial prompt, 2026-11-20): Claude Code 2.1.329 `--json-schema` and codex-cli 0.163.0 `--output-schema` returned valid list and read output.
- Not run for real: Codex with a Gmail tool (none configured on this machine; README "Gmail access for other agents" already says sync needs one), and a scheduled sync through the real scheduler tick (hourly at the shortest; the scheduler's run input is unit-tested).

Reviewer findings:

- Independent reviewer, findings and handling in the Execution Log (H1, H2, M1, L1-L4 fixed; M2, L5 accepted with evidence; M3 and the role-less part of H1 became decisions 13 and 12).

Same-failure scan:

- Other prompt caps: `grep -n -i -E "at most [0-9]+|page token|pageToken|pagination" prompts/*.md` finds only the discovery budget (30 jobs, a deliberate budget) and the new split rules.
- `--tools ""` elsewhere: only the CV preset, which also passes `--strict-mcp-config`, so no MCP tools load.
- Agent text written raw to the log: the older "Dropping finding for unknown application" line had the same pattern and is quoted now; company and role log lines use `cleanName`, which collapses line breaks.
- No-shell scan from the adapter skill: no match.

Sensitive data gate:

- Durable artifacts (SOW, spec, skill, README, code comments, tests, mock) hold no mail content, names, addresses or message ids from the user's mailbox: real-run evidence is counts, durations, costs and query shapes; tests and the mock use invented companies and ids. The user's label query appears only as the generic shape `label:<name>` except in the probe numbers, which name no mail. The other local tool is described by approach only. `docs/images/run.png` and `settings.png` show seeded invented data, no paths and no Settings → Agent.

Artifact maintenance gate:

- AGENTS.md: updated (sandbox-mock line lists the list and read prompt sections the mock reads).
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` updated (connector paging fact, scoped sync flow, scheduled listing, `--tools` probe, usage). `project-testing` and `project-local-api` unaffected: no new test harness rule, no route, guard or bootstrap change (the scheduler change only adds a run input).
- Specs: `.agents/sow/specs/product-v1.md` updated (agent integration, profile delete, new-application cap, runs usage, new section "Scoped Gmail sync: list, then read", Scheduled sync).
- End-user/operator docs: README "How Gmail sync works", discovery/sync tool loading, Run page usage; in-app help `syncInterval`; screenshots `run.png` and `settings.png` retaken. The demo video does not sync (no sync step in `scripts/demo-video/record.mjs`), so it is unaffected.
- End-user/operator skills: none exist.
- SOW lifecycle: status `completed`, moved to `done/` in the same commit as the work.

Specs update:

- Done, as above.

Project skills update:

- Done, as above.

End-user/operator docs update:

- Done, as above.

End-user/operator skills update:

- None exist in this repository (AGENTS.md "Output/reference skills: none").

Lessons:

- See Lessons Extracted.

Follow-up mapping:

- Seeded sandbox sync logs still show the old single-run flow for labelled profiles: rejected, they are illustrative history and new mock syncs show the new flow.
- Review M2 (coverage trusts the agent's counts): rejected as a change; real run evidence shows the counts match, and the app has no independent count source.
- Review L5 (no whole-sync time limit): rejected, as Max discovery; each call keeps the run timeout.
- Backward moves for unscoped syncs: implemented with 13B (applies to every sync).
- Codex Gmail paging unprobed: no Codex Gmail tool on this machine; the flow does not depend on paging, so nothing to track.
- SOW-0005 summary singular item: untouched, stays tracked there.

## Outcome

A scoped Gmail sync now lists the whole label by date window, checks the windows for gaps, reads only new or changed threads in batches and groups them into applications in the app. On the user's label the first sync found 107 new applications (136 with decision 12A) instead of stopping at 50, a repeat sync read nothing, and a scheduled sync costs about $0.21 instead of $1.20. The cap is 500, sync runs record usage, Claude sync loads fewer tools, and status findings take the furthest stage and never move an application backwards.

## Lessons Extracted

- The claude.ai Gmail connector gives no page token; any "follow pagination" instruction is void past 50 threads. Recorded in the adapter skill.
- `--tools ""` is not "fewer tools" when MCP servers stay loaded: it removes ToolSearch and makes every MCP tool load eagerly (about 5x the tokens). Measure flag changes with the exact argv. Recorded in the adapter skill and spec.
- A real run found what tests could not: half the application threads name no role, and a recent-only listing tripped the "matched no mail" note. Run the real path before closing a change to agent-facing flows.
- A per-thread ledger plus recent-only listing must not mark threads read whose information was set aside, or they are never listed again; the mark has to wait for them.

## Followup

None open; see the follow-up mapping in Validation.

## Regression Log

None yet.
