# SOW-0013 - Human-readable run log

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered and committed (2026-11-07).

## Requirements

### Purpose

Make the Run page log readable: show what the agent is doing in plain words instead of raw JSON events, while keeping the raw output available for debugging.

### User Request

"When the run starts, we show the full JSON string in the codeblock, can we parse messages and show meaningful human-readable messages?"

### Assistant Understanding

Facts:

- Every agent stdout line is stored verbatim in `runs/<id>.log` (`src/server/runs/log-store.ts`), streamed over SSE and printed verbatim by `src/ui/components/LogView.tsx`. App lines ("Run … started", "Using adapter …", "Model: …", the saving line, "Run … <status>: …") and `[stderr] ` lines share the stream.
- Claude Code stream-json (claude 2.1.319; probe output and a sandbox run inspected 2026-11-07, content not copied): `system` (`init` with `model`, `hook_started`, `hook_response`, `commands_changed`), `assistant` (content blocks `text`, `thinking`, `tool_use` with `name` and `input`), `user` (`tool_result` with `content` string or list, optional `is_error`), `rate_limit_event` (`rate_limit_info.status`, `allowed` when fine), `result` (`subtype`, `is_error`, `duration_ms`, `total_cost_usd`, `structured_output`, `result`).
- Codex `exec --json` event and item types: see Open-source reference evidence.
- In the sandbox Claude run, 10 of 21 lines were hook events.

Inferences:

- Both formats can drift between CLI versions; the formatter must ignore what it does not know rather than fail.

Unknowns:

- None blocking. Real Codex tool-call events were not observed locally (only `agent_message`); their handling follows the source types.

### Acceptance Criteria

- The Run page shows a formatted log by default: one row per meaningful step with an icon, errors highlighted, app and stderr lines muted; hook, rate-limit-allowed, init noise, thinking/reasoning and successful tool results hidden. Verified by `test/ui/log-format.test.ts` and `test/ui/RunPage.test.tsx`.
- A "Show raw output" toggle shows the unchanged lines. Verified by UI test.
- Claude and Codex events map to the messages listed under Decisions; non-JSON lines are shown as-is; unknown agent events are hidden. Verified by formatter tests with invented events in the documented shapes.
- No server, API or storage change. Verified by diff scope.

## Analysis

Sources checked:

- `src/server/runs/log-store.ts`, `src/server/api/runs.ts` (log and SSE routes), `src/ui/components/LogView.tsx`, `src/ui/pages/RunPage.tsx`, `src/server/runs/queue.ts` and handlers (app log lines), `src/server/tasks/schemas.ts` (output shapes `jobs`, `findings`).
- Claude stream-json samples (session scratchpad probe, sandbox run log; only event types and keys were read).
- Codex source (see below).

Risks:

- Formatter drift hides new information: mitigated by the raw toggle and by showing non-JSON lines unchanged.
- Long agent texts: capped in the formatted view (full text in raw view).

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The UI prints agent event JSON verbatim; nothing interprets the documented event shapes. Evidence: `LogView.tsx` joins lines into a `<pre>`.

Evidence reviewed:

- Code, samples and source listed above.

Affected contracts and surfaces:

- UI only: new `src/ui/log-format.ts`, `LogView.tsx`, `RunPage.tsx`; tests; spec UI section; README Interface section.

Existing patterns to reuse:

- shadcn `Checkbox` + `Label` for the toggle; lucide icons; `RUN_SAVING_LOG_LINE` constant for app-line detection; existing LogView autoscroll and `aria-live`.

Risk and blast radius:

- Display only; the stored log, the API and the SSE stream are unchanged. RunPage tests that assert log text must keep working (app lines remain visible).

Sensitive data handling plan:

- Tests use invented events, queries, URLs and ids. Real logs were read for event types and keys only; no content copied. The formatted view hides tool results (Gmail content) by default; it remains in the raw view as today.

Implementation plan:

1. `src/ui/log-format.ts`: `formatLog(lines): LogEntry[]` (stateful across lines for Codex item ids), pure and exported for tests.
2. `LogView`: render entries as rows with icons and tones; `raw` prop keeps the current `<pre>` output.
3. `RunPage`: "Show raw output" toggle (default off).
4. Docs: spec, README.

Validation plan:

- RED/GREEN formatter and UI tests; `npm test`, `npm run typecheck`, `npm run build`.
- Real use: replay the sandbox Claude log and a fake run in the browser; screenshot check of the formatted view and the toggle.
- Independent review of the diff.

Artifact impact plan:

