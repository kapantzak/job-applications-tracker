# SOW-0047 - Bring the docs up to date with the code

## Status

Status: completed

Sub-state: implemented and validated on 2026-11-19 on branch `Update-docs`; committed with the work once the user approves the commit.

## Requirements

### Purpose

Users and contributors read the README, the in-app help, the spec, `AGENTS.md` and the project skills to learn what the app does. They must describe the shipped behaviour, not an earlier one.

### User Request

"Please ensure docs are up to date with the latest state of the code." The same request asks for a short demo video; that is tracked separately in SOW-0048 (decision 8A).

### Assistant Understanding

Facts:

- Every recent SOW (0040-0046) updated the README for its own feature; no audit across all docs had been done since SOW-0038.
- A read-only audit of README, spec, in-app help, `AGENTS.md` and the three project skills against the code (2026-11-19) found the discrepancies listed under Analysis. The surprising ones were re-checked by hand.

Inferences:

- Most drift is "incomplete" rather than "wrong": features grew small rules (limits, extra confirmations, extra filters) that the README never picked up.

Unknowns:

- None that block implementation.

### Acceptance Criteria

- Every item W1-W11 and I1-I14 under Analysis is fixed in the named file, or recorded under Validation as rejected with a reason. Verified by re-reading each changed line against the cited code.
- `npm run dev:server` starts a server that answers `GET /api/health` (decision 2A). Verified by running it.
- The mock agent reports a non-zero scope count for a labelled profile that has mail, so only "Scope Miss" shows "the Gmail scope matched no mail" (decision 3A). Verified by `test/server/sandbox-mock/mock-agent.test.ts`.
- "Sync from Gmail" has an ⓘ on Dashboard and Applications (decision 6B). Verified by UI tests.
- `npm test` and `npm run typecheck` pass.
- Affected screenshots re-taken (decision 7A).

## Analysis

Sources checked:

- `README.md`, `.agents/sow/specs/product-v1.md`, `src/ui/help-text.ts` and inline page intros, `AGENTS.md`, `.agents/skills/project-*/SKILL.md`, `docs/superpowers/*`.
- Code cited per item below.

Current state (wrong or outdated):

- W1 `README.md:163-164`: link badges. Code marks `ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN` as dead and only 404/410 as dead by status; other statuses, other errors, timeouts and more than 5 redirects are "Could not verify" (`src/server/verify/links.ts:9-11,59,72-78`).
- W2 `README.md:22-26`: Setup opens only when the chosen agent is not installed (`src/ui/App.tsx:26-36`); the first interactive start asks for the data folder first (`bin/jobtrack.js:99-117`).
- W3 `README.md:205`: permission mode and allow-list are Claude Code only; the read-only sandbox is Codex; a custom command gets none (`src/server/agents/presets.ts:180-232`).
- W4 `README.md:195`: UI label is "Allowed tools (sync)" in Settings → Permissions (`src/ui/pages/SettingsPage.tsx:33-40,107-127`).
- W5 spec `:174`: the UI bundles Manrope (`src/ui/main.tsx:6`), not the system font stack.
- W6 spec `:165`: seven screen intros are inline in page files (`ProfilePage.tsx:19`, `ApplicationsPage.tsx:129`, `JobsPage.tsx:257`, `SetupPage.tsx:58`, `ReviewPage.tsx:216`, `ProfilesPage.tsx:46,147,158`); the ⓘ list misses the Custom search and Import dialog fields.
- W7 spec `:1-5`, `AGENTS.md:247,308-309`: still call the spec "intended", wait for "v1 ships"/"SOW-0001 closes", and name the 2026-11-05 design doc the authority.
- W8 `project-agent-adapter/SKILL.md:54` says `RunKind`; code is `AgentRunKind | 'analyse_cv'` (`src/server/domain/types.ts`). `:84` same-failure grep `shell: true\|exec(` always matches `db.exec`/`RegExp.exec`.
- W9 `npm run dev:server` runs `src/server/index.ts`, which only exports `startApp` (`:119`); nothing starts.
- W10 `README.md:317` and `scripts/sandbox-mock/mock-agent.mjs:165`: a scoped profile with no applications reports `scope_message_count: 0`, so "Backend Engineering" (`seed.ts:444-445`) also shows "the Gmail scope matched no mail".
- W11 in-app text: Settings Agent section (`SettingsPage.tsx:86`) and Setup intro (`SetupPage.tsx:58`) omit CV analysis; Profile intro (`ProfilePage.tsx:19`) mentions only search; "Mail sync" and "Discovery runs" wording (`ApplicationsPage.tsx:129`, `ProfilePage.tsx:19`) where SOW-0039 uses "Gmail sync" and "job search"; Dashboard intro says every number links to applications, but To review links to Review (`help-text.ts:78`).

