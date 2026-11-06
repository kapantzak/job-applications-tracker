# Job Applications Tracker: Design

Date: 2026-11-05
Status: approved by user on 2026-11-05

## 1. Intent

A job seeker installs one npm package, runs one command, and gets a local web app that:

1. finds job openings matching a profile they typed in, with links they can click to apply manually, and
2. keeps the state of every application they made up to date, using the replies that land in their Gmail.

The heavy lifting (searching the web, reading mail, judging what an email means) is done by an AI agent the user already has and pays for. The app owns no model keys and makes no model calls of its own. It orchestrates, stores, verifies and presents.

Why: applying for jobs is a tracking problem as much as a search problem. Spreadsheets rot, and SaaS trackers want the user's mailbox and money. A local tool that borrows the user's own agent keeps data on the user's disk and costs nothing beyond what they already spend on the agent.

## 2. Goals, non-goals, anti-goals

Goals

- Install and run with a single command on macOS, Linux and Windows: `npx job-applications-tracker`.
- Everything stays on the user's machine. The only outbound traffic is what the agent itself makes.
- Works with whatever agent CLI the user has (Claude Code and Codex are first-class; anything else via a custom command).
- Every job link shown to the user has been verified reachable by the app.
- No application status ever changes without the user confirming it.

Non-goals (v1)

- Applying on the user's behalf, filling forms, or automating job boards.
- Multi-user, accounts, remote access, cloud sync.
- Mail providers other than Gmail.
- Resume or cover-letter generation.
- Mobile UI. Desktop browser only.

Anti-goals (failure even if it "works")

- A results list full of dead, duplicate or hallucinated links.
- Status changes the user did not make and cannot explain.
- The agent being handed the whole mailbox.
- A setup that requires a Google Cloud project, API keys, or editing config files by hand on the Claude Code path. Other agents may need a one-time, documented Gmail MCP configuration (see Decision 7).

## 3. Constraints

- Node.js 22 or newer. Must install cleanly with `npm install -g` and run with `npx`. (Amended 2026-11-05 during implementation: originally 20. Node 20 reached end of life in April 2026 and the chosen SQLite binding requires 22.)
- No native build step on install. Native dependencies must ship prebuilt binaries for the three platforms.
- The agent runs as a child process of the server. The user has already authenticated that CLI; the app never handles credentials.
- Agent runs can take seconds to minutes. Nothing in the HTTP layer may block on them.
- The agent's Gmail access is whatever tooling that agent already has (for Claude Code, the claude.ai Gmail connector; for others, an MCP server the user configured). The app does not implement Gmail access in v1.

## 4. Decisions (as decided by the user, 2026-11-05)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Agent integration | Adapter interface. v1 ships one `cli` adapter with presets for Claude Code and Codex, plus a custom command template. An `api` adapter is a later addition, not built now. |
| 2 | Gmail access | The agent reads Gmail with its own tools. The app defines a `MailSource` interface and ships one implementation, `agent`. OAuth and IMAP sources are later additions, not built now. |
| 3 | Job discovery | Agent web search, then app-side link verification and dedupe. Structured job-board feeds are a later addition, not built now. |
| 4 | Stack | Node 20+, TypeScript, Hono server, SQLite via better-sqlite3, React + Vite SPA bundled into the package. |
| 5 | Status updates from email | Proposed by the agent, confirmed by the user in a review queue, with the evidence email attached. |
| 6 | v1 scope | Both discovery and Gmail-driven tracking ship in v1. |
| 7 | Agent without a Gmail tool | Capability check plus documented manual step. The `sync_mail` output schema has a required `mail_access` boolean; a run reporting `false` is marked `failed` with a clear message, never `succeeded` with zero findings. For non-Claude adapters, Setup shows a short guide for configuring a Gmail MCP server. |

Defaults set by the author (user may override):

