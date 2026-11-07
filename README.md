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

1. Setup: pick the agent CLI the app should use (Claude Code, Codex, or a custom command). The app checks that it is installed and, for Claude Code and Codex, whether it is signed in.
2. Profile: the app opens on your profiles. With none yet, it shows the profile form: give the profile a name, then enter target roles, locations, remote preference, seniority, keywords and companies to exclude.
3. Find jobs: open the profile and start a discovery run from its Dashboard or Jobs screen, then follow its progress.

## Profiles

- Keep one profile per search, for example "Platform roles" and "Data roles". Each profile has its own jobs, applications, proposals and runs; the agent and app settings are shared.
- Profile names use letters, numbers and single spaces (any alphabet). Each profile gets a short address from its name, for example `/profiles/platform-roles`; renaming a profile changes it, so old bookmarks to that profile stop working.
- Inside a profile, the top left shows its name; click it to go back to all profiles.
- The start screen lists every profile with how many jobs, applications and runs it holds. Open one to work inside it.
- The same job posting can show up in more than one profile.
- Gmail sync runs per profile: it only looks at that profile's open applications. A scheduled sync runs once for each profile that has open applications.
- Deleting a profile (Delete on its card, then confirm) removes the profile with all its jobs, applications, proposals, status history and run logs. It cannot be undone. While one of its runs is queued or running, cancel the run first.
- Upgrading from a version with a single profile keeps your data: the existing profile becomes your first profile, named after its first target role (characters other than letters, numbers and spaces are replaced by spaces).

## Cancelling a run

- A queued or running run can be cancelled from its Run page or from the Runs list ("Cancel run", then confirm). The agent is stopped and nothing from that run is saved; the run shows as aborted with "Cancelled by user".
- Once the agent has finished and the app is checking links and saving results, the run can no longer be cancelled: the Run page shows "Saving results…", and a cancel from the Runs list is refused with a message.
- Stopping the agent can take a few seconds; the Run page shows "Cancelling…" meanwhile.

## Model and effort

- Settings → Agent lets you pick the model and the effort level for Claude Code or Codex, separately for discovery and for Gmail sync. Leave them on "Agent default" to use whatever your Claude Code or Codex configuration sets; the app then passes no flag and cannot tell you which model that is.
- Model suggestions: Claude Code offers `fable`, `opus` and `sonnet` (or type a full model id). Codex lists the models from `codex debug models`; if that fails, type the model id.
- Higher effort (`xhigh`, `max`, Codex `ultra`) makes runs slower and can hit the run timeout. Codex `ultra` delegates work to subagents.
- Each run records what it asked for. The Run page shows it; for Claude Code it also shows the model that actually ran. Neither agent reports the effort it used.
- A custom command carries its own flags, so these settings do not apply to it.

## How discovery works

- The agent searches the web for postings that match your profile and returns structured results. It is told to spend about 10 minutes, prefer employer and ATS (applicant tracking system) pages, read a company's public Greenhouse or Lever job list instead of opening single postings when it can, confirm each posting at most once, and return up to 30 jobs, stopping at about 10 strong matches. Fewer is fine; it is told not to pad the list. A run that exceeds the run timeout in Settings (default 20 minutes) is stopped and saves nothing.
- For each job the agent also says whether it matches your locations, remote preference and seniority. The Jobs screen shows this in the Fit column (✓ matches, ✗ does not match, ? not stated). It never hides a job.
- On Claude Code, discovery runs load only the tools allowed for discovery and skip your MCP servers unless one of those tools is an MCP tool. Loading every MCP server can add hundreds of thousands of tokens to each run. They also stop when Claude Code's own cost estimate reaches the spend cap in Settings → Runs (default $5 per agent; empty means no cap). A stopped agent returns no jobs, so treat the cap as a safety net. On Codex, discovery uses live web search.

## Max-effort search

