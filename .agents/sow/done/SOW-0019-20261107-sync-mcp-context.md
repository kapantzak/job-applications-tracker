# SOW-0019 - Mail sync loads every user MCP server

## Status

Status: closed

Sub-state: rejected 2026-11-07 (user decision 1A): its premise came from a probe that did not use the app's sync argv. No code change.

## Requirements

### Purpose

Cut the context a mail sync run loads before it starts, without losing the Gmail access it needs.

### User Request

SOW-0018 decision 4A: track the sync MCP cost as its own SOW.

### Assistant Understanding

Facts:

- The Claude sync preset has no `--strict-mcp-config`, so every MCP server in the user's configuration loads. A sync-style probe on 2026-11-07 (`claude` 2.1.319) read 275,069 input tokens on its first turn and reported $1.14 before doing any work.
- Sync needs the claude.ai Gmail connector tools named in `DEFAULT_SETTINGS.allowed_tools_sync`. `--setting-sources ""` and `--safe-mode` both drop that connector (SOW-0008, SOW-0018).

Inferences:

- Loading only the Gmail connector would remove most of that context, if Claude Code offers a way to select one claude.ai connector.

Unknowns:

- Whether `--mcp-config` or another flag can load a single claude.ai connector, or whether `--tools`/settings can drop the other servers' tool definitions.

### Acceptance Criteria

- To be set after investigation.

## Analysis

Sources checked:

- SOW-0018 Analysis (probe table).

Current state:

- See Facts.

Risks:

- Breaking Gmail access breaks sync for every Claude user; any change needs a real sync run.

## Pre-Implementation Gate

Status: blocked (not started).

Problem / root-cause model:

- The sync argv keeps every MCP server so that the Gmail connector stays available.

Evidence reviewed:

- SOW-0018 probes; `src/server/agents/presets.ts`.

Affected contracts and surfaces:

- `src/server/agents/presets.ts` sync argv, adapter tests, `project-agent-adapter` skill, spec.

Existing patterns to reuse:

- `claudeDiscoverFlags` (`--strict-mcp-config` unless an MCP tool is allowed).

Risk and blast radius:

- Every Claude mail sync.

Sensitive data handling plan:

- Probes read no mail content into durable artifacts; only token counts and tool names.

Implementation plan:

1. Investigate flags that load one connector; probe with a no-mail canary prompt.
2. Present options to the user with numbers.

Validation plan:

- Canary probes and one real sync run on an invented test mailbox label, numbers recorded.

Artifact impact plan:

- `project-agent-adapter` skill and spec if the argv changes; README if setup changes; AGENTS.md unaffected.

Open-source reference evidence:

- None checked yet.

Open decisions:

- The approach, after investigation.

## Implications And Decisions

User decision (2026-11-07):

1. A. Close as rejected with evidence. Measured with the app's exact sync argv (SOW-0018 Execution Log), a sync run started at 47,042 input tokens ($0.15) before SOW-0018 and 26,747 ($0.07) after, with MCP tools deferred. The 275,069-token figure in Facts came from a probe with `--tools WebFetch` and no `--allowedTools`, not from the app's argv. Loading only the Gmail connector would save part of the remaining 27k; judged not worth a SOW.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- Created from SOW-0018 decision 4A.
- Closed the same day as rejected (decision 1A) after SOW-0018 measured the app's real sync argv.

## Validation

- No implementation; rejection evidence is in Implications And Decisions and SOW-0018.

Sensitive data gate:

- The SOW holds flags, token counts and costs only.

Artifact maintenance gate:

- No artifact changes: nothing shipped. The measured sync context is recorded in the `project-agent-adapter` skill by SOW-0018.

## Outcome

- Rejected; no change.

## Lessons Extracted

- Measure with the app's exact argv before opening a cost SOW (recorded in `project-agent-adapter`).

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
