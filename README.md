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
2. Profile: the app opens on your profiles. With none yet, it offers two ways to create one: start from your CV (see below), or fill in the form by hand with a name, target roles, locations, remote preference, seniority, keywords and companies to exclude.
3. Find jobs: open the profile and start a discovery run from its Dashboard or Jobs screen, then follow its progress.

## Profiles

- Keep one profile per search, for example "Platform roles" and "Data roles". Each profile has its own jobs, applications, proposals and runs; the agent and app settings are shared.
- Profile names use letters, numbers and single spaces (any alphabet). Each profile gets a short address from its name, for example `/profiles/platform-roles`; renaming a profile changes it, so old bookmarks to that profile stop working.
- Inside a profile, the top left shows its name; click it to go back to all profiles.
- The start screen lists every profile with how many jobs, applications and runs it holds. Open one to work inside it.
- The same job posting can show up in more than one profile.
- Gmail sync runs per profile: it only looks at that profile's open applications. A scheduled sync runs once for each profile that has open applications.
- Deleting a profile (Delete on its card, then confirm) removes the profile with its CV, its CV analysis and all its jobs, applications, proposals, status history and run logs. It cannot be undone. While one of its runs is queued or running, cancel the run first.
- Seniority is a set of levels you can toggle (Intern, Junior, Mid-level, Senior, Staff, Principal, Lead, Manager, Director, Executive), plus an Other box for anything else. It is saved as text such as `Senior, Staff`; a value typed before this existed shows up in Other unchanged.
- Upgrading from a version with a single profile keeps your data: the existing profile becomes your first profile, named after its first target role (characters other than letters, numbers and spaces are replaced by spaces).

## Creating a profile from your CV

- On the first-run screen and on New profile, drop your CV on the "Start from your CV" card or choose the file, then click Analyse CV.
- Supported files: PDF, Word (.docx), .txt and .md, up to 10 MB. The app reads the type from the file itself, not its name. Older Word files (.doc), password-protected Office files, OpenDocument, RTF and images are refused with a message.
- The app reads the text out of the file itself and sends only that text to your agent, which uses its own default model and effort. Claude Code gets no tools for this task (no web search, no files, no MCP connectors). Codex runs with web search off and its read-only sandbox, so it can still read files on your computer if it decides to; a custom command runs as you configured it. A scanned PDF has no text to read: fill in the form by hand instead.
- While the agent works, a progress bar shows how long it has been running. You can leave the page: the analysis keeps going and its card waits on the Profiles screen, the first-run screen and New profile. It stops after 5 minutes.
- When it is ready, click Review and create: the profile form opens filled with a suggested name, target roles, locations, remote preference, seniority, keywords and a short summary of your experience in Notes. Excluded companies stay empty. Nothing is saved until you click Create profile.
- One CV analysis for a new profile exists at a time. To analyse another CV, Discard the current one first. Cancel stops a running analysis and deletes the uploaded file.
- If the app stops while the agent is running, the analysis is shown as interrupted after the next start, with Analyse again and Discard. It never restarts on its own.
- The CV stays with the profile you create from it. The Profile screen shows it with Download and Remove CV. Deleting the profile deletes its CV.

## Replacing or adding a CV on a profile

- On the Profile screen, Replace CV (or Add CV when the profile has none) opens the same upload card. Analyse CV runs your agent on the new file, as above.
- Each profile has its own CV analysis, and analyses for different profiles (and for a new profile) run at the same time. A profile can have one at a time: Replace CV comes back once it is saved or discarded. The Profiles screen marks a profile whose analysis is running, ready or failed.
- When it is ready, Review changes opens a side panel that compares the suggestions with what is in the form right now, including edits you have not saved:
  - Replace CV lists only the fields that differ. Add CV lists only the fields the profile leaves empty.
  - Only target roles, locations, remote, seniority and keywords are suggested. Name, excluded companies and notes are never changed.
  - A field the CV says nothing about (no locations, no seniority, remote "Any") is never offered, so a suggestion cannot clear a field or loosen your search.
  - Lists that hold the same items in another order or letter case count as the same.
  - Each field offers Keep current or Use suggested; lists that would gain items also offer Add the new items, which keeps yours and appends the new ones. Replace CV starts every field on Keep current; Add CV starts on Use suggested.