Current state (incomplete, decision 1B):

- I1 confirmations list `README.md:295` misses Delete profile (`ProfilesPage.tsx:97`), Max-effort search (`MaxSearchDialog.tsx:100`), Accept all new applications (`ReviewPage.tsx:192`); spec `:160` misses Remove CV (`ProfileCvCard.tsx:131`).
- I2 Command line block `README.md:267-278` differs from `--help` (`bin/jobtrack.js:4-16`): port default is the Settings port, fallback tries 10 ports (`src/server/index.ts:37,101-118`); `CI` set never opens the browser (`bin/jobtrack.js:128`).
- I3 first-run question is also skipped when a config file exists (`src/server/config/first-run.ts:35`).
- I4 CV limits: text cut at 50,000 characters, under 100 non-space characters refused, text files must be UTF-8, `.md`/`.markdown` vs `.txt` by name (`src/server/cv/extract.ts:7-8,41-58,96-103`).
- I5 CV states: "interrupted" badge and labels (`ProfilesPage.tsx:36-41`); Analyse again also after a failure (`CvAnalysisCard.tsx:214-235`); "Add the new items" only when the current list is not empty (`src/ui/cv-review.ts:90-92`).
- I6 known links in search and import prompts are capped at the 200 newest (`src/server/services/discovery.ts:33,237`).
- I7 found-again rule: only a 2xx/404/410 answer replaces the earlier check (`discovery.ts:173-178`).
- I8 profile form also has Notes and Gmail sync (`ProfileForm.tsx:181,185`); profile names at most 80 characters and unique (`src/server/domain/profile-name.ts:3`, `src/server/api/profiles.ts:87-90`).
- I9 Jobs table "Application" filter; "Found in" and "Application" filter only, not sort (`JobsPage.tsx:176-200`); Fit filter values (`JobsPage.tsx:85-99`).
- I10 Dashboard: needs-attention counts only applied/screening/interview and also lists waiting proposals and new applications (`src/server/domain/dashboard.ts:51,108-117`, `AttentionCard.tsx:42-55`); To review sums both kinds (`DashboardPage.tsx:174-178`).
- I11 run folder: imports keep the pasted answer as `input.json` (`src/server/runs/queue.ts:68,232`); Max effort adds `worker-N/` (`discovery.ts:287`).
- I12 Help & about items: "Star on GitHub", "Report an issue" (`HelpMenu.tsx:69-80`).
- I13 Moving devices `README.md:257`: Permissions and Port are their own Settings sections (`SettingsPage.tsx:107,185-202`).
- I14 Security: the Origin check applies to writes only; JSON bodies need `Content-Type: application/json` (`src/server/api/guard.ts:5,33-36`, `errors.ts:34-36`). Scheduled sync choices Off/1 h/6 h/24 h, first run one interval after start (`src/ui/labels.ts:20-25`, `src/server/runs/scheduler.ts:38`). Import errors 400/413/415 (`runs.ts:36-45`, `import-jobs.ts:57-67`).
- Skills, minor: `project-agent-adapter` Scope omits `services/import-jobs.ts` and `domain/new-application.ts`; `project-local-api:29,31` route list and 409 list are partial; `project-testing:35` omits the `new_applications`/"Already tracked" checks; `AGENTS.md:316` names `date-fns` as a devDependency, but it comes only through `react-day-picker`.

Risks:

- README growth: decision 1B adds detail; keep each addition to the section a user reads, one bullet where possible.
- UI text changes alter screenshots (decision 7A).
- The dev entry must not touch real user data.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Per-feature SOWs updated the README for their own feature but not the cross-cutting statements (confirmation list, security, first run, CLI block). Governance text in the spec and `AGENTS.md` was written before v1 shipped and never revisited. `dev:server` broke silently because no test or doc path runs it.

Evidence reviewed:

- The files and lines under Analysis; SOW-0038 to SOW-0046 artifact sections; `package.json` scripts; `tsup.config.ts`; `vite.config.ts` proxy (`/api` → `127.0.0.1:4173`).

Affected contracts and surfaces:

- Docs: `README.md`, `.agents/sow/specs/product-v1.md`, `AGENTS.md`, three project skills, `docs/superpowers/*` (one-line notes).
- UI text: `src/ui/help-text.ts`, intros in `SettingsPage.tsx`, `SetupPage.tsx`, `ProfilePage.tsx`, `ApplicationsPage.tsx`; new ⓘ beside "Sync from Gmail" on Dashboard and Applications.
- Dev tooling: new `src/server/dev.ts`, `package.json` `dev:server`.
- Mock sandbox: `scripts/sandbox-mock/mock-agent.mjs` scope count, its test.
- Screenshots: `docs/images/applications.png`, `profile-help.png`, `settings.png` if their visible text changes.

Existing patterns to reuse:

- `InfoTip` with a `FIELD_HELP` entry, as on the Find jobs button.
- `bin/jobtrack.js` startup and SIGINT/SIGTERM shutdown, for `dev.ts`.
- `test/server/sandbox-mock/mock-agent.test.ts` running the mock through the real custom adapter.
- Screenshot procedure in `AGENTS.md` (sandbox:mock, 1440×900 light, `en-GB`, scratch Playwright under `.tmp/`).

Risk and blast radius:

- Docs-only edits carry no runtime risk. UI text edits can break tests that match text; run the UI suite.
- `dev.ts` is not bundled by tsup (entry is `src/server/index.ts` only) and is not in the npm `files`, so the package is unaffected. It defaults to `.tmp/dev` so it never opens the user's real data directory (the `AGENTS.md` manual-check folder), and listens on 4173 because the Vite proxy targets that port.
- Mock change affects only the sandbox.

Sensitive data handling plan:

- No personal data involved. Screenshots come from `npm run sandbox:mock` invented data; never Settings → Agent or Settings → Data; each image checked before commit.

Implementation plan:

1. Code: `src/server/dev.ts` + `dev:server` script; mock scope count + test; ⓘ on Sync from Gmail + help entry + tests; intro wording (W11).
2. README: W1-W4, W10, I1-I14 items in their sections.
3. Spec: W5-W7, I1, ⓘ list, `JobListItem` fields, "Last job search" label.
4. `AGENTS.md` (W7, W9 command note, `date-fns`), project skills (W8 and minor items), `docs/superpowers/*` notes.
5. Validation: typecheck, tests, dev server run, sandbox check; re-take affected screenshots; independent review.

Validation plan:

- `npm run typecheck`, `npm test` (summary pasted).
- `npm run dev:server` then `curl` `/api/health` with a loopback Host.
- `npm run sandbox:mock`, sync "Backend Engineering": no scope-miss note; "Scope Miss" still shows it.
- Independent reviewer (fresh subagent) given the diff and the cited code.
- Same-failure scan: grep README/spec for other statements about link checks, Setup, confirmations, ports.

Artifact impact plan:

- AGENTS.md: W7 governance text, `dev:server` line, `date-fns` note.
- Runtime project skills: `project-agent-adapter` (W8, Scope), `project-local-api` (lists), `project-testing` (mock checks).
- Specs: `product-v1.md` as listed.
- End-user/operator docs: README, in-app help, screenshots.
- End-user/operator skills: none exist (`AGENTS.md`: "Output/reference skills: none").
- SOW lifecycle: this SOW closes to `done/` with the work in one commit; SOW-0048 (video) stays pending until this one is done.

Open-source reference evidence:

- None: no external repositories were needed; all evidence is in this repository.

Open decisions:

- None; decisions 1-8 below.

