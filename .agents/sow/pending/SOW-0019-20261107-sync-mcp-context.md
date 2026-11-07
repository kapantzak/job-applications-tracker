# SOW-0019 - Mail sync loads every user MCP server

## Status

Status: open

Sub-state: created 2026-11-07 from SOW-0018 decision 4A; to start after SOW-0018 and SOW-0017.

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

None yet.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- Created from SOW-0018 decision 4A.

## Validation

Pending until the work is done.

Sensitive data gate:

- Checked at close.

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