- Apply puts your choices into the form. Nothing is saved until you click Save, which stores the fields and replaces the profile's CV with the new file in one step. If you close the panel or leave the page, the profile and its old CV stay as they were, and the analysis waits on the Profile screen until you save it or discard it.
- Every job search runs for its own profile only. The CV text is not sent to job searches; only the profile fields are, including the Notes summary.

## Cancelling a run

- Runs go one at a time, across all profiles. A Max-effort search runs up to three agents and can take up to about twice the run timeout, and other runs, scheduled Gmail syncs included, wait behind it.
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

- On the Dashboard and Jobs screens, "Find jobs" is a split button: the arrow picks Default or Max effort, and the button then reads "Find jobs" or "Find jobs with max effort". It starts on Default every time the page loads. Max effort runs five searches by source instead of one: Greenhouse, Lever, Ashby, other ATS and careers pages, and remote and niche job boards. Up to three run at a time, and each gets the full run timeout. The app merges the results, removes duplicates and checks every link as usual.
- It uses several times the tokens of a normal search and can use up your Claude Code or Codex plan's limits. A dialog says so, with the time limit, the spend cap (Claude Code only) and what your last complete Max-effort search used, and nothing starts until you confirm. The app cannot see your bill, so it shows no cost estimate up front.
- If some searches fail, the jobs from the others are kept and the run summary says how many failed. The run fails only when all five fail.
- The Run page shows what each discovery run used, as the agent reported it: Claude Code's estimated cost (at list price, not your bill) and tokens, or Codex's tokens. A search that times out or is cancelled reports nothing, or for Max effort only what its finished searches used, so the real use can be higher. The Max-effort dialog quotes only your last complete Max-effort search.
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
- The agent runs with the permission mode and tool allow-list shown in Settings (read-only sandbox by default; Gmail tools limited to search and read). On Claude Code the app also loads only your user-level Claude settings, leaves out your personal `CLAUDE.md`, auto-memory and hooks, and blocks subagents. On Codex (tested with codex-cli 0.163.0 or newer) it turns subagents off, but Codex still reads your personal `~/.codex/AGENTS.md`: Codex has no switch for it, and running it from a separate Codex home could leave your normal Codex sign-in on an old token.
- The app never applies to jobs, sends mail, or modifies labels or messages.

## Data and logs

- Data lives in `~/.job-applications-tracker/`:
  - `data.db`: profiles, jobs, applications, proposals, settings.
  - `runs/`: one log per run, plus a folder per run with the prompt, schema and agent output files.
  - `profiles/<profile id>/`: the CV kept with a profile (`cv.pdf`, `cv.docx`, `cv.txt` or `cv.md`) and the text read from it (`cv-text.txt`).
  - `cv-analyses/<id>/`: the uploaded CV and its text while an analysis is running or waiting for review, for a new profile or for an existing one. The agent's prompt, which holds the CV text, is deleted as soon as the agent finishes.
- Purge run logs from Settings. This deletes the run logs and the per-run prompt and output files of every run that is not queued or running.
- Run logs can contain agent output, including mail snippets. Do not share them.
- A CV is personal data and stays on your disk. Remove CV on the Profile screen, Discard on an analysis, and deleting a profile each delete the file and its text.

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
- Purging run logs, dismissing a job, cancelling a run, cancelling or discarding a CV analysis and removing a CV ask for confirmation first.
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

Every pull request and every push to `main` runs `npm run typecheck` and `npm test` on GitHub Actions with Node 22 and the current Node LTS.

`npm run sandbox` never touches your real data in `~/.job-applications-tracker`. Delete `.tmp/sandbox` to start fresh. Extra flags go after `--`, for example `npm run sandbox -- --no-open --port 5000`.

The UI is built with [shadcn/ui](https://ui.shadcn.com). Component sources live in `src/ui/components/ui/` and are owned by this repo. Add one with:

```sh
npx shadcn@latest add <component>
```

The CLI adds a stray `cn` package and a `cn` placeholder import; see `AGENTS.md` for the fix-up steps.

## License

MIT. See `LICENSE`.
