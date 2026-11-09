# SOW-0038 - In-app help, project links and README tour

## Status

Status: completed

Sub-state: delivered; committed with the SOW move to done; PR opened against `main` closing issue #8.

## Requirements

### Purpose

Make the UI self-explanatory so users know what each field asks for, and make the README a usable guide with screenshots (GitHub issue #8).

### User Request

- Issue #8: README documentation with screenshots (screen recordings optional); an info icon on every field describing the information it asks for; an explanation text on every screen.
- "I want to make the UI easy. Users should know what each field asks for. Also, update the README documentation."
- Follow-up: add a button that links to the GitHub repo, and possibly one asking users to star it, following best practice.
- Follow-up: document how to move data to another device without losing it.

### Assistant Understanding

Facts:

- Forms consistently use shadcn `Field` / `FieldLabel` / `FieldDescription` / `FieldLegend` (`src/ui/components/ui/field.tsx`); no label contains an icon today.
- `PageHeader` (`src/ui/components/PageHeader.tsx:14`) renders an optional `description`; Dashboard (`src/ui/pages/DashboardPage.tsx:142`), Application detail (`src/ui/pages/ApplicationDetailPage.tsx:90`) and Run (`src/ui/pages/RunPage.tsx:111`) pass none. Settings sections Runs and Server have no description (`src/ui/pages/SettingsPage.tsx:122,171`). The "Fill in by hand" step has no intro (`src/ui/components/CreateProfileFlow.tsx:43-56`).
- Fields without help: Remote and Notes (`src/ui/components/ProfileForm.tsx:138,158`); every field of `AddApplicationForm` and `ApplicationDetailPage`; Custom command (`src/ui/components/AdapterChooser.tsx:81`); the six permission inputs (`src/ui/pages/SettingsPage.tsx:108-118`); Run timeout and Sync interval (`src/ui/pages/SettingsPage.tsx:131,140`); checkboxes Show dead links, Show dismissed (`src/ui/pages/JobsPage.tsx:235-248`) and Show raw output (`src/ui/pages/RunPage.tsx:204-207`).
- Raw values shown in field controls: application status keys (`src/ui/components/StatusSelect.tsx:22-25`), sync interval `off/1h/6h/24h` (`src/ui/pages/SettingsPage.tsx:146`), adapter ids `claude/codex/custom` (`src/ui/components/AdapterChooser.tsx:64`), Run timeout in ms.
- `Popover` exists (`src/ui/components/ui/popover.tsx`, used by `TableView`); a `TooltipProvider` is mounted app-wide by `SidebarProvider`.
- The sidebar footer holds only `ThemeMenu` (`src/ui/components/Layout.tsx`, `SidebarFooter`).
- `package.json` `files` ships `README.md` to npm; `repository` is `kapantzak/job-applications-tracker` on GitHub.
- The database stores file names, never absolute paths (`src/server/db/migrations.ts:158`), so a copied data directory works at another path.
- `migrate()` (`src/server/db/connection.ts:15-37`) applies unknown migrations and ignores ids it does not know: an older app opening a newer database does not refuse it.
- Device-specific state lives in the database settings: `adapter_id`, `custom_command`, permission values and `port` (`src/server/db/settings-repo.ts:4-27`). Agent sign-in and the Gmail connector live in the agent CLI, not in the data directory.

Inferences:

- About 40 info icons are needed; their wording becomes product text and needs user review before coding.

Unknowns:

- Whether npmjs.com renders relative README image paths (handled by decision 8: absolute URLs).

### Acceptance Criteria

- Every form field in scope (decision 3) shows an info button that opens an explanation; verified by UI tests that open a sample of them and by a test that every help key is used.
- Every screen in scope shows an explanation line; verified by UI tests on the previously missing screens.
- Status, Sync interval and agent choices show readable labels; stored values unchanged; verified by tests.
- README has a screenshot tour near the top and a section on moving data to another device; screenshots come from `npm run sandbox:mock` (invented data).
- Project links per decisions 9-10.

## Analysis

Sources checked:

- GitHub issue #8; `README.md`; `src/ui/**` (inventory of screens and fields); `src/server/db/*`; `package.json`; `.agents/sow/specs/product-v1.md`; pending SOW-0005 (no overlap).

Risks:

- Screenshots go stale on every UI change.
- Help text that is wrong is worse than none; all wording is reviewed by the user first.
- Added buttons inside labels must not change accessible names that tests query by label.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Fields and some screens give no explanation of what they ask for or how the app uses the value; some controls show internal identifiers. Evidence in Facts above.

Evidence reviewed:

- See Analysis. No external open-source repositories were checked; the work uses local components only.

Affected contracts and surfaces:

- UI: `ProfileForm`, `SeniorityInput`, `MailScopeInput`, `TagInput`, `CvReviewSheet`, `AddApplicationForm`, `ApplicationDetailPage`, `AdapterChooser`, `AgentModelFields`, `SettingsPage`, `JobsPage`, `RunPage`, `FindJobsButton`, `DashboardPage`, `CreateProfileFlow`, `StatusSelect`, `Layout`.
- New: shared `InfoTip` component, `src/ui/help-text.ts`.
- Docs: `README.md`, `docs/images/*.png`. Spec: `.agents/sow/specs/product-v1.md` (UX rule for field help and screen intros).
- Tests under `test/ui/`.

Existing patterns to reuse:

- shadcn `Popover`, `Field*` components, `PageHeader.description`, `STATUS_LABELS` in `src/ui/labels.ts`, `npm run sandbox:mock` seed data, Radix portal testing rules in `.agents/skills/project-testing/`.

Risk and blast radius:

- UI-only, display-only; no API, schema or stored value changes. Main regression risk is label-based test queries and keyboard focus order.

Sensitive data handling plan:

- Screenshots use only the invented sandbox-mock data. No real run logs, mail or CVs in any artifact.

Implementation plan:

- See `## Plan` (10 ordered chunks).

Validation plan:

- `npm run typecheck`, `npm test`, manual check in `npm run sandbox:mock`, independent reviewer.

Artifact impact plan:

- AGENTS.md: likely unaffected; record if the screenshot command becomes canonical.
- Runtime project skills: `project-testing` may gain the info-button test pattern.
- Specs: `product-v1.md` gains the field-help and screen-intro UX rules and project links.
- End-user/operator docs: `README.md` tour, data-move section, help mention.
- End-user/operator skills: none exist.
- SOW lifecycle: this SOW only.

Open-source reference evidence:

- None checked; not relevant to local UI copy and components.

Open decisions:

- Decisions 1-11 resolved; Help Text Draft approved by the user 2026-11-09.

## Implications And Decisions

1. Info icon behaviour: A, click-to-open popover (ⓘ button beside the label). User chose the recommendation, 2026-11-09.
2. Existing help text: A, keep short visible hints needed to fill the field (format rules, errors, warnings); the icon explains meaning and use. 2026-11-09.
3. Scope of "every field": A, every form field (Profile form incl. Seniority and Gmail sync, CV review, Add application, Application detail, Setup, Settings, the three checkboxes, the Find jobs mode menu); not table search/filters or the theme menu. 2026-11-09.
4. Screen explanations: A, add missing one-line intros (Dashboard, Application detail, Run, Settings Runs and Server, Fill in by hand) and reword unclear existing ones. 2026-11-09.
5. Raw values: A, readable display labels for Status, Sync interval and agent choices; stored values unchanged; Run timeout stays in ms with the unit explained. 2026-11-09.
6. Help text location: A, one `src/ui/help-text.ts` plus a shared `InfoTip` component. 2026-11-09.
7. README screenshots: A, PNGs of key screens from `npm run sandbox:mock`, captured with Playwright via `npx` (no new dependency), stored in `docs/images/`, with a Tour section near the top. 2026-11-09.
8. README image links: B, absolute `raw.githubusercontent.com/.../main/...` URLs so they render on GitHub and npm. 2026-11-09.
9. Project links: C, a "Help & about" menu in the sidebar footer (next to the theme menu) with the app version, Documentation (README), GitHub repository, Star on GitHub and Report an issue. 2026-11-09.
   - Version comes from the existing `GET /api/health` (`src/server/api/setup.ts:12`, `getHealth` in `src/ui/api/client.ts:118`); no build change needed.
   - lucide-react 1.70 ships no GitHub brand icon (checked `node_modules/lucide-react/dist/esm/icons`); the GitHub mark is an inline SVG.
   - All links open in a new tab with `rel="noopener noreferrer"`. No star count and no call to the GitHub API.
10. Star request: A, a passive "Star on GitHub" menu item only; no prompts, no counts, no incentives. 2026-11-09.
11. Moving data to another device: A, README section only; no export/import command. 2026-11-09. User declined a version-guard SOW (an older app opening a newer database is documented as a risk instead).
12. Raw ids in Review, Run and Runs display text: A, track as a pending SOW (`.agents/sow/pending/SOW-0039-20261109-readable-run-and-proposal-labels.md`). 2026-11-09.
13. Committed screenshot script: B, rejected. Re-taking the 8 images is rare, the procedure and its privacy hazard are in `AGENTS.md`, and a committed tool would add `playwright-core` as a dev dependency. 2026-11-09.
14. Commit: B, one commit with the SOW move to done, plus a PR closing issue #8. 2026-11-09.

## Help Text Draft

Status: approved by the user 2026-11-09. Superseded by `src/ui/help-text.ts`, which is the authoritative wording: seven lines were corrected for accuracy during implementation and review (Applied date, Fill in by hand intro, Permission mode, Show dead links, Custom command, Run timeout; see Execution Log). Popover text appears behind an ⓘ button named "About <field>". Visible hints stay as they are (decision 2). Keys live in `src/ui/help-text.ts`.

### Profile form (`ProfileForm`, `SeniorityInput`, `MailScopeInput`; also reused as CV review sheet headings)

- **Name**: A name for this search, for example "Platform roles". It names the profile in your list and in its address (`/profiles/platform-roles`), so renaming it changes the address. Your agent never sees it.
- **Target roles**: The job titles you want, for example "Platform engineer". Discovery searches for these titles and close variants.
- **Locations**: Cities, countries or regions you can work in, for example "Berlin" or "European Union". Discovery marks whether each job's location matches (Fit column). A remote job open only to other countries does not match. Leave empty to accept any location.
- **Remote**: Remote, hybrid or on-site. Discovery checks each job against it (Fit column). Any accepts all three.
- **Seniority**: The levels you are aiming for. Discovery checks each job's level against them (Fit column). Pick more than one if you are open to it; use Other for a level the list lacks, such as IC4.
- **Keywords**: Skills, tools or fields a good match should involve, for example "Kubernetes" or "fintech". Discovery uses them to judge which jobs fit you.
- **Excluded companies**: Companies you never want to see, such as your current employer. Discovery is told to leave them out; the app does not filter them itself, so a rare one may slip through.
- **Notes**: Anything else the search should know, in your own words: visa needs, a salary floor, industries to avoid. Discovery reads it with the other fields. A profile created from a CV gets a short summary of your experience here.
- **Gmail sync** (legend): Where sync looks for replies about this profile's applications. Empty: your agent searches mail from the companies you applied to and from job-board senders. A label or search limits sync to that mail, from any sender, which keeps two profiles' replies apart.
- **Label name**: The label exactly as Gmail shows it, for example `Jobs/Frontend`. Create the label and a Gmail filter that applies it to replies yourself; the app only reads mail and never labels it.
- **Gmail search**: Any Gmail search, used as typed, for example `label:jobs-frontend OR to:` followed by a `you+frontend` plus address at gmail.com (the same placeholder the input already shows). Sync reads only the mail it finds. Try it in Gmail's search box first.

### Applications (`AddApplicationForm`, `ApplicationDetailPage`)

- **Company**: The employer's name. Sync uses it to match replies to this application.
- **Role**: The job title you applied for. Sync uses it to tell two applications at the same company apart.
- **URL**: Link to the job posting. When you add an application, the app takes the sender domain from it (for example `example.com`) so sync can look for mail from that domain. Job-board links such as Greenhouse or Lever give no domain.
- **Status** (Add application only): Where this application stands now. Pick Saved for a job you have not applied to yet. Sync checks only open applications: Applied, Screening, Interview, No response, and Offers from the last 30 days.
- **Applied date**: The day you sent the application. Leave empty to use today. Sync ignores mail older than this date.
- **Notes**: Your own notes, such as a contact name or the next step. They are never sent to your agent.
- **Sender domains** (detail only): Email domains this company writes from, for example `example.com`. Without a Gmail label or search on the profile, sync looks for mail from these domains and from job-board senders. Add one when replies come from a domain the app did not guess.

### Jobs and runs

- **Find jobs** (beside the split button): Starts a discovery run: your agent searches the web for jobs that fit this profile, then the app checks every link. Default runs one agent. Max effort runs five, one per source, uses several times the tokens, and asks before it starts.
- **Show dead links**: Jobs whose posting is gone or closed are hidden. Tick to show them.
- **Show dismissed**: Jobs you dismissed are hidden. Tick to show them again.
- **Show raw output**: Everything the agent printed, exactly as saved, instead of the plain-words log. It can include mail snippets; do not share it.

### Setup and Settings (`AdapterChooser`, `AgentModelFields`, `SettingsPage`)

- **Agent adapter**: The agent CLI that runs every job search, Gmail sync and CV analysis. Claude Code and Codex are set up for you; Custom command runs a command you write. The app checks that it is installed and, for Claude Code and Codex, signed in.
- **Custom command**: The command and arguments the app runs for each task, without a shell. `{prompt_file}` is replaced with the path of the task's prompt, `{schema_file}` with its JSON schema. The command must print one JSON object that matches the schema.
- **Model and effort** (legend): Which model the agent uses and how hard it works, set separately for job searches and Gmail sync. Agent default passes nothing, so your own Claude Code or Codex configuration decides.
- **Model**: Pick a suggestion or type a model id. Empty uses the agent's default.
- **Effort**: How much the agent thinks before answering. Higher levels are slower, use more tokens and can hit the run timeout.
- **Permission mode**: Claude Code only. Passed to Claude Code as `--permission-mode`. With `default`, a run can use only the allowed tools below.
- **Allowed tools**: Claude Code only. The tools a run may use, comma-separated. Job searches need web search and fetch; Gmail sync needs the Gmail tools. Each tool you add gives the agent more access.
- **Sandbox**: Codex only. The Codex sandbox for this kind of run. `read-only` lets Codex read files but not change them.
- **Run timeout (ms)**: How long one run may take, in milliseconds (1200000 = 20 minutes). A run that goes over is stopped and saves nothing. Each Max-effort search gets this much on its own.
- **Sync interval**: How often the app syncs Gmail by itself, once for each profile with open applications. It runs only while the app is running. Off: sync only when you click Sync.
- **Claude spend cap**: Applies to Claude Code job searches only. The estimate is Claude Code's own, at list price, so it is not what your plan bills.
- **Port**: The port the app listens on, on this computer only (`127.0.0.1`). If it is taken, the next free port is used. `--port` on the command line overrides it.

### Readable option labels (decision 5)

- Status: `STATUS_LABELS` from `src/ui/labels.ts` (Saved, Applied, Screening, Interview, Offer, Rejected, No response, Withdrawn).
- Sync interval: Off, Every hour, Every 6 hours, Every 24 hours.
- Agent adapter: Claude Code, Codex, Custom command.

### Screen intros (decision 4)

- **Dashboard** (new): How this profile's applications are doing. Click a number to see the applications behind it.
- **Application detail** (new): The details sync uses to find replies, and every status change so far.
- **Run** (new): One job search or Gmail sync: its progress, what the agent did, and the result.
- **Fill in by hand** (new): Describe the jobs you want. Only Name is required; the more you fill in, the better discovery can judge a fit.
- **Settings → Runs** (new): Time limits, scheduled Gmail sync and the Claude spend cap.
- **Settings → Server** (new): Where the app listens on this computer.
- **Runs** (reworded): Every job search and Gmail sync, newest first. Open one to see what the agent did.
- **Settings** (reworded): Agent and app settings, shared by all profiles. Each section saves on its own.
- All other existing intros stay as they are.

## Plan

1. `InfoTip` component (`src/ui/components/InfoTip.tsx`, Popover-based ⓘ button, accessible name "About <field>") and `src/ui/help-text.ts`; unit test.
2. Wire help into the profile form family (ProfileForm, SeniorityInput, MailScopeInput, TagInput label slot, CvReviewSheet headings).
3. Wire help into applications (AddApplicationForm, ApplicationDetailPage), StatusSelect readable labels.
4. Wire help into Jobs/Run checkboxes and Find jobs.
5. Wire help into Setup/Settings (AdapterChooser readable names, AgentModelFields, SettingsPage, sync interval labels).
6. Screen intros (PageHeader descriptions, Settings section descriptions, CreateProfileFlow manual step).
7. Help & about menu in `Layout` sidebar footer (version from `getHealth`, inline GitHub mark).
8. Tests: update label-based queries if needed; add tests for InfoTip, readable labels, new intros, the menu links, and that every help key is used.
9. README: Tour with screenshots (`docs/images/`, captured from `npm run sandbox:mock` with Playwright via `npx`), "Moving to another device" section, mention of ⓘ help and the Help & about menu.
10. Spec `product-v1.md` update; validation; independent review; close SOW.

## Execution Log

### 2026-11-09

- SOW created; decisions 1-8 recorded.
- Decisions 9-11 recorded; help-text draft and plan written from `prompts/discover_jobs.md`, `prompts/sync_mail.md`, `src/server/services/discovery.ts:95-105`, `src/server/mail/agent-source.ts`, `src/server/api/applications.ts:62-70`, `src/server/agents/presets.ts`, `src/server/agents/cli-adapter.ts`, `src/server/index.ts:200`.
- User approved the help text; SOW moved to current, in-progress.
- Claims checked against vendor docs: Claude Code `-p` with `default` permission mode denies calls that need approval unless allowed (code.claude.com permission-modes); Codex `read-only` sandbox permits reading files, no writes (`openai/codex` docs). Permission mode wording tightened accordingly.
- Wording corrections from code: empty Applied date means today only for status Applied (`src/server/db/applications-repo.ts:101-104`); the profile form also requires a target role (`src/ui/components/ProfileForm.tsx:100`), so the Fill in by hand intro names both.
- Implemented `InfoTip`/`WithInfo` (`src/ui/components/InfoTip.tsx`), `src/ui/help-text.ts`, `HelpMenu` (`src/ui/components/HelpMenu.tsx`, version from `getHealth`), `ADAPTER_LABELS` and `SYNC_INTERVAL_LABELS` in `src/ui/labels.ts`; wired ProfileForm, TagInput (optional `help`), SeniorityInput, MailScopeInput, CvReviewSheet, AddApplicationForm, ApplicationDetailPage, StatusSelect, FindJobsButton, JobsPage, RunPage, RunsPage, DashboardPage, CreateProfileFlow, AdapterChooser, AgentModelFields, SettingsPage, Layout.
- `MaxSearchDialog`'s `AGENT_NAMES` was not reused: its custom entry is sentence text ("your custom agent").
- Screenshots in `docs/images/`; README, spec, AGENTS.md and project-testing skill updated.

## Validation

Acceptance criteria evidence:

- ⓘ help on every in-scope field: `test/ui/ProfilePage.test.tsx` (10 profile fields, group names unchanged), `test/ui/ApplicationsPage.test.tsx` (6 Add application fields), `test/ui/SettingsPage.test.tsx` (11 settings topics), `test/ui/JobsPage.test.tsx` (checkboxes), `test/ui/DashboardPage.test.tsx` (Find jobs), `test/ui/RunPage.test.tsx` (Show raw output); `test/ui/InfoTip.test.tsx` covers click, keyboard, Escape, code spans, no form submit, label name unchanged, and fails on an unused help key (proved by planting an unused key: the test reported `probeUnused`).
- Screen intros: Dashboard, Run, Application detail, Fill in by hand, Settings Runs and Server asserted in tests.
- Readable labels: Status options and Sync interval options (text and stored value) and `^Claude Code`/`^Codex` radio names asserted.
- Help & about: `test/ui/Layout.test.tsx` asserts version, the four links with `target="_blank"` and `rel="noopener noreferrer"`, and the menu without a version when `getHealth` fails.
- README: Tour with 8 screenshots, "Moving to another device", help and Help & about notes in Interface.

Tests or equivalent validation:

- Baseline before changes: `Tests 1059 passed (1059)`, typecheck clean.
- After review fixes: `Test Files 76 passed (76)`, `Tests 1076 passed (1076)`; `npm run typecheck` clean; `npm run build` `✓ built` (before the review fixes).

Real-use evidence:

- `npm run build`, `scripts/sandbox-mock/prepare.ts`, then `node bin/jobtrack.js --data-dir .tmp/sandbox-mock --no-open --port 0`; screens captured with Playwright (playwright-core 1.58 in `.tmp/shots`, cached Chromium) and inspected: popovers open above the label, adapter names and "Off" readable, intros visible. Server stopped by its saved PID.

Reviewer findings:

- Independent reviewer (fresh agent, read-only, given the diff and AGENTS.md, not this SOW's conclusions): no blockers.
  - Fixed: "Show dead links" overclaimed (dead = 404/410, unknown host or Greenhouse soft 404, checked once after the search; `src/server/verify/links.ts:41,70,76`); Custom command misdescribed `{schema_file}` (a path) and the output rule (last JSON object; `src/server/agents/cli-adapter.ts:42,219-221,346`); Run timeout said "saves nothing", false for Max effort (`src/server/services/discovery.ts:193-196`); Applied date now says sync *tells the agent* to skip older mail (prompt rule, not enforced by the app).
  - Fixed: missing tests for the ⓘ inside the CV review Sheet (Esc closes the help, the panel stays open), the Application detail page (new `test/ui/ApplicationDetailPage.test.tsx`) and Setup; Settings test name overclaimed; Layout "no version" test now waits for the failed read.
  - Fixed: stale SOW lines (gate implementation plan, Help Text Draft marked superseded).
  - Rejected: rewriting the help-key coverage test around exported tables. Evidence: the test already failed on a planted unused key, and every page test opens or finds its ⓘ buttons, so rendering is covered; exporting component internals only for a test adds surface.
  - Rejected: moving popovers to `side="right"` or `bottom`. The popover covers the field above the one being explained, not the one the user is about to fill, and Radix flips it on collision.
  - Mapped under Follow-up mapping: raw ids in Review, Run and Runs display text.

Same-failure scan:

- Raw adapter id also appeared in the Model and effort description ("your claude configuration"); fixed with `ADAPTER_LABELS`.
- Raw values left outside decision 5 scope (display text, not form controls): Review proposals show `applied → screening`; Run page and Runs list show `sync_mail`/`discover_jobs` and `claude`. Reported to the user as an opportunity.

Sensitive data gate:

- First `settings.png` showed the mock custom command with absolute workstation paths (a username); it was re-captured cropped to Settings → Runs and Server, and every image was inspected: only invented companies and `example.com` addresses. The hazard is recorded in `AGENTS.md`. Durable text contains no personal data.

Artifact maintenance gate:

- AGENTS.md: screenshot procedure and the Settings Agent/Data privacy hazard added under project-specific commands.
- Runtime project skills: `.agents/skills/project-testing/SKILL.md` gains the field-help testing note (button counts, popover dialogs, readable options, `getHealth` mock).
- Specs: `.agents/sow/specs/product-v1.md` User interface: in-app help, screen intros, readable labels, Help & about, sidebar contents.
- End-user/operator docs: `README.md` (Tour, Moving to another device, Interface notes, First run hint).
- End-user/operator skills: none exist in this repository (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: `Status: completed`, moved to `.agents/sow/done/` in the same commit as the work; follow-up SOW-0039 created in `pending/`.

Specs update:

- See artifact gate.

Project skills update:

- See artifact gate.

End-user/operator docs update:

- See artifact gate.

End-user/operator skills update:

- None exist.

Lessons:

- Help text must be checked against code paths, not the README: three draft lines were wrong or imprecise (empty Applied date, required profile fields, Claude permission mode).
- Screenshots of the mock sandbox can still leak workstation data through settings that hold paths.

Follow-up mapping:

- Raw ids in Review (`applied → screening`), Run and Runs (`sync_mail`, `claude`) display text: tracked in `.agents/sow/pending/SOW-0039-20261109-readable-run-and-proposal-labels.md` (decision 12).
- Committed screenshot script: rejected (decision 13); the procedure and its privacy hazard are recorded in `AGENTS.md`.

## Outcome

Delivered: ⓘ help popovers on every in-scope field (text in `src/ui/help-text.ts`), one-line intros on every screen, readable labels for Status, Sync interval and agent choices, a Help & about sidebar menu (version, Documentation, GitHub repository, Star on GitHub, Report an issue), and a README with a Tour of 8 screenshots and a Moving to another device section. `Tests 1076 passed (1076)`, typecheck clean.

## Lessons Extracted

- Help text is a contract: verify each line against the code path it describes, not against the README (three draft lines and four reviewed lines were wrong or imprecise).
- Mock-sandbox screenshots can still leak workstation data through settings that hold paths; recorded in `AGENTS.md`.

## Followup

- SOW-0039 (pending): readable run kind, run status, agent and proposal status labels on Review, Run and Runs.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
