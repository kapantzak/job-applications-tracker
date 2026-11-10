# SOW-0042 - Custom search instructions

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: implemented, validated and committed with the work on 2026-11-10 (user approved commit and PR).

## Requirements

### Purpose

Let the user steer a single job search with their own words (issue #29, part A), without losing the safety rules and budget the discovery prompt carries.

### User Request

Issue #29 "Custom prompt": "Allow users to search for jobs with custom prompt. Allow users to run a prompt on their agent client and send data to the app." The user chose to deliver both behaviours as two SOWs (decision 1C): this SOW is part A, in-app custom instructions for a discovery run; part B, running a prompt in any agent client and importing its results, is SOW-0043.

### Assistant Understanding

Facts:

- `prompts/discover_jobs.md` (v4) carries the read-only rule, steps, budget and output contract; `renderProfile()` in `src/server/services/discovery.ts` renders the profile, including `Notes`, into it.
- Profile Notes already reach every search (`src/ui/help-text.ts` `profileNotes`); what is missing is text for one search only.
- `POST /api/profiles/:pid/runs/discover` accepts a strict body `{ mode }` (`src/server/api/runs.ts`); `queue.enqueue` returns the active run of the same mode and refuses the other mode with `ActiveRunConflictError` (`src/server/runs/queue.ts`, SOW-0016 decision 19).
- Codex receives the prompt as one argv element (`src/server/agents/presets.ts`, `promptVia: 'argv'`); Linux caps one argument at 128 KiB.
- Search rounds are labelled "<start time> · Default|Max effort" from `run_started_at` and `run_effort_mode` (`src/server/db/jobs-repo.ts` list, `src/ui/pages/JobsPage.tsx` `searchLabel`).
- The mock sandbox reads the discovery prompt's `## Known urls` section up to the next `## ` heading (`scripts/sandbox-mock/mock-agent.mjs`).

Inferences:

- Returning an active run whose instructions differ would hide that the click did not run what was asked, the same reason SOW-0016 refused the other mode.

Unknowns:

- Whether real agents always rank the app's rules above the user's text. The prompt says they do; an agent may still follow the user's text over a rule. Accepted as a residual risk (see Risks).

### Acceptance Criteria

- A discovery started with custom text sends it to every agent call of that run (Default: one; Max: all five workers) inside a "Candidate instructions for this search" section of the v5 prompt; a run without text renders `(none)` there. Verified by service tests on the rendered prompt.
- The text is trimmed, empty means none, and more than 2,000 characters is refused with 400. Verified by API tests.
- `runs.custom_prompt` (migration 10) stores the text, NULL without one; the Run page shows it; the Jobs page "Found in" label adds "· Custom" for such a round. Verified by repo, migration and UI tests.
- While a discovery is active, a request with the same mode and the same text returns that run; a different mode or different text is 409. Verified by queue and API tests.
- The Find jobs menu has "Custom search…", which opens a dialog with the text box, a Default/Max choice and Start; Max still asks for the Max confirmation. Verified by UI tests.
- The plain Find jobs click is unchanged and sends no custom text. Verified by UI and API tests.

## Analysis

Sources checked:

- Issue #29; `prompts/discover_jobs.md`; `src/server/services/discovery.ts`; `src/server/api/runs.ts`; `src/server/runs/queue.ts`; `src/server/db/runs-repo.ts`, `jobs-repo.ts`, `migrations.ts`; `src/server/domain/types.ts`; `src/server/agents/presets.ts`; `src/ui/components/FindJobsButton.tsx`, `MaxSearchDialog.tsx`; `src/ui/pages/JobsPage.tsx`, `RunPage.tsx`; `src/ui/api/client.ts`; `scripts/sandbox-mock/*`; `.agents/sow/specs/product-v1.md`; pending SOW-0005 and SOW-0039 (no overlap).

Current state:

- No way to add per-search text; the only free text reaching discovery is profile Notes.

Risks:

- Prompt injection by the user's own text: the user can only weaken their own search; the agent still runs with the preset's tool limits and the app still verifies links and validates output. The prompt places the section before Steps, Budget and Rules and states that those win.
- Prompt change: every discovery run gets v5 wording; the `(none)` default keeps a run without text close to v4.
- Migration 10 is an `ALTER TABLE ADD COLUMN` (nullable); no rebuild, no foreign-key work.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The discovery prompt is built only from the profile and known URLs, so the user cannot ask one search for something different (a sector, a company list, a region) without editing the profile for every search. Evidence: `renderProfile()` and `promptVars` in `src/server/services/discovery.ts`.

Evidence reviewed:

- Listed under Analysis; plus `.agents/skills/project-agent-adapter`, `project-local-api`, `project-testing`.

Affected contracts and surfaces:

- API: `POST /api/profiles/:pid/runs/discover` body gains optional `custom_prompt` (string, at most 2,000 characters after trimming).
- DB: migration 10 `runs.custom_prompt TEXT` (nullable).
- Types: `Run.custom_prompt: string | null`; `JobListItem.run_has_custom_prompt: boolean`.
- Prompt: `discover_jobs.md` v5 with `{{custom_prompt}}`.
- Queue: `enqueue` options gain `customPrompt`; conflict rule extended.
- UI: Find jobs menu, new `CustomSearchDialog`, Run page row, Jobs "Found in" label, `startDiscovery` client, help text.
- Mock sandbox seed (one custom round) and its test.
- Spec, README, project skills.

Existing patterns to reuse:

- `DiscoverBody` strict zod body and `readDiscoverBody`; `ActiveRunConflictError` → 409; `MaxSearchDialog` for the Max confirmation; `FIELD_HELP` + `InfoTip`; shadcn `Sheet`/`AlertDialog`, `Textarea`, `NativeSelect`/`RadioGroup` from `src/ui/components/ui/`.

Risk and blast radius:

- Discovery prompt for all runs (version bump to 5, pinned by `test/server/tasks/prompts.test.ts`).
- Run JSON gains a field: UI consumers ignore unknown fields; the seed and tests that build `Run` objects need the field.
- No change to sync, CV analysis, adapter argv, guard, or binding.

Sensitive data handling plan:

- The custom text is user data stored locally in SQLite and in the run's `prompt.md`, like profile Notes. Tests, seed and docs use invented text only. Nothing is logged beyond what the prompt file already holds.

Implementation plan:

1. Server: migration 10, types, runs repo create, queue enqueue conflict rule, API body, discovery prompt v5 and handler, jobs list flag. Tests first.
2. UI: client, Find jobs menu item, CustomSearchDialog (with Max confirmation), Run page row, Found-in label, help text. Tests first.
3. Mock seed: one custom round; seed test.
4. Spec, README, skills; full validation; review.

Validation plan:

- `npx vitest run` per file while working; `npm test`, `npm run typecheck`, `npm run build`.
- e2e `test/e2e/discovery-flow.test.ts` still passes.
- Manual: `npm run sandbox:mock`, start a custom search with the mock agent, check the Run page and Found-in label.
- Independent review of the diff.
- Same-failure scan: other `enqueue('discover_jobs'` callers and every place that builds a `Run` or `JobListItem`.

Artifact impact plan:

- AGENTS.md: no workflow change expected; the sandbox-mock note already covers prompt changes.
- Runtime project skills: `project-agent-adapter` (prompt v5, custom text section); `project-local-api` (discover body).
- Specs: `product-v1.md` discovery prompt, effort levels/discover body, runs, search rounds, Run page.
- End-user/operator docs: README Find jobs description; in-app help text.
- End-user/operator skills: none exist.
- SOW lifecycle: SOW-0043 (part B) created as pending; this SOW closes to done with the work.

Open-source reference evidence:

- None checked; the change is internal to this app's prompt and API.

Open decisions:

- All resolved (see Implications And Decisions).

## Implications And Decisions

User decisions, 2026-11-10:

1. Scope: **C** - both behaviours, as two SOWs; this SOW is part A, SOW-0043 is part B.
2. The custom text **adds to** the built-in prompt (**A**); the read-only rule, budget and output contract stay and take priority.
3. Kept **per search only** (**A**): stored on the run, shown on the Run page and in the Found-in label.
4. Accepted in **both Default and Max** (**A**); every Max worker gets the same text.
5. UI: a **"Custom search…" item in the Find jobs menu** opening a dialog (**A**), 2,000-character cap.

Derived rules (consequences of the decisions, stated to the user before approval):

- An active discovery with a different custom text is refused with 409, like a different mode.
- Length cap 2,000 characters, because Codex receives the prompt in argv.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-10

- SOW created with decisions recorded.
- Server: migration 10 `runs.custom_prompt`; `Run.custom_prompt`, `JobListItem.run_has_custom_prompt`, `CUSTOM_PROMPT_MAX` (`src/server/domain/types.ts`); runs repo create; queue conflict rule compares mode and instructions and treats empty text as none (`src/server/runs/queue.ts`); strict discover body with trimmed `custom_prompt` (`src/server/api/runs.ts`); `prompts/discover_jobs.md` v5; handler renders the instructions or `(none)` (`src/server/services/discovery.ts`); jobs list flag (`src/server/db/jobs-repo.ts`).
- UI: `src/ui/components/ui/dialog.tsx` from `npx shadcn@4.23.0 view dialog` with only the `cn` and button imports fixed (no package change); `CustomSearchDialog.tsx`; "Custom search…" item in `FindJobsButton.tsx`; shared `EFFORT_MODE_OPTIONS` in `labels.ts`; `FIELD_HELP.customInstructions`; Run page row; Found-in label; `startDiscovery` client.
- Deviation found by the same-failure search and fixed: `DashboardPage.tsx` also renders `FindJobsButton` and forwarded only the mode, so a custom search from the Dashboard would have lost its text. Both pages now forward the button's arguments as given.
- Mock sandbox: run `b3` of "Backend Engineering" carries invented custom instructions and prompt version 5.
- Section heading settled as "Candidate instructions for this search" (the prompt speaks to the agent, so "Your" would read as the agent's own).

## Validation

Acceptance criteria evidence:

- Instructions reach every agent call, `(none)` otherwise: `test/server/services/discovery.test.ts` ("a default run sends the custom instructions in the v5 prompt, and (none) without them", "a max run sends the same custom instructions to every worker"); `test/server/tasks/prompts.test.ts` (markers, section order, rule sentence).
- Trim, blank = none, 2,000 cap with message: `test/server/api/runs.test.ts` (four new tests plus two new 400 cases).
- Stored and shown: `test/server/db/migrations.test.ts` (migration 10), `runs-repo.test.ts`, `jobs-repo.test.ts`, `test/ui/RunPage.test.tsx`, `test/ui/JobsPage.test.tsx` ("marks a search with custom instructions in its found-in label").
- Conflict rule: `test/server/runs/queue.test.ts`, `test/server/api/runs.test.ts` ("POST discover with different instructions while a discovery is active is 409").
- Menu, dialog, Max confirmation, text kept, mode kept on resume: `test/ui/FindJobsButton.test.tsx` (six new tests); Jobs and Dashboard pages send the text (`JobsPage.test.tsx`, `DashboardPage.test.tsx`).
- Plain Find jobs unchanged: existing tests still assert `startDiscovery('pf1', 'default')` and the `{ mode }` body (`test/ui/client.test.ts`).

Tests or equivalent validation:

- `npm run typecheck`: no errors.
- `npm test`: "Test Files 76 passed (76)", "Tests 1125 passed (1125)", no warnings in the output.
- `npm run build`: succeeds (the existing UI chunk-size notice is unchanged by this work).

Real-use evidence:

- `npm run sandbox:mock` data with the built app on a random loopback port. API: a custom Default search stored the trimmed text, a plain request during it got 409 "A discovery run is already active", the run finished with prompt version 5 and its `prompt.md` held the text between the markers; the jobs list flagged the seeded and the new custom rounds.
- Browser (Chrome): the menu shows "Custom search…"; the dialog opens from it; after Cancel `document.body.style.pointerEvents` was empty and no dialog remained (the Radix menu-to-dialog risk did not occur); typing showed "46 / 2000"; Start opened the Run page with the "Custom instructions" row; "View jobs" showed the filter "… · Default · Custom".

Reviewer findings:

- Independent reviewer (subagent, fresh context, given the diff and the SOW):
  1. Dialog mode reset on reopen, contrary to the spec: fixed; a reopened dialog with text keeps its mode, a fresh one follows the menu (spec updated, two test assertions added).
  2. Menu item opening a modal dialog unverified in a browser: verified in Chrome (above).
  3. Queue did not treat `''` as none: fixed (`|| null`) with a test.
  4. SOW and prompt named the section differently: SOW aligned.
  5. User text can close the `INSTRUCTIONS>>>` fence early: accepted risk; only the user's own search is affected and `renderPrompt` substitutes once.
  6. 409 message does not say what conflicted: not changed; the message is an existing contract in the spec. Reported to the user as an opportunity.
  7. Seeded prompt versions out of order (`b4` v4 after `b3` v5): cosmetic mock data; not changed.

Same-failure scan:

- Every `FindJobsButton`/`startDiscovery` caller: `JobsPage.tsx`, `DashboardPage.tsx` (the gap above, fixed).
- Every `queue.enqueue` caller: `api/runs.ts` (discover, sync), `runs/scheduler.ts` (sync only); sync runs store NULL.
- Every builder of `Run`/`JobListItem` rows: found by typecheck (`test/ui/RunPage.test.tsx`, `RunsPage.test.tsx`, `JobsPage.test.tsx`), the seed, and `runs-repo`.
- Every renderer of the discovery prompt: `services/discovery.ts`, `test/server/tasks/prompts.test.ts`, `test/server/sandbox-mock/mock-agent.test.ts`.
- `grep -rn "shell: true\|exec(" src/server`: only regex and SQLite `exec`; `grep -rn "0.0.0.0" src bin`: nothing.

Sensitive data gate:

- Tests, seed, docs, SOWs and skills use invented text only ("Only fintech companies", "Only developer tools companies"). No run logs, mail data or personal data were copied. The sandbox data directory and its logs stay under git-ignored `.tmp/`.

Artifact maintenance gate:

- AGENTS.md: no change; its sandbox-mock note already requires seed/mock updates on prompt changes, which this SOW followed.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` (prompt v5, instructions section, argv cap), `.agents/skills/project-local-api/SKILL.md` (discover body and conflict rule).
- Specs: `.agents/sow/specs/product-v1.md` (prompt v5, discover body and migration 10, Find jobs menu and dialog, Found-in label, Run page row).
- End-user/operator docs: `README.md` new "Custom search" section and the sandbox description; in-app help `FIELD_HELP.customInstructions`. README screenshots unaffected: they show the "Frontend Platform" profile (SOW-0038), whose runs have no instructions, with the Find jobs menu closed.
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: part B tracked as SOW-0043 (pending). This SOW moves to `done/` as `completed` in the same commit as the work.

Specs update:

- Updated `.agents/sow/specs/product-v1.md` as listed above.

Project skills update:

- Updated the two skills listed above; `project-testing` unchanged because no new harness, fixture or test pattern was introduced.

End-user/operator docs update:

- README and in-app help as listed above.

End-user/operator skills update:

- None exist.

Lessons:

- A shared component's new callback argument must be checked at every mount: the Dashboard reused `FindJobsButton` and silently dropped the new argument; typecheck could not catch it because the extra parameter is optional.

Follow-up mapping:

- Issue #29 part B (import from any agent client): tracked, SOW-0043.
- Reviewer finding 6 (clearer 409 message): rejected for this SOW; the message is a specified contract and the behaviour is correct. Reported to the user as an opportunity.
- Reviewer findings 5 and 7: rejected with reasons above.

## Outcome

Users can add their own instructions to one discovery run from the Find jobs menu on the Jobs page and the Dashboard, in Default or Max mode. The instructions go to every agent call inside the v5 prompt, after the profile and scope and before the rules that win over them. They are stored on the run, shown on the Run page and marked on the Jobs page's search rounds.

## Lessons Extracted

- Recorded under Validation → Lessons. No skill change: the existing same-failure-search step caught it, so the workflow worked as written.

## Followup

- Part B of issue #29: SOW-0043 (pending).

## Regression Log

None yet.
