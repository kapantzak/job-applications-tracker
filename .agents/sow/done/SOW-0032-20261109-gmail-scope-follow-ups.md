# SOW-0032 - Gmail scope follow-ups

## Status

Status: completed

Sub-state: implemented, validated and reviewed; committed on `sync-gmail` (PR #26).

## Requirements

### Purpose

Close the gaps SOW-0031 left in the per-profile Gmail scope: wrong-mode input, silent misses when a scope matches nothing, the scope being invisible where sync starts, and label characters Gmail was not probed with.

### User Request

"Also do the follow-ups" (2026-11-09), then "all recommended" for decisions 1–5 below.

### Assistant Understanding

Facts:

- SOW-0031 shipped the scope (`src/server/domain/mail-filter.ts`, `prompts/sync_mail.md` v3, `src/ui/components/MailScopeInput.tsx`) on branch `sync-gmail`, PR #26.
- `SyncMailOutput.notes` is parsed but unused (`src/server/tasks/schemas.ts:49`, `src/server/services/mail-sync.ts`); the run summary is "N proposals created, M skipped".
- "Sync from Gmail" is on the Dashboard (`DashboardPage.tsx:131`) and the Applications page (`ApplicationsPage.tsx:133`), both inside `PageHeader` actions.
- The run summary is shown on the Run page (`RunPage.tsx:186`) and the Runs list (`RunsPage.tsx:181`).
- Claude Code 2.1.319 and codex-cli 0.163.0 are installed for the schema probe the agent-adapter skill requires.

Inferences:

- A scope count only diagnoses a wrong scope when measured without date limits; with them, 0 may just mean no new mail.

Unknowns:

- Whether agents count reliably; the app treats only an explicit 0 as "matched nothing".

### Acceptance Criteria

- Label mode refuses a value starting with `label:` and values with `(`, `)`, `{`, `}` or invisible format characters, server and UI alike.
- Sync output carries `scope_message_count` (integer ≥ 0 or null); a scoped run whose count is 0 ends its summary with "; the Gmail scope matched no mail" and logs it. Real Claude and Codex accept the new strict schema.
- Dashboard and Applications show what sync searches, with a Change link to the Profile page.

## Analysis

Sources checked:

- Files named under Facts; `test/fixtures/fake-agent.mjs`, `scripts/sandbox-mock/mock-agent.mjs`, `test/e2e/discovery-flow.test.ts`, `src/ui/profile-route.ts` (`useCurrentProfile`), `src/ui/components/PageHeader.tsx`.

Current state:

- See Facts.

Risks:

- A schema change can be rejected by one CLI's validator (SOW-0007 history); mitigated by the real probe.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- SOW-0031 review and close-out listed four gaps: label mode accepts search syntax; a scope that matches nothing is indistinguishable from "no news"; the scope is only visible on the Profile page; `( ) { }` and `\p{Cf}` in labels are unprobed or invisible.

Evidence reviewed:

- SOW-0031 Validation (reviewer items 6–7, opportunities), SOW-0005 Server item from SOW-0031, the code listed above, `.agents/skills/project-agent-adapter/SKILL.md` (strict schema shape, probe rule).

Affected contracts and surfaces:

- `mailFilterError` rule (API 400 messages, form errors); `SyncMailOutput` and its strict JSON schema; `prompts/sync_mail.md` v4; run summary text; Dashboard and Applications headers; mock agent output; README, spec, agent-adapter skill; SOW-0005 item.

Existing patterns to reuse:

- `workersFailedNote` / `hasFailedWorkers` in `src/server/domain/types.ts` for a summary suffix constant; `outputJsonSchema` strict conversion; `useCurrentProfile`, `useProfileHref`.

Risk and blast radius:

- Existing stored labels that now fail the rule (a label with brackets or starting with `label:`) are not rewritten; the next Save shows the error and the user switches mode. Sync still sends them as before.
- Schema change: new required property in the strict schema; the app's own parse defaults it to null, so older custom agents keep working.

Sensitive data handling plan:

- Probes use a trivial prompt with no mailbox access; tests and docs use invented values.

Implementation plan:

1. Label rules in `mail-filter.ts` with tests (domain, API, UI).
2. Schema field, prompt v4, handler summary, constant; tests; mock agent; real CLI probe.
3. `SyncScopeNote` UI on Dashboard and Applications; tests.
4. README, spec, skill, SOW-0005 item marked done.

Validation plan:

- Per-file vitest, `npm run typecheck`, `npm test`; real `claude -p --json-schema` and `codex exec --output-schema` probes with the new schema; mock sandbox sync run; reviewer pass.

Artifact impact plan:

- AGENTS.md: unaffected (no workflow or command change).
- Runtime project skills: `project-agent-adapter` (prompt v4, new output field, probe record).
- Specs: `product-v1.md` Gmail scope section.
- End-user/operator docs: README "How Gmail sync works".
- End-user/operator skills: none exist.
- SOW lifecycle: SOW-0005 SOW-0031 item marked done here; this SOW moves to `done/` in its commit.

Open-source reference evidence:

- None; app-local change.

Open decisions:

- All resolved (below).

## Implications And Decisions

Decided by the user on 2026-11-09 ("all recommended"):

1. (1A) Label mode refuses a value starting with `label:`: "Type only the label name, without label:. For a full search, choose Custom Gmail search."
2. (2B) Structured `scope_message_count` (integer, or null when no scope); 0 adds "; the Gmail scope matched no mail" to the run summary.
3. (3A) Dashboard and Applications show what sync searches under the header actions, with a Change link to the Profile page.
4. (4A) Label mode refuses `(`, `)`, `{`, `}` and invisible format characters: "Use Custom Gmail search for labels with brackets or hidden characters."
5. (5A) This SOW is a second commit on `sync-gmail`, in PR #26.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-09

- Decisions recorded.
- Label rules in `mail-filter.ts`; `scope_message_count` in `SyncMailOutput`, `SCOPE_MATCHED_NOTHING_NOTE` in `domain/types.ts`, prompt v4 text in `prompts/sync_mail.md` and `renderScope`, summary and log line in `mail-sync.ts`; mock agent emits the count; `SyncScopeNote` on Dashboard and Applications; Run page log formatter knows both new lines.
- Real schema probe on Claude Code 2.1.319 and codex-cli 0.163.0 (see Validation).
- Independent reviewer pass (general-purpose subagent, read-only); findings handled below.
- No deviation from decisions 1–5. Detail chosen within them: the `label:` check runs before the quote check so a pasted search gets the mode hint.

## Validation

Acceptance criteria evidence:

- Label rules: `test/server/domain/mail-filter.test.ts` (`label:` in several cases and spacings, including `label:"Board Prep"`, colon elsewhere accepted, brackets and `\p{Cf}` refused in labels but not in queries); `test/server/api/profiles.test.ts` (400 messages; partial body now gets the `label:` hint); `test/ui/ProfilePage.test.tsx` ("points a search typed as a label to Custom Gmail search").
- Scope count: `test/server/tasks/schemas.test.ts` (required in the strict schema, null when missing, -1 and 1.5 refused); `test/server/tasks/prompts.test.ts` (v4, rule line); `test/server/mail/agent-source.test.ts` (scope and no-scope instructions); `test/server/services/mail-sync.test.ts` (0 with scope adds the note and the warning line; positive, null and unscoped add nothing); `test/server/sandbox-mock/mock-agent.test.ts` (count only with a scope); `test/ui/log-format.test.ts` (warning line and suffixed summary).
- Note: `test/ui/SyncScopeNote.test.tsx` (no scope, label, query, Change link), plus one assertion each in `DashboardPage.test.tsx` and `ApplicationsPage.test.tsx`.

Tests or equivalent validation:

- `npm run typecheck`: clean.
- `npm test`: `Test Files  70 passed (70)`, `Tests  986 passed (986)`.

Real-use evidence:

- Schema probe (2026-11-09) with `outputJsonSchema('sync_mail')` and a trivial no-tools prompt naming the values: `claude -p --output-format json --json-schema … --tools "" --strict-mcp-config` (2.1.319) exit 0, `structured_output.scope_message_count` 0; `codex exec --output-schema … --sandbox read-only` (0.163.0) exit 0, `scope_message_count` null.
- `npm run sandbox:mock`: syncs on the label profile and the query profile both succeeded with prompt v4, and the stored prompts carry the count instruction; `PUT` with `mail_filter: "label:jobs"` returned the decision-1 400; the Dashboard showed "Sync searches Gmail for … Change" under the header buttons in the browser.
- Not exercised: a real agent's count on a real scoped sync, and the 0-count path in the sandbox (the mock reports the number of open applications, never 0).

Reviewer findings:

1. Medium: the Run page log formatter did not know the suffixed summary or the warning line. Fixed in `src/ui/log-format.ts` (suffix allowed; warning tone) with a test.
2. Low: rule order gave a pasted `label:"…"` the quote message. Fixed by checking `label:` first, with tests.
3. Low: a stored value that breaks a newer rule blocks Save until the Gmail field is changed. Accepted, as the spec states; the form shows the error under the field.
4. Low: a long label could overflow in the note. Fixed with `break-all`.
5. Speculative: the Runs table cell truncates the longer summary. Rejected: it is the existing `max-w-96 truncate` cell with the full text in `title`, the same as the workers-failed suffix; the Run page shows it in full.
6. Opportunity: the mock agent never reports 0. Not required by the decisions; reported to the user as an opportunity.
7. The skill's probe claim was clarified: the probe proves schema acceptance, not counting behaviour; an agent that answers null leaves the warning silent.

Same-failure scan:

- `grep -rn "proposals created" src`: only `mail-sync.ts` writes it and `log-format.ts` matches it; both updated.
- `grep -rn "mail_access: true" scripts test/fixtures`: the mock agent emits the count; `test/fixtures/fake-agent.mjs` and the e2e test omit it and rely on the parse default (null), which is the compatibility path for older custom agents.

Sensitive data gate:

- Probe output was a fixed trivial answer; no mailbox access. Docs, tests and fixtures use invented labels and `example.com` addresses. `bash .agents/sow/audit.sh` is clean.

Artifact maintenance gate:

- AGENTS.md: no change; no workflow, command or guardrail changed.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` (prompt v4, `scope_message_count`, probe record and its limit). `project-testing` and `project-local-api` unaffected: no new harness or route.
- Specs: `.agents/sow/specs/product-v1.md` (label rules and order, v4 count and summary, note, log warning).
- End-user/operator docs: `README.md` "How Gmail sync works".
- End-user/operator skills: none exist.
- SOW lifecycle: SOW-0005 item from SOW-0031 marked done here; this SOW is `completed` and moved to `done/` in its commit.

Specs update:

- See the artifact maintenance gate.

Project skills update:

- See the artifact maintenance gate.

End-user/operator docs update:

- `README.md`.

End-user/operator skills update:

- None exist.

Lessons:

- A new app log line needs a matching rule in `src/ui/log-format.ts`; the skill already says so for CLI events, and the reviewer caught it for app lines. Added to the spec log description.

Follow-up mapping:

- Reviewer 1, 2, 4, 7: implemented. 3: accepted (documented). 5: rejected with reason above. 6: opportunity reported to the user, not deferred work.

## Outcome

Label mode now steers searches and unsafe characters to Custom Gmail search, a scoped sync whose scope matches nothing says so in its result and log, and the Dashboard and Applications show what sync searches.

## Lessons Extracted

See Validation → Lessons.

## Followup

None.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
