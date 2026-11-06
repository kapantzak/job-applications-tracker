# SOW-0007 - Agent-compatible JSON output schema for Claude Code and Codex

## Status

Status: completed

Sub-state: fix shipped, both presets accept both task schemas; full discovery run is the next real-use check.

## Requirements

### Purpose

The first real discovery run with the Claude Code preset failed before the agent did anything. Make the output schema the app hands to agent CLIs acceptable to both the Claude Code and Codex presets.

### User Request

User started a job search from the UI and got: `Error: --json-schema is not a valid JSON Schema: no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`, then `Agent run failed: Exited with code 1`. User chose option B (strict schema for every adapter).

### Assistant Understanding

Facts:

- `outputJsonSchema` (`src/server/tasks/schemas.ts:49-52`) calls `z.toJSONSchema(schema, { io: 'input' })`. Zod 4.6.7 emits `"$schema": "https://json-schema.org/draft/2020-12/schema"` and `default` keywords, no `additionalProperties`, and only non-defaulted fields in `required`.
- Claude Code 2.1.319 validates `--json-schema` with a validator that has no 2020-12 meta-schema and exits 1 when the `$schema` key names it. Verified on the build machine with the exact `schema.json` from the failed run: exit 1; same file with `$schema` removed: exit 0, `structured_output` returned.
- Codex 0.163.0 forwards `--output-schema` to the OpenAI responses API in strict mode. Both the original and the `$schema`-less file return HTTP 400 `invalid_json_schema`: `'additionalProperties' is required to be supplied and to be false`.
- A strict rendering (no `$schema`, no `default`, `additionalProperties: false` on every object, every property in `required`, zod `io: 'output'`) of both task schemas was accepted by both CLIs for both tasks; `minLength`, `minimum` and `maximum` were accepted.
- The adapter tests use `test/fixtures/fake-agent.mjs`, which never validates the schema. SOW-0001 and the adapter skill both record that no real preset smoke run existed.

Inferences:

- A custom command that forwards the schema to an OpenAI-style API benefits from the strict shape too; one that ignores the schema is unaffected.
- Requiring every field means the agent must emit empty strings and nulls explicitly. The prompt templates already describe every field; the zod parse on our side keeps its defaults so missing fields in prose fallbacks still parse.

Unknowns:

- Whether a full discovery run (web search, many jobs) completes with Claude Code. Out of scope here; it is the next real-use check.

### Acceptance Criteria

- `outputJsonSchema('discover_jobs')` and `outputJsonSchema('sync_mail')` contain no `$schema` and no `default` keys at any depth, set `additionalProperties: false` on every object, and list every property in `required`. Verified by `test/server/tasks/schemas.test.ts`.
- Claude Code and Codex accept the generated schemas for both tasks with a trivial prompt. Verified manually on the build machine (recorded in Validation).
- `npm test` and `npm run typecheck` pass with no warnings.

## Analysis

Sources checked:

- `src/server/tasks/schemas.ts`, `src/server/agents/presets.ts`, `src/server/agents/cli-adapter.ts`, `test/server/tasks/schemas.test.ts`, `test/server/agents/cli-adapter.test.ts`.
- `.agents/skills/project-agent-adapter/SKILL.md`, `.agents/skills/project-testing/SKILL.md`, `.agents/sow/specs/product-v1.md` line 19, design spec line 196.
- `node_modules/zod/v4/core/to-json-schema.d.ts` (`target`, `io` options).
- Run directory of the failed run (prompt.md, schema.json). Only the schema file was inspected; no log content is copied here.
- Real CLIs: `claude --version` 2.1.319, `codex --version` 0.163.0, `claude --help` (`--json-schema`).

Current state:

- Discovery and sync both fail at agent start on the Claude Code preset, and would fail on the Codex preset with a 400 from the API.

Risks:

- Agents may omit a field they consider irrelevant; the CLI then rejects the output or retries. Mitigated by the prompt listing every field and by the tolerant zod parse on the app side.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Zod's JSON Schema export targets draft 2020-12 and emits a `$schema` pointer to it. Claude Code's validator does not know that meta-schema and refuses the flag. Codex's backend additionally requires strict-mode shape. Evidence: reproduction with the real CLIs listed under Facts.

Evidence reviewed:

- Listed under Analysis. No mirrored open-source repositories were consulted; the behaviour was established empirically against the installed CLIs.

Affected contracts and surfaces:

- `src/server/tasks/schemas.ts` (`outputJsonSchema`), the `schema.json` written per run, the `{schema}`/`{schema_file}` argv values for all three adapters, `test/server/tasks/schemas.test.ts`, `.agents/skills/project-agent-adapter/SKILL.md`, `.agents/sow/specs/product-v1.md`.

Existing patterns to reuse:

- Schema generation stays in the task layer (`schemas.ts`), per the adapter skill rule "validate agent output with the zod schema in the task layer, never in the adapter". Tests follow `test/server/tasks/schemas.test.ts`.

Risk and blast radius:

- Only the generated schema changes. Zod parsing, prompts, adapters, DB and UI are untouched. No migration, no security impact. Agents must emit all fields; see Risks.

Sensitive data handling plan:

- No secrets involved. The failed run's log is not copied; only the error line the user pasted (contains no personal data) and the schema shape are recorded.

Implementation plan:

1. RED: extend `test/server/tasks/schemas.test.ts` with a recursive assertion on both schemas (no `$schema`/`default`, `additionalProperties: false`, all properties required).
2. GREEN: change `outputJsonSchema` to render with `io: 'output'` and post-process into the strict shape.
3. Update the adapter skill (preset smoke-run status, CLI versions, strict-schema rule) and the spec line about the output schema.
4. `npm test`, `npm run typecheck`, `npm run build`; manual probe of both CLIs with the regenerated schemas.

Validation plan:

- Unit test above; full suite; typecheck; build; real CLI probes with trivial prompts; same-failure search for other `toJSONSchema` callers and for `$schema` in `src/`.

Artifact impact plan:

- AGENTS.md: unaffected; no workflow or command changes.
- Runtime project skills: `project-agent-adapter` updated (strict schema rule, smoke-run record, CLI versions).
- Specs: `product-v1.md` line 19 extended with the schema shape contract.
- End-user/operator docs: README unaffected; the user-visible behaviour is "it works".
- End-user/operator skills: none exist.
- SOW lifecycle: complete and move to `done/` in the same commit as the fix.

Open-source reference evidence:

- None consulted; behaviour verified empirically against the installed CLIs.

Open decisions:

- Decision 1 resolved: option B.

## Implications And Decisions

1. Schema shape handed to agents.
   - A. Strip only `$schema`: fixes Claude Code, leaves Codex failing with HTTP 400.
   - B. Strict shape for every adapter: fixes both verified presets; agents must emit every field. Long-term-best and minimal-complete.
   - C. Per-adapter rendering: more code and two shapes to test, no benefit since Claude Code accepts the strict shape.
   - Selected: B (user, 2026-11-06).

## Plan

1. Failing test in `test/server/tasks/schemas.test.ts`.
2. Implement in `src/server/tasks/schemas.ts`.
3. Skill and spec updates.
4. Validation and close.

## Execution Log

### 2026-11-06

- Reproduced with real CLIs; recorded decision B.
- RED: appended `agent-compatible json schema` tests to `test/server/tasks/schemas.test.ts` (3 failed against the old generator).
- GREEN: `src/server/tasks/schemas.ts` renders with `io: 'output'` and post-processes via `toAgentSchema` (drop `$schema`/`default`, `additionalProperties: false`, all properties required).
- Updated `.agents/skills/project-agent-adapter/SKILL.md` and `.agents/sow/specs/product-v1.md`.
- Deviation from plan: none.

## Validation

Acceptance criteria evidence:

- Strict shape: `test/server/tasks/schemas.test.ts` recursive assertion over both schemas passes (8/8 in that file).
- Real CLIs: schemas emitted by the new `outputJsonSchema` were passed to `claude -p --json-schema` (2.1.319) and `codex exec --output-schema` (0.163.0) with a trivial prompt for both tasks; all four runs exited 0 and returned the expected structured object (`{"jobs":[],"notes":""}` and `{"mail_access":true,"findings":[],"notes":""}`).

Tests or equivalent validation:

- `npm test`: Test Files 45 passed (45), Tests 313 passed (313), no warnings.
- `npm run typecheck`: clean.
- `npm run build`: ok.

Real-use evidence:

- The user's failing run reproduced exactly with its own `schema.json`; the same CLI accepted the regenerated schema. A full discovery run from the UI is the next step and is the user's to trigger (see Followup).

Reviewer findings:

- No separate reviewer pass; the change is a 20-line pure function with a pinning test and was verified against both real CLIs. Risk accepted by the user via option B.

Same-failure scan:

- `grep -rn 'toJSONSchema|\$schema' src/server`: only `schemas.ts`. `grep -rn 'shell: true|exec(' src/server`: only regex `.exec` and sqlite `db.exec`, no child-process shell use.
- Adapter stdin check: `cli-adapter.ts:245` uses `'ignore'` for argv-mode presets, so the codex "Reading additional input from stdin" wait seen in a manual probe cannot occur inside the app.

Sensitive data gate:

- SOW, skill and spec contain only the user-pasted error line, CLI versions, schema keywords and invented output objects. No run logs, mail content, credentials or personal data.

Artifact maintenance gate:

- AGENTS.md: no update; no workflow, command or guardrail changed.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` updated (strict-schema rule, probe practice, smoke-run status with CLI versions).
- Specs: `.agents/sow/specs/product-v1.md` line 19 updated with the schema shape contract.
- End-user/operator docs: README unaffected; no user-facing option or behaviour description changed.
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/` in the same commit as the fix.

Specs update:

- `product-v1.md` updated as above.

Project skills update:

- `project-agent-adapter` updated as above.

End-user/operator docs update:

- None affected; the fix restores documented behaviour.

End-user/operator skills update:

- None exist.

Lessons:

- A fake agent that accepts any schema cannot catch CLI-side schema validation. Preset changes need a real-CLI probe; recorded in the adapter skill.
- Probe CLIs with stdin redirected from `/dev/null`; codex otherwise waits for more input when stdin is not a TTY.

Follow-up mapping:

- Full discovery and sync runs with real agents: tracked as the open smoke-run item already listed in SOW-0005 and the adapter skill (not new work created here).
- `.tmp/probe/` helper scripts: git-ignored scratch; deletion left to the user.

## Outcome

Both the Claude Code and Codex presets now receive a schema they accept. The user's discovery run failed at agent start; with the regenerated schema the same CLI returns structured output.

## Lessons Extracted

See Validation > Lessons; both recorded in `project-agent-adapter`.

## Followup

- User to rerun discovery from the UI (rebuild done). First full real-agent run remains the open item tracked in SOW-0005.

## Regression Log

None yet.