## Implications And Decisions

User decisions, 2026-11-19 ("1.B, 2.A, 3.A, 4.A, 5.B, 6.B, 7.A, 8.A"):

1. **B** Fix W1-W11 plus the incomplete items users run into (I1-I14); not every API edge case.
2. **A** Add a dev entry point so `npm run dev:server` starts a server (defaults: data `.tmp/dev`, port 4173 for the Vite proxy).
3. **A** Fix the mock scope count with a test.
4. **A** The spec and `AGENTS.md` name `product-v1.md` as the current contract; `docs/superpowers/` becomes historical.
5. **B** Add a one-line "historical" note to each `docs/superpowers/` file.
6. **B** Fix W11 wording and add an ⓘ beside "Sync from Gmail" on Dashboard and Applications.
7. **A** Re-take only screenshots whose content changed.
8. **A** Two SOWs: this one, then SOW-0048 for the video.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-19

- SOW created after the audit and decisions.
- Code: `src/server/dev.ts` (new) and `package.json` `dev:server`; `scripts/sandbox-mock/mock-agent.mjs` scope count with `test/server/sandbox-mock/mock-agent.test.ts`; ⓘ beside "Sync from Gmail" (`DashboardPage.tsx`, `ApplicationsPage.tsx`, `FIELD_HELP.syncFromGmail`) with tests in `test/ui/DashboardPage.test.tsx` and `test/ui/ApplicationsPage.test.tsx`; intro wording in `ProfilePage.tsx`, `SettingsPage.tsx`, `SetupPage.tsx`, `ApplicationsPage.tsx`, `help-text.ts` (dashboard).
- Docs: `README.md` (First run, Profiles, CV, discovery, link badges, search rounds, import errors, Gmail sync schedule, Gmail access, Security, Data and logs, data directory, moving devices, Command line, Interface, Development), spec `product-v1.md`, `AGENTS.md`, the three project skills, a historical note on each `docs/superpowers/` file.
- Screenshots re-taken from `npm run sandbox:mock` (scratch `playwright-core@1.58.0` under `.tmp/sow47/shots`, cached headless Chromium, 1440×900, light, `en-GB`): `dashboard.png` and `applications.png` (intro and new ⓘ), `profile-help.png` (intro). `settings.png` was already stale (its Sync interval help predated the "or a Gmail label or search" wording) and was re-taken cropped to Runs and Server as before.
- Deviation (reviewer finding 1 and 9): the dev entry exits when port 4173 is taken instead of moving to the next port, and keeps its data in `.tmp/dev-server` rather than `.tmp/dev`, which the `node bin/jobtrack.js` manual-check command also uses. Both serve decision 2A's intent (a dev server that never reaches real data); the user has not been asked about the folder name.
- Order note: the two ⓘ UI tests were written after the markup, not before.

## Validation

Acceptance criteria evidence:

- W1-W11 and I1-I14: each fixed in the file named under Analysis; the reviewer re-checked every new sentence against the cited code (see Reviewer findings). Skill minor items fixed in `project-agent-adapter`, `project-local-api`, `project-testing`.
- `dev:server`: `tsx watch src/server/dev.ts` answered `GET /api/health` with `{"ok":true,...,"dataDir":".../.tmp/dev-server"}`; SIGTERM released the port and left no WAL files. With another listener on 4173 it printed "Port 4173 is taken (is jobtrack running?)..." and exited 1.
- Mock scope: new test "reports a non-zero count for a scope with mail but no listed applications"; live sandbox sync of "Backend Engineering" ended "0 proposals created, 2 new applications found, 0 skipped" and "Scope Miss" ended "...; the Gmail scope matched no mail".
- ⓘ on Sync from Gmail: tests "explains Sync from Gmail next to its button" on both pages.

Tests or equivalent validation:

- `npm run typecheck`: passed.
- `npm test`: `Test Files  81 passed (81)`, `Tests  1296 passed (1296)`.

Real-use evidence:

- `npm run build`, `scripts/sandbox-mock/prepare.ts`, `node bin/jobtrack.js --data-dir .tmp/sandbox-mock --no-open --port 0`; syncs through the HTTP API as above; screenshots captured from the running app and inspected. Server stopped by its saved PID.

