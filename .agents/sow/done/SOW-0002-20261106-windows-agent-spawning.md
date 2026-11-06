# SOW-0002 - Windows support for agent CLIs installed as .cmd shims

## Status

Status: completed

Sub-state: implemented in fa78d43 plus the review fix commit; Windows path covered by simulated-shim tests only.

## Requirements

### Purpose

The design lists Windows as an install target, but `spawn(argv0, args, { shell: false })` cannot start the `claude.cmd` / `codex.cmd` shims npm creates on Windows, so Setup reports "Not found on PATH" and every run fails there.

### User Request

User decision 2026-11-06: option 2 (resolve `.cmd` shims to the underlying `cli.js` and spawn `node cli.js` directly, keeping `shell: false`). Options presented to the user at SOW-0001 close:

1. Accept for v1: change the README and design goal wording to "macOS and Linux; Windows experimental" (surgical).
2. On win32 resolve the binary through `PATHEXT`; for `.cmd` shims locate the underlying `cli.js` and spawn `node cli.js` directly, keeping `shell: false` (long-term-best).
3. Spawn through `cmd.exe /d /s /c` with quoting (rejected by the reviewer: inline JSON schema on argv is fragile under cmd quoting).

### Acceptance Criteria

- Decided option recorded here before implementation.
- For option 2: a test with a fake `.cmd` shim on win32 (CI runner or manual evidence) and the README limitation removed.

## Analysis

Sources checked: `src/server/agents/cli-adapter.ts`, `README.md` Known limitations, SOW-0001 final review.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Node's `spawn` with `shell: false` cannot execute `.cmd` files; npm installs global CLIs on Windows as `<name>.cmd` shims that invoke `node "%dp0%\node_modules\<pkg>\<entry>.js"`. The adapter spawns `claude` / `codex` by bare name, so on Windows `check()` reports ENOENT and runs fail. Evidence: `src/server/agents/cli-adapter.ts` spawn calls; README Known limitations; SOW-0001 final review item 5.

Evidence reviewed:

- `src/server/agents/cli-adapter.ts`, `presets.ts`, `test/server/agents/cli-adapter.test.ts`, `test/fixtures/fake-agent.mjs`; npm's shim format (cmd-shim: `"%dp0%\node_modules\...\cli.js"` inside the `.cmd`); project skill `project-agent-adapter`.

Affected contracts and surfaces:

- New module `src/server/agents/resolve-command.ts`; `cli-adapter.ts` spawn sites (run and check); README Known limitations; project skill evidence line.

Existing patterns to reuse:

- `splitShellWords` in `presets.ts` (argv building), fake-agent fixture for tests, `Failed to start` error path.

Risk and blast radius:

- POSIX behaviour must not change: resolution runs only when `process.platform === 'win32'`, or when tests inject `platform: 'win32'` explicitly. A wrong shim parse yields `Command not found` rather than a shell. No Windows machine is available: the resolver is unit-tested with fixture `.cmd` contents and injected `env`/`fs`; the live spawn path on Windows stays untested and is marked so in the README.

Sensitive data handling plan:

- No credentials involved; fixture `.cmd` files are invented.

Implementation plan:

1. `resolve-command.ts`: `resolveCommand(argv0, { platform, env, exists, readFile })` → `{ file, prefixArgs }`. On non-win32 return `{ file: argv0, prefixArgs: [] }`. On win32: if `argv0` has a path separator or an extension, use it; else search `env.PATH` entries × `PATHEXT` (default `.COM;.EXE;.BAT;.CMD;.JS`). If the match ends with `.cmd`/`.bat`, read it; if it contains a quoted `%dp0%\...\*.js` (or `%~dp0`) reference, resolve that path relative to the shim's directory and return `{ file: process.execPath, prefixArgs: [jsPath] }`; otherwise return `{ file: argv0, prefixArgs: [] }` so the existing ENOENT message applies.
2. `cli-adapter.ts`: use the resolver for both `run` and `check` spawns; `Command not found` message unchanged.
3. Tests: resolver unit tests (PATHEXT search, `.cmd` shim parse with `%dp0%` and `%~dp0`, non-shim `.exe`, POSIX passthrough); adapter test injecting a fake win32 platform with a fixture shim that points at `fake-agent.mjs`, asserting the spawned argv is `[execPath, fixture, ...]` via the `echo-argv` mode.
4. README: Windows line changed to "agent CLIs installed by npm are resolved through their `.cmd` shims; tested with simulated shims only".

