# SOW-0002 - Windows support for agent CLIs installed as .cmd shims

## Status

Status: open

Sub-state: awaiting user decision (final review of SOW-0001, item 5).

## Requirements

### Purpose

The design lists Windows as an install target, but `spawn(argv0, args, { shell: false })` cannot start the `claude.cmd` / `codex.cmd` shims npm creates on Windows, so Setup reports "Not found on PATH" and every run fails there.

### User Request

Not yet requested. Options presented to the user at SOW-0001 close:

1. Accept for v1: change the README and design goal wording to "macOS and Linux; Windows experimental" (surgical).
2. On win32 resolve the binary through `PATHEXT`; for `.cmd` shims locate the underlying `cli.js` and spawn `node cli.js` directly, keeping `shell: false` (long-term-best).
3. Spawn through `cmd.exe /d /s /c` with quoting (rejected by the reviewer: inline JSON schema on argv is fragile under cmd quoting).

### Acceptance Criteria

- Decided option recorded here before implementation.
- For option 2: a test with a fake `.cmd` shim on win32 (CI runner or manual evidence) and the README limitation removed.

## Analysis

Sources checked: `src/server/agents/cli-adapter.ts`, `README.md` Known limitations, SOW-0001 final review.

## Pre-Implementation Gate

Status: needs-user-decision

Open decisions: option 1, 2 or 3 above.
