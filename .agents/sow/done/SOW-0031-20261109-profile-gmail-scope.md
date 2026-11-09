# SOW-0031 - Per-profile Gmail scope for mail sync

## Status

Status: completed

Sub-state: implemented, validated and reviewed; committed with the work.

## Requirements

### Purpose

Let the user tell the sync agent which mail belongs to which profile, so a sync for one profile does not read another profile's replies and so replies from senders outside the company domain are found.

### User Request

GitHub issue #24 ("Sync Gmail"): "When the user syncs Gmail, the agent should know which emails refer to which profile. Let users define a gmail tag, or folder per profile, so the agent can match emails to profiles." The user added: "allow users to define the way that they will indicate that this application refers to specific profile. Maybe with a Gmail tag, or dedicated folder, so AI agent can know what to search during sync."

### Assistant Understanding

Facts:

- Sync already runs per profile: `src/server/services/mail-sync.ts:20` loads only the run profile's open applications; `src/server/mail/agent-source.ts:9-15` renders `id | company | role | applied_at | sender_domains` per application.
- `prompts/sync_mail.md` v2 restricts the search to "messages from the listed companies and the ATS domains above". Nothing tells the agent which part of the mailbox belongs to the profile, so two profiles with applications at the same company (or the same ATS) see each other's replies.
- Gmail has no folders; labels are its folders. The claude.ai Gmail connector's `search_threads` takes Gmail search syntax (`label:`, `to:`, `deliveredto:`, `OR`, `-`).
- The app is read-only towards Gmail (the prompt forbids labelling), so the user creates labels and Gmail filters themselves.

Inferences:

- An empty scope must keep today's behaviour exactly, so existing users see no change until they opt in.

Unknowns:

- Codex and custom agents' Gmail tools may treat a query differently from the claude.ai connector; only the connector was probed.

### Acceptance Criteria

- A profile stores a mail scope: kind `label` (default) or `query`, and a value (empty = no scope). Verified by repo and API tests.
- The profile form offers "Gmail label" and "Custom Gmail search (advanced)", documents both in the UI, and saves only the selected one. Verified by UI tests.
- A sync of a profile with a label scope sends `label:<name with spaces and / replaced by ->`; a query scope is sent as typed; with no scope the prompt keeps the company/ATS rule. Verified by agent-source tests and the e2e path.
- Invalid values (over 300 characters, control characters, `"` in a label) are refused with 400 and flagged in the form.
- Sync prompt bumped to v3; docs and spec updated.

## Analysis

Sources checked:

- `src/server/services/mail-sync.ts`, `src/server/mail/agent-source.ts`, `src/server/mail/types.ts`, `prompts/sync_mail.md`, `src/server/tasks/prompts.ts`.
- `src/server/domain/types.ts` (`Profile`), `src/server/db/profiles-repo.ts`, `src/server/db/migrations.ts` (latest migration 7), `src/server/api/profiles.ts` (`profileFields`, strict body).
- `src/ui/components/ProfileForm.tsx`, `src/ui/api/client.ts` (`ProfileInput = Omit<Profile, …>`), `src/ui/cv-review.ts` (offers only roles, locations, remote, seniority, keywords).
- `scripts/sandbox-mock/seed.ts`, `scripts/sandbox-mock/mock-agent.mjs` (parses `- id: … | company: … | role: … |` lines only).
- `.agents/sow/specs/product-v1.md:28` ("The agent never sees the profile name; prompts are unchanged.") and the README "How Gmail sync works" section.
- `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md`: no overlapping item.

Current state:

- No per-profile mailbox scope exists; the prompt search rule is company and ATS senders only.

Risks:

- A scope that matches nothing yields "0 proposals" without an error.
- A strict scope hides replies the user's Gmail filter did not label.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The sync prompt identifies relevant mail only by company name and sender domain (`prompts/sync_mail.md` Rules; `agent-source.ts` `renderApplications`). Profiles share one mailbox, so mail cannot be attributed to a profile; ATS senders (Greenhouse, Lever, …) are shared by every profile. A user-defined Gmail scope per profile gives the agent the missing attribution.