Validation plan:

- `npx vitest run test/server/agents`, then `npm test`, `npm run typecheck`; same-failure scan `grep -rn "shell: true" src`.

Artifact impact plan:

- AGENTS.md: unaffected (no workflow change). Runtime project skills: update `project-agent-adapter` Mandatory Knowledge with the resolver. Specs: `product-v1.md` Windows sentence. Docs: README Known limitations. Operator skills: none. SOW lifecycle: close in the implementation commit.

Open-source reference evidence:

- npm `cmd-shim` format known from its documented output; no mirrored repository consulted.

Open decisions:

- None.

## Plan

As in the gate.

## Execution Log

### 2026-11-06

- Gate filled; delegated implementation with independent review.
- Implemented (`src/server/agents/resolve-command.ts`, adapter spawn sites, tests, README, skill, spec) in fa78d43. Review found the README timeout bullet stale; fix round added the quoted-reference pattern, `.js` winner wrapping and the README correction.

## Validation

Acceptance criteria evidence:

- Resolver unit tests: PATH × PATHEXT search (case-insensitive), `%dp0%` and `%~dp0` references, quoted reference with spaces, `.mjs` entry, no-reference and unreadable shims, `.exe` passthrough, `.js` winner wrapped with node, explicit path skip. Adapter test spawns real node on `test/fixtures/fake-agent.mjs` through a simulated `C:\tools\fake.cmd` shim (`echo-argv` mode proves the argv).
- README Known limitations states the Windows path is tested with simulated shims only.

Tests or equivalent validation:

- `npm test` after fa78d43: Test Files 44 passed (44), Tests 288 passed (288); `npm run typecheck` exit 0. Final count after the fix round: `npm test` Test Files 44 passed (44), Tests 293 passed (293); `npm run typecheck` exit 0.

Real-use evidence:

- None on Windows (no machine available); recorded in README and the project skill.

Reviewer findings:

- Important: README still said only the direct process is killed on timeout → corrected. Minor: quoted reference with spaces (added, with test); `.js` winner on PATH now spawned through node; `.cmd` shim pointing at an `.exe` and bare `claude.cmd` argv0 noted as follow-ups in SOW-0005.

Same-failure scan:

- `grep -rn "shell: true" src` → none; both spawn sites go through the resolver.

Sensitive data gate:

- Fixture shim paths invented (`C:\tools`, `@acme/agent`).

Artifact maintenance gate:

- AGENTS.md: unaffected (no workflow change).
- Runtime project skills: `project-agent-adapter` Mandatory Knowledge updated with the resolver.
- Specs: `product-v1.md` Windows sentence updated.
- End-user/operator docs: README Known limitations updated.
- End-user/operator skills: none exist.
- SOW lifecycle: completed and moved to `done/` in the fix commit.

Specs update:

- `product-v1.md`: Windows `.cmd` shims resolved to `node <cli.js>`.

Project skills update:

- `project-agent-adapter`: resolver bullet.

End-user/operator docs update:

- README Known limitations.

End-user/operator skills update:

- none exist.

Lessons:

- Spaces in Windows install paths live in the `%dp0%` directory, not in the shim's relative reference; the resolver passes the directory as an argv element, so they are safe. Documented in the skill.

Follow-up mapping:

- `.cmd` shim referencing an `.exe`, bare `name.cmd` argv0 lookup → SOW-0005 backlog.

## Outcome

Windows npm shims for `claude`/`codex` are resolved to `node <cli.js>` with `shell: false`; verified with simulated shims only.

## Lessons Extracted

See Validation → Lessons.

## Followup

SOW-0005 items added.

## Regression Log

None yet.