- "Max-effort search" on the Jobs screen runs five searches by source instead of one: Greenhouse, Lever, Ashby, other ATS and careers pages, and remote and niche job boards. Up to three run at a time, and each gets the full run timeout. The app merges the results, removes duplicates and checks every link as usual.
- It uses several times the tokens of a normal search and can use up your Claude Code or Codex plan's limits. A dialog says so, with the time limit, the spend cap (Claude Code only) and what your last Max-effort search used, and nothing starts until you confirm. The app cannot see your bill, so it shows no cost estimate up front.
- If some searches fail, the jobs from the others are kept and the run summary says how many failed. The run fails only when all five fail.
- The Run page shows what each discovery run used, as the agent reported it: Claude Code's estimated cost (at list price, not your bill) and tokens, or Codex's tokens. A search that times out or is cancelled reports nothing, so the real use can be higher.
- The app then checks every link itself (it does not trust the agent) and shows a badge on each job:
  - **Verified**: the page loaded.
  - **Redirected**: the link led somewhere else; the final address is stored.
  - **Could not verify**: the check failed or timed out (network error, site blocking automated requests). The job is kept.
  - **Dead link**: the page is gone, or the link is Greenhouse's "posting closed" page (the company's job board with `error=true`). These jobs are hidden by default.
- Clicking Save or Mark applied twice on a job never creates a duplicate application.
- Duplicates are skipped across runs of the same profile: jobs are matched by canonical URL, or by company, title and location when there is no usable URL.

## How Gmail sync works

- A sync run asks your agent to search your mailbox for messages about the jobs you applied to.
- Results appear as proposals, for example "move this application to interview". Nothing changes until you accept a proposal; you can also reject it.
- Each proposal shows its evidence (sender, date, subject, snippet) and a link to the message so you can verify it.
- Sync can run on demand from a profile, or on a schedule (Settings). Scheduled sync only runs while the app is running, once per profile with open applications.

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
- The agent runs with the permission mode and tool allow-list shown in Settings (read-only sandbox by default; Gmail tools limited to search and read). On Claude Code the app also loads only your user-level Claude settings and blocks subagents; on Codex it turns subagents off.
- The app never applies to jobs, sends mail, or modifies labels or messages.

## Data and logs

- Data lives in `~/.job-applications-tracker/`:
  - `data.db`: profiles, jobs, applications, proposals, settings.
  - `runs/`: one log per run, plus a folder per run with the prompt, schema and agent output files.
- Purge run logs from Settings. This deletes the run logs and the per-run prompt and output files of every run that is not queued or running.
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

- Windows: agent CLIs installed by npm are resolved through their `.cmd` shims and started as `node <cli.js>`; this path is covered by tests with simulated shims only and has not been exercised on a real Windows machine.
- On POSIX a timeout or abort kills the agent's whole process group; on Windows the process tree is killed with `taskkill /T`. A helper that ignores SIGTERM is only force-killed if the agent itself is still running when the 5 s escalation fires.
- A custom command cannot read Gmail unless that agent has a Gmail tool.

## Interface

- Light, dark, or follow your system: pick it from the theme menu at the bottom of the sidebar. The choice is remembered in this browser for the port the app runs on; a different port starts from the system setting again.
- Purging run logs, dismissing a job and cancelling a run ask for confirmation first.
- The run log shows what the agent is doing in plain words (web searches, pages opened, Gmail reads, errors, a finish summary). Tick "Show raw output" to see everything the agent printed, exactly as saved.
- Desktop browsers only. The interface needs Chrome or Edge 111+, Safari 16.4+, or Firefox 128+.

## Development

```sh
npm install
npm test
npm run build
npm run dev:ui      # Vite dev server; proxies the API to port 4173
node bin/jobtrack.js --no-open --data-dir .tmp/dev
npm run sandbox     # build, then run the app on a throwaway data dir (.tmp/sandbox)
```

`npm run sandbox` never touches your real data in `~/.job-applications-tracker`. Delete `.tmp/sandbox` to start fresh. Extra flags go after `--`, for example `npm run sandbox -- --no-open --port 5000`.

The UI is built with [shadcn/ui](https://ui.shadcn.com). Component sources live in `src/ui/components/ui/` and are owned by this repo. Add one with:

```sh
npx shadcn@latest add <component>
```

The CLI adds a stray `cn` package and a `cn` placeholder import; see `AGENTS.md` for the fix-up steps.

## License

MIT. See `LICENSE`.
