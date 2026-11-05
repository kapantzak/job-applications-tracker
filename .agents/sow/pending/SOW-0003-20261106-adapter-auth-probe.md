# SOW-0003 - Report agent sign-in state in Setup and Settings

## Status

Status: open

Sub-state: awaiting user decision (final review of SOW-0001, item 4).

## Requirements

### Purpose

The design's `AdapterHealth` includes "authenticated?" and Setup was meant to show "installed and authenticated". v1 probes only `--version`; the README wording was corrected to "installed". Both CLIs expose a status command on the development machine (`claude auth status`, `codex login status`).

### User Request

Not yet requested. Option: add `authArgv` to each preset, report `authenticated?: boolean` in `AdapterHealth`, and show it in `AdapterChooser`; treat a non-zero exit as "not signed in" with the CLI's message.

### Acceptance Criteria

- `GET /api/setup/adapters` returns `authenticated` for claude and codex; custom stays unknown.
- Setup shows "signed in" / "not signed in" next to the version.
- Fake-agent fixture gains an `auth` mode; tests cover both outcomes.

## Pre-Implementation Gate

Status: needs-user-decision

Open decisions: whether to implement for v1.1; the exact subcommands must be re-verified on the build machine.
