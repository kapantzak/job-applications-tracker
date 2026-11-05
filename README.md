# Job Applications Tracker

A local app that finds job postings matching your profile, checks that the links work, and tracks your applications. It can also read your mailbox through your AI agent and propose status changes. Everything runs on your machine; data is stored in a local SQLite file.

## Install

Requires Node 22 or newer.

```sh
npx job-applications-tracker
```

Or install globally and run the short command:

```sh
npm i -g job-applications-tracker
jobtrack
```

The app starts on `http://127.0.0.1:4173` (or the next free port) and opens your browser.

## First run

1. Setup: pick the agent CLI the app should use (Claude Code, Codex, or a custom command). The app checks that it is installed and signed in.
2. Profile: enter target roles, locations, remote preference, seniority, keywords and companies to exclude.
3. Find jobs: start a discovery run from the Jobs screen and follow its progress.

## How discovery works

- The agent searches the web for postings that match your profile and returns structured results.
- The app then checks every link itself (it does not trust the agent) and shows a badge on each job:
  - **Verified**: the page loaded.
  - **Redirected**: the link led somewhere else; the final address is stored.
  - **Could not verify**: the check failed or timed out (network error, site blocking automated requests). The job is kept.
  - **Dead link**: the page is gone. These jobs are hidden by default.
- Duplicates are skipped across runs: jobs are matched by canonical URL, or by company, title and location when there is no usable URL.

## How Gmail sync works

- A sync run asks your agent to search your mailbox for messages about the jobs you applied to.
- Results appear as proposals, for example "move this application to interview". Nothing changes until you accept a proposal; you can also reject it.
- Each proposal shows its evidence (sender, date, subject, snippet) and a link to the message so you can verify it.
- Sync can run on demand, or on a schedule (Settings). Scheduled sync only runs while the app is running.

## Gmail access for other agents

Sync needs a Gmail tool in your agent.

- **Claude Code**: uses the claude.ai Gmail connector. Connect Gmail in your claude.ai account. The tools the sync run may call are listed in Settings as `allowed_tools_sync`; the default is:
  `mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Gmail__get_message`
- **Codex and custom commands**: configure a Gmail MCP server in that agent yourself. The app cannot do it for you.
- If no Gmail tool is available, the sync run fails with: `Your agent has no Gmail tool. See the setup guide in Settings.`

## Security

- The server binds to `127.0.0.1` only, so other machines cannot reach it.
- There is no authentication, on purpose: it is a single-user local tool.
- Requests must carry a loopback `Host` header, and browser requests with a foreign `Origin` are rejected. This stops other websites from using the API through your browser.
- The agent runs with the permission mode and tool allow-list shown in Settings (read-only sandbox by default; Gmail tools limited to search and read).
- The app never applies to jobs, sends mail, or modifies labels or messages.

## Data and logs

- Data lives in `~/.job-applications-tracker/`:
  - `data.db`: profile, jobs, applications, proposals, settings.
  - `runs/`: one log per run.
- Purge run logs from Settings.
- Run logs can contain agent output, including mail snippets. Do not share them.

## Command line

```
jobtrack [options]
  --port <n>        port to listen on (default 4173; 0 picks a free port)
  --data-dir <dir>  where to store data
  --no-open         do not open the browser
  --help            show help
  --version         show version
```

`JOBTRACK_DATA_DIR` sets the data directory; `--data-dir` takes precedence.

## Known limitations

- Windows: agent CLIs installed as `.cmd` shims cannot be spawned without a shell, so Windows support is untested in v1.
- On timeout only the direct agent process is killed, not processes it started.
- A custom command cannot read Gmail unless that agent has a Gmail tool.

## Development

```sh
npm install
npm test
npm run build
npm run dev:ui      # Vite dev server; proxies the API to port 4173
node bin/jobtrack.js --no-open --data-dir .tmp/dev
```
