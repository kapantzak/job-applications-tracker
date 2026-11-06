---
name: project-agent-adapter
description: "Mandatory knowledge and workflow when changing how the app spawns or parses the user's agent CLI: src/server/agents/*, prompts/*.md, src/server/tasks/*, or any run handler that calls an adapter. Use before editing presets, placeholders, JSON extraction, prompt templates, or claiming an agent integration works."
---
# Agent adapter and prompts

## Purpose

The app never calls a model; it spawns the user's own CLI (Claude Code, Codex, or a custom command) and parses schema-validated JSON back. This skill keeps that boundary safe (no shell, no trust in output) and keeps the prompt contract and the parsing rules aligned.

## Scope

Use this skill when:

- editing `src/server/agents/cli-adapter.ts`, `presets.ts`, `extract-json.ts`, `index.ts`;
- editing `prompts/discover_jobs.md`, `prompts/sync_mail.md`, or `src/server/tasks/schemas.ts`;
- editing `src/server/services/discovery.ts`, `src/server/services/mail-sync.ts`, `src/server/mail/agent-source.ts`;
- claiming that a preset works on a developer machine.

Do not use this skill for:

- the run queue or SSE (see `src/server/runs/`), unless the change alters what the adapter receives;
- UI changes that only display run output.

## Mandatory Knowledge

- Child processes are spawned with `spawn(argv0, args, { shell: false })` and inherit `process.env` unchanged. Never build a command string. Evidence: `src/server/agents/cli-adapter.ts`, design spec section 8.
- On win32 `resolveCommand` (`src/server/agents/resolve-command.ts`) searches `PATH` x `PATHEXT` and turns an npm `.cmd`/`.bat` shim into `node <entry.js>` (from its `%dp0%` / `%~dp0` reference, quoted form first so spaces survive); a `.js`/`.mjs`/`.cjs` winner also runs under node; anything unresolvable is spawned unchanged so ENOENT still reports `Command not found: <argv0>`. POSIX is a passthrough. The win32 path is tested with simulated shims and injected `ResolveDeps` only, never on a real Windows machine. Evidence: `test/server/agents/resolve-command.test.ts`, SOW-0002.
- Placeholders: `{schema}` is replaced only as a whole argv element (inline JSON); `{schema_file}`, `{prompt_file}`, `{output_file}`, `{permission_mode}`, `{allowed_tools}`, `{sandbox}` may be substrings. Files are written under the run directory `runs/<run-id>/`. Evidence: `src/server/agents/cli-adapter.ts`, `test/server/agents/cli-adapter.test.ts`.
- `run()` and `check()` never reject; every failure resolves `ok: false` with a specific `error` (`Timed out after <ms> ms`, `Aborted`, `Exited with code <n>`, `Command not found: <argv0>`, `Failed to start: …`). Evidence: SOW-0001 Task 9 review.
- `extractLastJsonObject` takes the LAST balanced top-level object and never falls back to an earlier one; an echoed schema in prose must not become the result. Evidence: SOW-0001 Task 9 ruling.
- Every prompt template states the read-only rules (never apply, never send/draft/label mail) and ends with "Respond with a single JSON object matching the required schema and nothing else." `sync_mail.md` carries the `mail_access: false` instruction (design Decision 7). Templates have a `version:` front matter that is recorded on each run; bump it on any wording change.
- `check()` runs the version probe, then (only if it succeeded) the preset's `authArgv` (`claude auth status`, `codex login status`; custom has none) with the same 3 s timeout and resolver. Exit 0 = `authenticated: true`; non-zero = `false` plus `authMessage` (first non-empty output line, max 200 chars; never the full output, it may hold account details); spawn failure or timeout = `authenticated` undefined with `Sign-in check failed: <reason>`. Evidence: `test/server/agents/cli-adapter.test.ts`, SOW-0003.
- Preset flag spellings were verified against `claude --help` (2.1.x) and `codex exec --help` (0.163) on 2026-11-05. Re-verify on the build machine whenever a preset changes; CLIs drift.
- The Claude preset passes `--setting-sources user --disallowedTools Agent,Task`. Probed on 2.1.319 (SOW-0008): `--bare` skips keychain reads and the agent is "Not logged in"; `--setting-sources ""` drops every MCP server including the claude.ai Gmail connector that sync needs; `user` keeps credentials, hooks, plugins and connectors while skipping project `CLAUDE.md`/skills/`.mcp.json` implied by the run cwd. Denying `Agent`/`Task` is the only hard stop on subagent fan-out; the first real run spent 10 minutes in 14 subagents verifying postings and never answered.
- `prompts/discover_jobs.md` (v2) carries a Budget section: about 10 minutes, 10..30 jobs, prefer employer/ATS links, may open one page per job to confirm it, no subagents, the app verifies links. Keep that section when editing the prompt. Measured on 2026-11-06 (SOW-0008): no budget at all → 15 min with 14 subagents and 12 verified jobs; "do not open any posting" → under 2 min but 7 of 18 links dead and the rest aggregators. The default `run_timeout_ms` is 20 min for this reason. Evidence: `.superpowers` ledger and Task 9 report.
- Model and effort (SOW-0011): presets append `--model`/`--effort` (claude) or `-m`/`-c model_reasoning_effort="<e>"` (codex) only when the per-agent, per-kind setting is non-empty; `''` passes nothing and the CLI's own default applies. `selectionFor()` in `presets.ts` re-validates stored values with `MODEL_PATTERN`/`EFFORT_PATTERN` (no leading `-`, no quotes) because they reach argv. Probed 2026-11-07 on claude 2.1.319 and codex 0.163.0: `claude -p --model sonnet --effort low` ran and its init event reported `claude-sonnet-5-5`; codex plain mode printed `reasoning effort: low` for the `-c` override (the banner is absent under `--json`). Evidence: SOW-0011 Validation.
- `AgentResult.reportedModel` comes from the Claude stream-json `system/init` event (`extractClaudeInitModel`), on success and failure. Codex `--json` events carry neither model nor effort; no agent reports the effort. Do not parse CLI config files to guess defaults (user decision, SOW-0011).
- `listModels()` never rejects: a static `modelCatalog` (Claude aliases from `claude --help`) or `modelsArgv` (`codex debug models`, 5 s probe, parsed by `parseCodexModelCatalog`, hidden models skipped). `debug models` is a debug command with no stability promise; any failure returns `source: 'unavailable'`. Fake-agent: argv `debug models` prints `FAKE_AGENT_MODELS` (or fails with `fail`); mode `claude` puts `FAKE_AGENT_MODEL` in the init event, `claude-fail` emits only init and exits 2.
- Handlers call `ctx.recordAgent(requestedAgent(adapter))` before `adapter.run` and `reportedAgent(result)` after it, before checking `ok`, so failed runs keep the record (`src/server/runs/agent-record.ts`).
- User cancel (SOW-0012) reuses the run's abort signal, so the adapter's kill path is unchanged. Handlers call `ctx.beginSaving()` right after a valid agent result and before any slow or writing step (discovery: before link checks; mail sync: before proposals); it throws `Aborted` if a cancel or shutdown came first, and afterwards cancel is refused with 409.
- The output schema handed to agents (`outputJsonSchema` in `src/server/tasks/schemas.ts`) must stay in the strict shape: no `$schema` pointer, no `default` keywords, `additionalProperties: false` on every object, every property in `required`. Claude Code's validator rejects zod's draft-2020-12 `$schema` pointer, and the OpenAI API behind Codex rejects anything non-strict with HTTP 400 `invalid_json_schema`. `test/server/tasks/schemas.test.ts` pins this. Evidence: SOW-0007.
- Claude Code's Gmail path depends on the claude.ai Gmail connector tools named in `DEFAULT_SETTINGS.allowed_tools_sync`. Smoke-run status (2026-11-06, claude 2.1.319, codex 0.163.0): both presets accept both task schemas and return structured output for a trivial prompt. A full discovery or sync run with real web search or Gmail has NOT been recorded yet; do not claim that without one. Evidence: SOW-0007 Validation.