- Package `job-applications-tracker`, binary `jobtrack`, default port 4173, browser auto-opened on start.
- Data directory `~/.job-applications-tracker/` holding `config.json`, `data.db`, `runs/` (per-run logs).
- Status pipeline: `saved`, `applied`, `screening`, `interview`, `offer`, `rejected`, `withdrawn`, `no_response`. `no_response` is set by the user only (author's call); the app does not age applications automatically in v1 and the agent never proposes it.

## 5. Architecture

### 5.1 Package layout

Single npm package, single process.

```
job-applications-tracker/
  bin/jobtrack.js            CLI entry: parse args, start server, open browser
  src/server/                Hono app, routes, services
  src/server/db/             schema, migrations, repositories
  src/server/agents/         AgentAdapter interface, cli adapter, presets
  src/server/mail/           MailSource interface, agent mail source
  src/server/tasks/          task definitions: prompt templates + output schemas
  src/server/runs/           background run queue and log capture
  src/server/verify/         link verification and dedupe
  src/ui/                    React + Vite SPA
  dist/                      built server + built UI, shipped in the tarball
  prompts/                   versioned prompt templates (markdown), shipped
```

`bin/jobtrack.js` starts the server on `127.0.0.1` only. Never binds to `0.0.0.0`.

### 5.2 Process model

- One Node process. Hono serves the API under `/api/*` and the built SPA for everything else.
- A run queue (in-process, persisted in SQLite) executes agent runs one at a time. Concurrency 1 in v1: two agent runs at once is both slower and harder to attribute cost to.
- Each run spawns the agent CLI as a child process with a prompt on stdin or argv, captures stdout and stderr to `runs/<run-id>.log`, enforces a timeout (default 10 minutes, configurable), and parses the final JSON.
- The UI polls `/api/runs/:id` for status and tails the log over Server-Sent Events. SSE, not WebSockets, because it is one-directional and needs no extra dependency. Live progress is best-effort per preset: Claude Code streams events, Codex `--json` streams events, a custom command shows whatever it prints.
- `SIGINT`/`SIGTERM` kills the child process of any in-flight run, marks the run `aborted`, and exits.

### 5.3 Agent adapter

```ts
interface AgentAdapter {
  id: string;                       // "claude" | "codex" | "custom"
  check(): Promise<AdapterHealth>;  // binary found, version, authenticated?
  run(task: AgentTask, opts: RunOptions): Promise<AgentResult>;
}

interface AgentTask {
  kind: "discover_jobs" | "sync_mail";
  prompt: string;                   // rendered from prompts/<kind>.md
  outputSchema: JsonSchema;         // the structure the agent must return
}

interface AgentResult {
  ok: boolean;
  output?: unknown;                 // parsed JSON, validated against outputSchema by the caller
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
  durationMs: number;
}
```

The `cli` adapter is configured by a command template. Presets, verified against the installed versions on 2026-11-05 (Claude Code 2.1.x, Codex CLI 0.163):

- Claude Code: `claude -p --output-format stream-json --verbose --json-schema <schema> --permission-mode <mode> --allowedTools <tools>`. Prompt on stdin. Output is NDJSON; the adapter forwards each event to the run log as it arrives so the run page shows live progress, and takes `structured_output` from the final `result` event (author's call: `stream-json` rather than `json`, because `json` emits one blob at the end and the live log would be empty for minutes).
- Codex: `codex exec --json --output-schema <schema-file> --skip-git-repo-check --sandbox <mode> -o <last-message-file>`. Prompt on argv. The last-message file is the result.
- Custom: user supplies the full command with `{prompt_file}` and `{schema_file}` placeholders. The adapter expects the final line of stdout, or the whole stdout, to be the JSON.

Permission mode and allowed tools are preset per task kind and shown to the user in Settings so they know what the agent is allowed to do. The builder must confirm the exact flag spellings against the installed CLIs at build time; the flags above were read from `--help` output and may change between CLI versions.

The adapter never interprets the output. The task layer validates it against the schema with zod and rejects the run on mismatch, keeping the raw log for the user to inspect.

### 5.4 Mail source

```ts
interface MailSource {
  id: "agent";
  sync(request: MailSyncRequest): Promise<MailSyncFindings>;
}
```

The `agent` mail source is the agent adapter running the `sync_mail` task. Its request lists only the open applications (company, role, applied date, known sender domains) and asks for findings scoped to messages from those companies since those dates. The interface exists so an OAuth source can later feed the same findings shape without touching the review queue.

### 5.5 Data model (SQLite)

- `profile` (single row): target roles, locations, remote preference, seniority, keywords, excluded companies, free-text notes for the agent.
- `settings` (key/value): adapter id, command template, permission mode, timeout, port.
- `runs`: id, kind, status (`queued`, `running`, `succeeded`, `failed`, `aborted`), started/finished timestamps, adapter id, prompt version, summary, error.
- `jobs`: id, run_id, company, title, location, remote, url, canonical_url, source_site, posted_at (if known), salary (if stated), description_excerpt, verification_status (`ok`, `redirected`, `dead`, `unverified`), verified_at, dedupe_key, dismissed_at.
- `applications`: id, job_id (nullable, manual entries allowed), company, role, url, status, applied_at, status_changed_at, notes, sender_domains (JSON).
- `status_history`: id, application_id, from_status, to_status, changed_at, source (`user`, `proposal`), proposal_id.
- `proposals`: id, run_id, application_id, proposed_status, confidence, reason, evidence (JSON: message id, date, from, subject, snippet), state (`pending`, `accepted`, `rejected`), decided_at.

Migrations are numbered SQL files applied on start.

## 6. Feature flows

### 6.1 First run

1. `npx job-applications-tracker` creates the data directory, applies migrations, starts on 4173 (or next free port), opens the browser.
2. Setup screen: pick an adapter. The app runs `check()` for each preset and shows which are installed and authenticated. User picks one, or enters a custom command. For Claude Code nothing else is required. For Codex and custom commands, the screen shows a "Gmail access" section explaining that the agent needs a Gmail MCP server configured and linking to the README guide; discovery works regardless.
3. Profile screen: the user fills the profile. Saving enables "Find jobs".

### 6.2 Discovery run

1. User clicks "Find jobs". The app renders `prompts/discover_jobs.md` with the profile and the list of already-known canonical URLs (so the agent is told not to repeat them), queues a `discover_jobs` run, and shows the run page with the live log.
2. The agent returns an array of candidate jobs per the schema.
3. For each candidate, the verifier issues an HTTP request with a browser-like User-Agent and a short timeout. Classification (author's call): `2xx` is `ok`; a redirect chain ending in `2xx` is `redirected` and the final URL becomes `canonical_url`; `404`, `410`, DNS failure or connection refused is `dead`; `403`, `429`, `999`, `5xx` and timeouts are `unverified`, because large boards (LinkedIn, Indeed, Glassdoor) block automated requests and a block is not evidence the posting is gone. `unverified` jobs are shown with a distinct badge. `dead` jobs are stored but hidden by default. The discovery prompt asks the agent to prefer the employer's own careers page or ATS link over an aggregator link when both exist.
4. Dedupe key is the canonical URL with tracking query parameters stripped, falling back to normalised `company + title + location`. Duplicates of existing jobs are dropped with a count shown in the run summary.
5. The Jobs screen lists new results first. Each row: company, title, location, source, verification badge, "Open" (new tab), "Save", "Mark applied", "Dismiss". "Save" creates an application in `saved` with no `applied_at` (author's call: `applications.applied_at` is nullable; `saved` applications are excluded from mail sync until the user marks them applied).

### 6.3 Application lifecycle

- "Mark applied" creates an application in `applied` with `applied_at` now, editable. The user may also add an application manually with no linked job.
- The user can change status at any time; every change is recorded in `status_history` with source `user`.
- `sender_domains` defaults to the company's website domain inferred from the job URL and is editable, because recruiting mail often comes from ATS domains (greenhouse.io, lever.co, ashbyhq.com, myworkday.com). The sync prompt tells the agent about these common ATS senders too.

### 6.4 Mail sync run

1. User clicks "Sync from Gmail" (or enables a scheduled sync, see 6.6). The app renders `prompts/sync_mail.md` with open applications only (not `rejected`, `withdrawn`, `offer` older than 30 days), queues a `sync_mail` run.
2. The prompt instructs the agent to search only for messages from the listed companies and known ATS domains, newer than each application's `applied_at`, and to return one finding per application at most, with the evidence message and a confidence score. It must not quote more than a short snippet.
3. Each finding becomes a `proposal` in `pending`. Nothing changes on the application.
4. The Review screen lists pending proposals: current status, proposed status, reason, evidence (from, date, subject, snippet, link to the Gmail message by id). "Accept" applies the change and records history with source `proposal`. "Reject" marks it rejected and the same evidence message id is passed back as "already reviewed" in future sync prompts.

### 6.5 Settings

Adapter and command template, permission mode and allowed tools per task kind, run timeout, port, data directory location (read-only display), prompt template versions in use, "Open logs folder".

### 6.6 Scheduled sync (included in v1, minimal)

An optional interval (off by default; choices 1h, 6h, 24h) that enqueues a `sync_mail` run while the server is running. No OS-level scheduler. If the server is not running, nothing happens.

## 7. Agent contract

Prompts are markdown files with `{{placeholders}}`, versioned by a `version:` front-matter field recorded on each run. Each task has a zod schema that is also exported as JSON Schema for the CLI flags.

`discover_jobs` output:

```json
{ "jobs": [ { "company": "", "title": "", "location": "", "remote": "remote|hybrid|onsite|unknown",
              "url": "", "source_site": "", "posted_at": null, "salary": null,
              "description_excerpt": "", "match_reason": "" } ],
  "notes": "" }
```

`sync_mail` output:

```json
{ "mail_access": true,
  "findings": [ { "application_id": "", "proposed_status": "screening|interview|offer|rejected|no_change",
                  "confidence": 0.0, "reason": "",
                  "evidence": { "message_id": "", "date": "", "from": "", "subject": "", "snippet": "" } } ],
  "notes": "" }
```

Findings with `no_change` are dropped. Findings whose `application_id` is unknown are logged and dropped. The prompt instructs the agent to set `mail_access` to `false` and return no findings when it has no tool that can search Gmail; the run is then marked `failed` with the message "your agent has no Gmail tool" and a link to the setup guide.

The prompts explicitly tell the agent: do not apply to anything, do not send or draft mail, do not modify labels, read only.

## 8. Security and privacy

- Server binds to loopback only. No authentication is added; this is stated in the README.
- Amended 2026-11-06 during implementation: "the only client is the same machine's browser" was a wrong premise, because the same browser runs every other website's scripts. The API therefore allow-lists the `Host` header (`127.0.0.1`, `localhost`, `[::1]`), checks `Origin` on state-changing requests, and requires `Content-Type: application/json` for JSON bodies, so other sites and DNS-rebinding pages cannot drive it.
- The app never sees Gmail credentials or tokens.
- The sync prompt is scoped by sender and date; the agent is told to return snippets, not bodies. Raw agent logs may still contain more than that and live only in `runs/`, which the user can purge from Settings.
- Agent permission settings are visible and editable; presets use the narrowest mode that still allows web search (discovery) and the Gmail tool (sync). The builder must determine the exact tool names per CLI.
- Link verification requests carry no cookies and follow at most 5 redirects.

## 9. Error handling and observability

- Every run keeps its full log. The run page shows the parsed result or the schema validation error with the offending path.
- Adapter `check()` runs on the Settings page and before each run; a missing or unauthenticated CLI is a clear message, not a failed run. Gmail capability cannot be probed without running the agent, so it is self-reported per sync run via `mail_access` (Decision 7).
- Timeouts kill the child process tree.
- The UI shows the last successful discovery and sync times on the dashboard.

## 10. Testing

- Unit: schema validation, dedupe key derivation, canonical URL normalisation, prompt rendering, proposal acceptance logic, migrations.
- Adapter: tests run against a fake agent script (a small Node script that prints canned JSON) so CI never needs a real agent. One optional, manually run smoke test per preset.
- Verifier: tests against a local HTTP server that serves 200, 301 chains, 404 and hangs.
- UI: component tests for the Jobs, Review and Settings screens; one end-to-end run through the fake agent.

## 11. Left to the builder

- Exact Hono route shapes, React component structure, state management choice.
- CSS approach, as long as it is dependency-light and ships in the bundle.
- Migration tooling (hand-rolled numbered SQL is acceptable).
- Logging library or none.
- How the SPA is served in dev versus from `dist/`.
- Exact wording of prompts, subject to the contract in section 7.
- Windows process-tree kill details.

## 12. Later additions (explicitly out of v1)

`api` adapter with direct model calls; OAuth and IMAP mail sources; structured job-board feeds (Greenhouse, Lever, Ashby, Adzuna, Remotive); OS-level scheduling; export to CSV; multiple profiles.