Evidence reviewed:

- Code and docs listed under Analysis.
- Gmail connector `search_threads` tool description (query operators, label quoting guidance).
- Real-use probe on 2026-11-09 against the user's mailbox through the claude.ai Gmail connector, with permission, using `list_labels` and `search_threads` in the ids-only view (no message content read). Each count was compared with the label's `threadsTotal`. Label names are not recorded; the shapes are described with invented names:
  - nested `Parent/Child` as `label:Parent-Child`: all threads matched; quoted `label:"Parent/Child"`: all matched;
  - a name with a space (`Two Words`) as `label:Two-Words`: all matched;
  - a name with ` - ` (`A - B`) as `label:A---B`: all matched; quoted `label:"A - B"`: 0 matched;
  - a non-Latin name: all matched; the lowercased hyphen form: all matched (case-insensitive).

Affected contracts and surfaces:

- DB: migration 8 adds `profiles.mail_filter_kind` and `profiles.mail_filter`.
- API: `POST`/`PUT /api/profiles[/:pid]` accept optional `mail_filter_kind` and `mail_filter`; profile responses include them.
- Prompt: `prompts/sync_mail.md` v3 with a `{{mail_scope}}` section; `MailSyncRequest` gains the scope.
- UI: profile form (create, create from CV, edit).
- Sandbox seed; README; spec; project-agent-adapter skill (profile fields now reach the sync prompt).

Existing patterns to reuse:

- Shared validation module used by server and UI: `src/server/domain/profile-name.ts`.
- Additive `ALTER TABLE … ADD COLUMN … DEFAULT` migrations (migrations 5–7).
- Radio cards with `RadioGroup` in `src/ui/components/AdapterChooser.tsx`; `Field`/`FieldDescription`/`FieldError` in `ProfileForm.tsx`.
- zod error mapping `path: message` (`src/server/api/errors.ts`).

Risk and blast radius:

- Migration is additive with defaults; existing rows get kind `label`, empty value = old behaviour.
- PUT stays backward compatible: omitted scope fields keep the stored values, so the CV review Save and older bodies do not wipe the scope.
- The value reaches the prompt only, never argv; one-line validation prevents breaking prompt structure.
- Prompt wording change: version bump 2 → 3; the mock agent's line regex is unaffected because application lines keep their format.

Sensitive data handling plan:

- Fixtures, docs and SOW use invented labels and addresses (`Jobs/Frontend`, `you+frontend@example.com`). The probe evidence above records only counts and invented shapes, no label names, thread ids or message content.

Implementation plan:

1. Domain module `src/server/domain/mail-filter.ts`: kinds, limit, validation messages, `mailScopeQuery(kind, value)`; tests.
2. Types, migration 8, profiles repo; tests.
3. API schema (optional fields, keep stored values on PUT); tests.
4. Mail sync request + agent source + prompt v3; tests (agent-source, mail-sync, prompts).
5. UI: client types, `ProfileForm` Gmail sync section; tests.
6. Sandbox seed scope on the rich profile; README, spec, skill.

Validation plan:

- `npx vitest run` per file while working; `npm run typecheck`; `npm test`; e2e unchanged and passing.
- Manual: `npm run sandbox:mock`, set a label on a profile, run Sync, check the stored prompt under the run directory shows the scope.
- Independent reviewer pass on the diff.

Artifact impact plan:

- AGENTS.md: no workflow change expected; the sandbox note already covers seed/prompt drift.
- Runtime project skills: `project-agent-adapter` says the profile name never reaches a prompt and adding profile fields does not change prompts; update to name the mail scope as the exception.
- Specs: `product-v1.md` Profiles and sync sections; line 28 wording.
- End-user/operator docs: README "How Gmail sync works".
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: this SOW moves to `done/` with the work in one commit.

Open-source reference evidence:

