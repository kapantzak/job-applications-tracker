# SOW-0003 - Report agent sign-in state in Setup and Settings

## Status

Status: completed

## Requirements

### Purpose

The design's `AdapterHealth` includes "authenticated?" and Setup was meant to show "installed and authenticated". v1 probes only `--version`; the README wording was corrected to "installed". Both CLIs expose a status command on the development machine (`claude auth status`, `codex login status`).

### User Request

User decision 2026-11-06: implement option B. Option: add `authArgv` to each preset, report `authenticated?: boolean` in `AdapterHealth`, and show it in `AdapterChooser`; treat a non-zero exit as "not signed in" with the CLI's message.

### Acceptance Criteria

- `GET /api/setup/adapters` returns `authenticated` for claude and codex; custom stays unknown.
- Setup shows "signed in" / "not signed in" next to the version.
- Fake-agent fixture gains an `auth` mode; tests cover both outcomes.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- `check()` only runs `--version`, so Setup cannot tell an installed-but-signed-out CLI from a working one; the first run then fails with the CLI's auth error inside the run log. Evidence: `src/server/agents/cli-adapter.ts` `check()`, SOW-0001 final review item 4.

Evidence reviewed:

- `claude auth --help` and `codex login --help` on the development machine (2026-11-06, final review): `claude auth status` and `codex login status` exist. Exact exit codes and output must be re-verified by the implementer and recorded in the commit body. `src/server/agents/presets.ts`, `types.ts`, `src/server/api/setup.ts`, `src/ui/components/AdapterChooser.tsx`.

Affected contracts and surfaces:

- `CliAdapterConfig.authArgv?: string[]`; `AdapterHealth.authenticated?: boolean` and `authMessage?: string`; `GET /api/setup/adapters` response; `AdapterChooser` display; README First run wording; `project-agent-adapter` skill; `product-v1.md`.

Existing patterns to reuse:

- The `versionArgv` probe in `check()` (3 s timeout, never rejects); fake-agent fixture modes.

Risk and blast radius:

- A wrong subcommand makes every preset show "not signed in"; mitigated by reporting `authenticated: undefined` with `authMessage` when the probe fails to start, and by only showing "not signed in" on a clean non-zero exit. Custom commands have no probe (undefined). Adds up to 3 s to the setup page load (probes run in parallel with the version probe).

Sensitive data handling plan:

- Probe output may contain the account email; only a boolean and a short trimmed first line are returned, and the UI shows the boolean only. Nothing is logged to run logs.

Implementation plan:

1. presets: `authArgv` for claude `['claude','auth','status']` and codex `['codex','login','status']`.
2. `check()`: run the auth probe after a successful version probe, in parallel with nothing else; exit 0 → `authenticated: true`; non-zero exit → `false` with the first stdout/stderr line as `authMessage`; spawn failure or timeout → `undefined` with `authMessage`.
3. setup route passes the fields through; `AdapterChooser` shows "signed in" / "not signed in (<message>)" / nothing when undefined.
4. Fixture mode `auth-ok` / `auth-fail` keyed by argv (`auth`, `status`); tests for all three outcomes; UI test for the two labels.
5. README First run: "checks that it is installed and signed in" restored, accurately.

Validation plan:

- `npx vitest run test/server/agents test/server/api/setup.test.ts test/ui/SetupPage.test.tsx`, then `npm test`, `npm run typecheck`.

Artifact impact plan:

- Skill `project-agent-adapter`: add the probe to Mandatory Knowledge. Spec `product-v1.md`: "no sign-in probe in v1" sentence replaced. README updated. AGENTS.md unaffected. SOW closes in the implementation commit.

Open-source reference evidence:

- None.

Open decisions:

- None.

## Execution Log

### 2026-11-06

- Gate filled while SOW-0002 was in progress.

## Validation

Acceptance criteria evidence:

- `GET /api/setup/adapters` passes `authenticated`/`authMessage` through: `test/server/api/setup.test.ts` "passes the sign-in fields through unchanged". Custom has no `authArgv` (preset test), so it stays unknown.
- Setup shows "signed in" / "not signed in (<message>)" / nothing: `test/ui/SetupPage.test.tsx` "labels each adapter as signed in or not signed in and stays silent when unknown".
- Fixture gained the `FAKE_AGENT_AUTH` ok/fail/hang modes (`test/fixtures/fake-agent.mjs`); adapter tests cover all outcomes.

Tests or equivalent validation:

- RED first: 6 new tests failed before the change. GREEN: `npm test` -> "Test Files  44 passed (44)", "Tests  301 passed (301)". `npm run typecheck` clean; no leaked fake-agent processes.
- Adapter tests: reports authenticated when the probe exits 0; reports not authenticated with the first output line on a non-zero exit; leaves authenticated unknown when the probe times out; ... cannot start; skips the probe when the version probe fails; preset status commands.

Real-use evidence:

- `claude --version` 2.1.319, `codex --version` 0.163.0; `claude auth --help` lists `status`, `codex login --help` lists `status`. `check()` against the real presets returned installed + `authenticated: true` for both. No account details recorded.

Reviewer findings:

- none (controller review pending).

Same-failure scan:

- `grep -rn "shell: true" src` -> none.

Sensitive data gate:

- invented data only; only a boolean and a trimmed first line are returned, the UI shows the message only for "not signed in".

Artifact maintenance gate:

- AGENTS.md: unaffected.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` updated.
- Specs: `.agents/sow/specs/product-v1.md` updated.
- End-user/operator docs: `README.md` First run updated.
- End-user/operator skills: none exist.
- SOW lifecycle: moved to done/ in the implementation commit.

Specs update:

- `product-v1.md`: sign-in probe described.

Project skills update:

- `project-agent-adapter`: Mandatory Knowledge bullet added.

End-user/operator docs update:

- README First run restored to mention sign-in.

End-user/operator skills update:

- none exist.

Lessons:

- The shared probe helper keeps version and sign-in checks on one spawn/timeout path; an injected `authTimeoutMs` keeps the hang test fast.

Follow-up mapping:

- none.

## Outcome

Setup and Settings show whether Claude Code and Codex are signed in; probe failures leave the state unknown instead of claiming signed out.

## Lessons Extracted

See Validation -> Lessons.

## Followup

None.

## Regression Log

None yet.