## Best Practices

- The fake agent never validates the schema it receives. Any change to `outputJsonSchema` or a preset flag needs a real `claude -p … --json-schema` and `codex exec --output-schema` probe with a trivial prompt (stdin redirected from `/dev/null`, otherwise codex waits for more input).
- Test adapter behaviour with `test/fixtures/fake-agent.mjs` modes (`ok`, `prose`, `claude`, `claude-fail`, `codex`, `fail`, `hang`, `hang-tree`, `echo-argv`, plus the `debug models` catalog probe) and `process.execPath`; never require a real agent in CI.
- When a run must be killed, the whole process group dies on POSIX (`detached: true` + `kill(-pid)`) and `taskkill /T /F` on Windows; prove it with a pid file written by the fixture.
- Validate agent output with the zod schema in the task layer, never in the adapter.

## Bad Practices

- Interpolating the prompt into argv for presets that take stdin or a file.
- Catching the UNIQUE/parse error instead of checking first.
- Changing a prompt without bumping `version:` and the test that pins it.
- Treating a `mail_access: false` run as "no news".

## Workflow Checklist

1. Read the preset and the fixture mode you will touch.
2. Write or update the fake-agent test first (RED), then change the adapter.
3. If a flag changes, run the CLI's `--help` and record the version in the commit body.
4. Run `npx vitest run test/server/agents` and the e2e `test/e2e/discovery-flow.test.ts`.

## Validation Checklist

Before claiming done:

- `npm test` pristine (no leaked processes: the hang tests assert the pid is dead).
- Prompt version bumped and `test/server/tasks/prompts.test.ts` updated when wording changed.
- The spec section 7 contract (output shapes) still matches `src/server/tasks/schemas.ts`.
- Same-failure scan: `grep -rn "shell: true\|exec(" src/server` returns nothing.

## Evidence

- `src/server/agents/cli-adapter.ts`: spawn, kill, placeholder rules.
- `test/fixtures/fake-agent.mjs`: fixture modes.
- `SOW-0001`: Task 9 ruling on extraction fallback; final-review items 3, 6, 7.

## Update Rules

Update this skill when:

- a preset flag changes or a new agent preset is added;
- a real preset smoke run is recorded (replace the "not recorded" line);
- the extraction or kill semantics change.