Reviewer findings:

- Independent reviewer (fresh subagent, diff and code only). Handled:
  1. Dev server could fall back to 4174 and leave `dev:ui` proxying to a real `jobtrack`: fixed, exits instead.
  2. README said all bodies must be JSON; the CV upload is `application/octet-stream`: fixed.
  3. "Could not verify" dropped other network errors: fixed.
  4. The schedule restarts after any Settings save, not only the interval: fixed.
  5. Help said sync "only reads mail", true only for Claude Code: now "Your agent is told to only read mail".
  6. Dashboard Agent card covers job searches and Gmail sync only: fixed.
  7. CV size sentence ambiguous: fixed.
  8. "discovery" wording remains in Jobs page text and field help: tracked in SOW-0005 (Settings and UI), not in this SOW's W11 list.
  9. Dev server and `node bin/jobtrack.js` manual check shared `.tmp/dev`: dev server now uses `.tmp/dev-server`.
  10. `app.close()` rejection unhandled in `dev.ts`: now reported with exit 1.

Same-failure scan:

- Spec and help text checked for other link-check statements (`unverified|could not verify|network error`): spec `:113` already lists DNS failure and connection refused; `FIELD_HELP.showDeadLinks` matches.
- Confirmation dialogs: reviewer counted every AlertDialog in `src/ui` (10) against the README list.
- `grep -rnE "shell: *true|\bexec(Sync)?\b[^(]*from '(node:)?child_process'" src/server`: no matches (the new skill check).

Sensitive data gate:

- Durable files contain no secrets, personal data or workstation paths. The four PNGs show only invented companies and `example.com` data; `settings.png` shows Runs and Server only (an earlier scratch capture that showed Settings → Agent with a workstation path stayed in `.tmp/` and was not used).

Artifact maintenance gate:

- AGENTS.md: updated (product authority, Specs note, `dev:server`, reviewer override, `date-fns`, screenshot lessons).
- Runtime project skills: `project-agent-adapter` (type name, Scope, same-failure grep), `project-local-api` (scoped routes, 409 list), `project-testing` (mock checks).
- Specs: `.agents/sow/specs/product-v1.md` header, `JobListItem`, "Last job search", confirmations, ⓘ list and intro locations, bundled font.
- End-user/operator docs: `README.md`, in-app help and intros, four screenshots, historical notes in `docs/superpowers/`.
- End-user/operator skills: none exist (`AGENTS.md`: "Output/reference skills: none").
- SOW lifecycle: `Status: completed`, moved to `done/`; SOW-0048 stays in `pending/`; SOW-0005 gains the wording-sweep item.

Specs update:

- Done, as listed above.

Project skills update:

- Done, as listed above.

End-user/operator docs update:

- Done, as listed above.

End-user/operator skills update:

- None exist.

Lessons:

- Per-feature SOWs keep their own README section current but miss cross-cutting lists (confirmations, security, first run, CLI block). See Lessons Extracted.

Follow-up mapping:

- "discovery" wording sweep: tracked in SOW-0005.
- Demo video: tracked in SOW-0048 (pending).
- Everything else in this SOW: implemented.

## Outcome

README, spec, in-app help, `AGENTS.md` and project skills match the code as of 2026-11-19. `npm run dev:server` works and cannot reach real data. The mock sandbox reports a scope miss only for `nomatch` scopes. Sync from Gmail has its own ⓘ.

## Lessons Extracted

- When a feature adds a confirmation, a filter, a CLI behaviour or a security rule, the README has a cross-cutting list for it (Interface confirmations, Security, Command line); check those lists, not only the feature's own section.
- A screenshot can go stale through help text alone; when changing `help-text.ts`, check whether any README image shows that popover open (`settings.png` shows Sync interval, `profile-help.png` shows Target roles).
- Playwright `boundingBox()` is viewport-relative; a `fullPage` clip needs `window.scrollY` added, or the crop lands on another section (here, one that shows workstation paths).

## Followup

- SOW-0005: "discovery" wording sweep.
- SOW-0048: demo video.

## Regression Log

None yet.