- AGENTS.md: no change expected.
- Runtime project skills: `project-agent-adapter` gets a note that the UI formatter depends on the event shapes (update both when a preset's output format changes); `project-testing` unaffected unless a new pattern appears.
- Specs: `product-v1.md` UI section.
- End-user/operator docs: README Interface section.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW, closed with the work in one commit.

Open-source reference evidence:

- `openai/codex` (local mirror; the mirror tool does not expose the checked commit; the installed CLI is codex-cli 0.163.0)
  `codex-rs/exec/src/exec_events.rs:8-133` (event types `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed`, `error`; item types `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `collab_tool_call`, `web_search`, `todo_list`, `error`), `:159-166` (command fields), `:285-306` (MCP call and web search fields); `codex-rs/exec/src/event_processor_with_jsonl_output.rs:304-323` (web search item mapping, action variants); `codex-rs/protocol/src/models.rs:2144-2172` (`WebSearchAction` tagged by `type`: `search`, `open_page`, `find_in_page`, `other`); `codex-rs/app-server-protocol/src/protocol/thread_history.rs:813-831` (reviewer: query and action filled only when the search ends).

Open decisions:

- All resolved, see below.

## Implications And Decisions

User decisions (2026-11-07):

1. Where to format → **A**: in the browser; log file and API stay raw.
2. Raw access → **A**: "Show raw output" toggle on the Run page, formatted by default.
3. Detail → **A**: concise (agent text, one line per tool call, tool errors, start/finish summary; thinking, reasoning and successful tool results hidden).
4. Visual → **A**: rows with icons by kind; errors highlighted; app and stderr lines muted.

Implementation details derived from the decisions (reported with the result):

- Claude: `init` → "Agent started (<model>)"; assistant `text` → the text (capped at 300 characters; text in `user` events is hidden); `WebSearch` → "Searching the web: <query>"; `WebFetch` → "Opening <url>"; Gmail MCP tools → "Searching Gmail: <query>" / "Reading a Gmail thread" / "Reading a Gmail message"; other `mcp__<server>__<tool>` → "Using <tool> (<server>)"; other tools → "Using <name>"; `ToolSearch`, `TodoWrite` and `StructuredOutput` hidden; `tool_result` with `is_error` → "Tool error: <first line>"; `rate_limit_event` with a status other than `allowed` → warning "Rate limit: <status>"; `result` → "Agent finished in <duration> · $<cost> · returned <n> jobs|findings", or "Agent stopped: <first line of result, else subtype>" for an error result (including subtype `success` with `is_error`).
- Codex: `item.started` MCP call / command → the same one-line wording ("Running: <command>" for commands); `item.completed` shown only when the start was not seen (items with an id), or as an error when it failed; web searches only at completion ("Searching the web: <query>", "Opening <url>" for `open_page`/`find_in_page`); failed `file_change` → error; `agent_message` → the text, or "Agent returned <n> jobs|findings" when it is the structured JSON; `turn.completed` → "Agent finished · <n> tokens"; `turn.failed` and `error` → error rows; `thread.started`, `turn.started`, `item.updated`, `reasoning`, `todo_list` hidden.
- Non-JSON lines: app lines (queue and handler messages) muted, `[stderr] ` lines muted, anything else shown as plain text; every row capped at 300 characters. JSON without a string `type` (e.g. a custom command's own output) is summarised as "Agent returned N jobs|findings" when it carries them, else shown as text; JSON with an unknown `type` is hidden.
- When lines exist but none is shown: "Nothing readable to show. Turn on raw output to see everything."

## Plan

See Implementation plan.

## Execution Log

### 2026-11-07

- SOW created with decisions recorded.
- `src/ui/log-format.ts` (`formatLog`), `LogView` rows with icons and raw mode, Run page "Show raw output" checkbox. RED observed for the formatter (module missing), the Run page tests and the review-fix tests before implementation.
- Real Claude probes for evidence: a tiny custom-command run through the app (one web search) and a `--json-schema` probe, which showed the `StructuredOutput` tool call.
- Independent review and fixes, see Validation.

## Validation

Acceptance criteria evidence:

- Readable rows, hidden noise, tones and icons: `test/ui/log-format.test.ts` (27 tests: app/handler lines, stderr, capping, typeless JSON, malformed JSON, Claude hooks/thinking/tools/errors/rate limit/result variants, Codex pairing, web search at completion, page opens, failures, id-less items) and `test/ui/RunPage.test.tsx` (initial log, streamed rows, empty readable view).
- Raw toggle on and off: `test/ui/RunPage.test.tsx`.
- No server, API or storage change: diff touches `src/ui/` (plus docs, spec, skill, tests) only.

Tests or equivalent validation:

- `npm test`: `Test Files  49 passed (49)`, `Tests  444 passed (444)`; no stderr, act or React warnings.
- `npm run typecheck`: clean. `npm run build`: clean.

Real-use evidence (2026-11-07, claude 2.1.319):

- Built app on throwaway `.tmp/sow13` with a custom command running Claude (sonnet, low effort) on a fixed one-search prompt: 22 raw lines became 7 rows ("Agent started (claude-sonnet-5-5)", "Searching the web: …", the agent's reply, "Agent finished in 11s · $0.17", and the highlighted schema failure, which was expected for that prompt).
- `--json-schema` probe: 16 raw lines became 2 rows; the `StructuredOutput` call is hidden.
- Browser (Chrome): readable rows with icons, failure highlighted, "Show raw output" switches to the unchanged JSON; no console errors.
- Codex tool events were not observed live (the local probe only produced `agent_message`); their handling follows the upstream source, checked by the reviewer and in the mirror.

Reviewer findings (independent read-only subagent review):

1. Codex web search shown at start with an empty query (query and action are filled only at the end): fixed; shown from the completed item, `open_page`/`find_in_page` → "Opening <url>"; realistic tests added.
2. Claude error result with subtype `success` showed "Agent stopped: success": fixed (first line of `result`); test added.
3. Handler app lines rendered as agent text: fixed (patterns for discovery and mail-sync lines); test added.
4. "Run x failed: " with an empty reason not highlighted: fixed; test added.
5. Plain and stderr rows uncapped; a custom agent's typeless findings JSON (email-derived text) shown in full: fixed (all rows capped; typeless JSON with jobs/findings summarised); test added.
6. Text in `user` events shown as agent messages: fixed; test added.
7. `StructuredOutput` tool row (confirmed by a real `--json-schema` probe): hidden; test added.
8. Failed Codex `file_change` not an error, empty path list: fixed; test added.
9. Codex items without an id broke pairing: fixed; test added.
10. Indented JSON lines not parsed: fixed; test added.
11. Loose matches ("Model: " from a custom agent, non-Gmail MCP tools with Gmail tool names): accepted and commented in code; harmless for a progress log.
12. Whole log re-formatted per streamed line: rejected for now; the reviewer measured about 5 ms per pass for 600 lines (half of them 30 KB), well within budget for runs of this size.
13. Ref type hack in `LogView`: fixed with a callback ref.
14. Empty-view wording on finished runs: changed to "Nothing readable to show. …".
15. Privacy: covered by fix 5; tool results stay hidden.
16–18. Tests: realistic Codex web search, error-result, app lines, malformed JSON, capping, id-less items, failed file change, streamed rows and toggling raw off: added.

Same-failure scan:

- Other places that print agent output: only `LogView` (Run page). The Runs list shows `summary`/`error`, not the log. No server code changed.
- App line sources checked: `queue.ts`, `discovery.ts`, `mail-sync.ts`, `agent-source.ts`.

Sensitive data gate:

- Tests use invented events, queries, URLs and ids. Real logs and probes were read for event types and keys only; the SOW quotes only the generic probe prompt and model names. The readable view hides tool results (Gmail content) and summarises structured results instead of printing them.

Artifact maintenance gate:

- AGENTS.md: no update; no workflow or guardrail changed.
- Runtime project skills: `.agents/skills/project-agent-adapter/SKILL.md` (formatter depends on event shapes; update together). `project-testing`: no update; no new harness or pattern. `project-local-api`: unaffected (no route change).
- Specs: `.agents/sow/specs/product-v1.md` User interface.
- End-user/operator docs: `README.md` Interface section.
- End-user/operator skills: none exist.
- SOW lifecycle: single SOW; set `completed` and moved to `done/` in the same commit as the work.

Specs update:

- `product-v1.md` as above.

Project skills update:

- `project-agent-adapter` as above.

End-user/operator docs update:

- `README.md` as above.

End-user/operator skills update:

- None exist.

Lessons:

- Invented test events must follow when fields are filled in, not just which fields exist: Codex fills a web search only at completion, and an unrealistic start event hid that bug.
- A real `--json-schema` probe revealed a tool call (`StructuredOutput`) that no documentation in the repo mentioned; probe the exact preset flags before writing a formatter.

Follow-up mapping:

- Reviewer item 11: accepted, commented.
- Reviewer item 12: rejected with measurement above.
- No deferred work.

## Outcome

The Run page log reads as a short list of steps (agent started, web searches, pages opened, Gmail reads, agent messages, errors, finish summary) with icons and highlighted errors; "Show raw output" shows the stored lines unchanged. Nothing changed on the server.

## Lessons Extracted

- Recorded in Validation → Lessons; the durable rule (update the formatter with the event shapes) is in `project-agent-adapter`.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