- None checked; the change is app-local and the Gmail syntax evidence comes from the connector's own tool description and a live probe.

Open decisions:

- All resolved; see Implications And Decisions.

## Implications And Decisions

Decided by the user on 2026-11-09:

1. What the user enters: a Gmail label name by default, and for advanced cases a free-form Gmail search query, both documented in the UI.
2. How the agent uses it (2A): when a scope is set, the agent searches only messages matching it (and newer than `applied_at`) and matches each message to an application by company, role or sender; the company/ATS sender rule applies only when the scope is empty.
3. No exclusion of other profiles' scopes (3A).
4. Validation and placement (4A): optional, trimmed, one line, at most 300 characters, no control characters; a new "Gmail sync" section in the profile form; untouched by CV review; no Dashboard display.
5. One mode at a time (5A): the form offers "Gmail label" (default) or "Custom Gmail search (advanced)"; only the selected one is stored and used.
6. Label to query (6A): the app builds `label:` plus the name with every space and `/` replaced by `-`; a label containing `"` is refused. Verified against the user's mailbox (see Evidence reviewed).

## Plan

See Implementation plan.

## Execution Log

### 2026-11-09

- Issue read, code investigated, decisions 1–6 taken, Gmail probe run with permission.
- Added `src/server/domain/mail-filter.ts` (rule and `mailScopeQuery`), migration 8, `Profile` fields, repo columns, API fields, `MailSyncRequest.mail_scope`, the handler's profile lookup, `renderScope` in `agent-source.ts`, prompt `sync_mail` v3, `src/ui/components/MailScopeInput.tsx` and its place in `ProfileForm.tsx`, sandbox seed scopes (label on the rich profile, query on the sparse one, none on the empty one).
- No deviation from decisions 1–6. Implementation detail chosen within them: the API validates the stored pair (body values over stored ones), so a body may send only the kind or only the value.
- The worktree had no `node_modules`; ran `npm ci` from the lockfile.
- Independent reviewer pass (general-purpose subagent, read-only); findings handled below.

## Validation

Acceptance criteria evidence:

- Stored scope, default and update: `test/server/db/profiles-repo.test.ts` ("stores and updates the Gmail scope"), `test/server/db/migrations.test.ts` ("migration 8 …").
- API: `test/server/api/profiles.test.ts` "profiles: Gmail scope" (default on create, trimmed label and query, PUT without scope keeps it, partial bodies checked against the stored pair, 400 for quotes in a label, line breaks, over 300 characters, unknown kind, nothing written on refusal). CV Save keeps the scope: `fieldsOf` in `test/server/api/profile-cv-analysis.test.ts` now compares it.
- Prompt: `test/server/mail/agent-source.test.ts` (no scope keeps the company/ATS rule; a scope is on its own line), `test/server/tasks/prompts.test.ts` (v3, section and rule), `test/server/services/mail-sync.test.ts` (label, query and empty scopes of the run's profile reach the source as `label:Jobs-Frontend`, the query, and null).
- UI: `test/ui/ProfilePage.test.tsx` "ProfilePage Gmail sync" (default mode, help text, trimmed save shown trimmed, switching keeps each mode's text and saves only the selected one, stored query shown in advanced mode, quote error blocks Save) and "Apply keeps the Gmail scope and the other mode text, and Save sends the scope".

Tests or equivalent validation:

- `npm run typecheck`: clean (server and UI).
- `npm test`: `Test Files  69 passed (69)`, `Tests  958 passed (958)`; no warnings in the filtered output.

Real-use evidence:

- `npm run sandbox:mock -- --no-open --port 0`, then `POST /api/profiles/<rich profile>/runs/sync`: the run succeeded with prompt version 3 and "2 proposals created, 0 skipped"; the stored `runs/<id>/prompt.md` has the "Mailbox scope" section with `label:Jobs-Frontend` on its own line.
- Browser check of the Profile page in the sandbox: the Gmail sync fieldset, both radio cards, the "Label name" input with the stored label and its help text render as specified. The "Gmail search operators" link was unstyled; it now uses the same classes as the Gmail setup guide link in `AdapterChooser.tsx`.
- Gmail label search forms probed against the user's mailbox (see Evidence reviewed); a full sync with a real agent and a real scope was not run.

Reviewer findings:

1. Medium: the API validated the raw body with a default kind, so a partial body was checked against the wrong kind, and a kind-only body could store a query as a label without any check. Fixed: `withMailScope` validates the stored pair; test "checks a partial body against the stored scope it is combined with".
2. Low: the input kept showing untrimmed text after Save. Fixed by making `MailScopeInput` controlled (it shows `value` and keeps only the other mode's text); test asserts the trimmed value after Save.
3. Low: CV review Apply remounted the input and lost the other mode's text. Fixed by removing the `key={applied}` remount; test covers Apply then Save.
4. Low: no test for CV Apply then Save with a scope. Added (see 3).
5. Low: README said "each space" while the code replaces every whitespace character. README reworded.
6. Residual (unverified): label names with `(`, `)`, `{`, `}` are not probed against Gmail. 7. Residual: invisible format characters (`\p{Cf}`) pass the one-line check. Neither breaks prompt structure. Both need a user decision and are tracked in `SOW-0005` (Server section).

Same-failure scan:

- `grep -rn "INSERT INTO profiles\|UPDATE profiles SET" src scripts`: only `profiles-repo.ts` writes profile fields (migrations aside); both statements bind the new columns.
- `grep -rn "shell: true\|exec(" src/server`: no child-process `exec` or shell spawning (only `RegExp.exec` and `db.exec`).
- Every `ProfileInput`/`Profile` literal was found by `npm run typecheck` and updated (server tests, UI tests, seed).

Sensitive data gate:

- The Gmail probe evidence records counts and invented shapes only. A case-insensitive grep of the diff and the new files for the probed label names returned 0. Fixtures and docs use `Jobs/Frontend`, `example.com` addresses and `you+frontend@gmail.com` as a generic pattern.

Artifact maintenance gate:

- AGENTS.md: no change needed. The sandbox note already says to update the seed or mock agent when a repository write or prompt changes, which this SOW did (`seed.ts`); no workflow, command or guardrail changed.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` now names the Gmail scope as the one profile field that reaches a prompt, the one-line rule, and that only the claude.ai connector was probed. `project-local-api` and `project-testing` are unaffected: no new route, guard or status mapping; no new harness or test environment.
- Specs: `.agents/sow/specs/product-v1.md` (Profiles field list, the "agent never sees the profile name" line, new "Gmail scope per profile (SOW-0031)" section).
- End-user/operator docs: `README.md` (profiles note and "How Gmail sync works").
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: `Status: completed`, moved to `.agents/sow/done/`, committed with the work in one commit; residual items tracked in SOW-0005.

Specs update:

- See the artifact maintenance gate.

Project skills update:

- `project-agent-adapter` updated; see above.

End-user/operator docs update:

- `README.md` updated; see above.

End-user/operator skills update:

- None exist in this repository.

Lessons:

- Optional fields that fill from stored values must be validated after the merge, not in the body schema; the reviewer caught a kind-only body that skipped validation.
- A worktree may have no `node_modules`; `npm ci` first.

Follow-up mapping:

- Reviewer items 1–5: implemented.
- Reviewer items 6–7: tracked in `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md`.
- Codex and custom agents' Gmail query handling: not probed. Recorded as a known limit in the `project-agent-adapter` skill. The skill's existing rule already forbids claiming a full real sync without one, so there is no separate SOW.

## Outcome

Profiles carry an optional Gmail scope (a label by default, or a custom Gmail search), and mail sync searches only inside it; without one, sync behaves as before.

## Lessons Extracted

See Validation → Lessons; recorded in the `project-agent-adapter` skill where they affect future prompt work.

## Followup

Tracked in SOW-0005 (label characters not probed against Gmail; invisible format characters).

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
