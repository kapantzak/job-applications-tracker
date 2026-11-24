# Job Applications Tracker

A local app that finds job postings matching your profile, checks that the links work, and tracks your applications. It can also read your mailbox through your AI agent and propose status changes. Everything runs on your machine; data is stored in a local SQLite file.

Website: [jobtrack.kapantzakis.gr](https://jobtrack.kapantzakis.gr/)

https://github.com/user-attachments/assets/1750319f-7f78-470a-b759-9b4666c60c10

<details>
<summary>Video not playing? Open it here</summary>

[![Demo video: from a CV to a job search and Gmail sync](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/video/demo-poster.png)](https://github.com/user-attachments/assets/1750319f-7f78-470a-b759-9b4666c60c10)

</details>

A walk-through of about a minute and a half, with captions and no sound: create a profile from a CV, find jobs, mark one applied, sync Gmail and accept what it found, then see the Dashboard's Journey graph a few weeks and 42 applications later. It uses invented data and a stand-in agent.

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

When a newer version is published, the app tells you: a notice at the top of every page (close it and it stays closed until the next version), a line in Help & about, and one line in the terminal. To update, run `npm i -g job-applications-tracker@latest` (or start it with `npx job-applications-tracker@latest`), then restart the app and reload any app tab still open from before. Your data folder and settings are kept.

## First run

1. Data folder: the first time you start `jobtrack` in a terminal, it asks where to keep your data. Press Enter for the default (see [Choosing the data directory](#choosing-the-data-directory)).
2. Agent: the app uses Claude Code unless you pick another agent CLI (Codex, or a custom command). When the chosen agent is not installed, the app opens Setup, where you pick one; Setup and Settings → Agent check that it is installed and, for Claude Code and Codex, whether it is signed in. With Claude Code installed, the app skips Setup; change the agent later in Settings → Agent.
3. Profile: the app opens on your profiles. With none yet, it offers two ways to create one: start from your CV (see below), or fill in the form by hand with a name, target roles, locations, remote preference, seniority, keywords, companies to exclude, notes, and where Gmail sync should look.
4. Find jobs: open the profile and start a job search from its Dashboard or Jobs screen, then follow its progress.

Not sure what a field asks for? Click the ⓘ next to it. Every screen also says what it is for under its title.

## Tour

The screenshots use the invented data of `npm run sandbox:mock`.

**Profiles.** One profile per job search, each with its own jobs, applications and runs.

![Profiles screen with five profile cards](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/images/profiles.png)

**Dashboard.** How a profile's applications are doing: counts that link to the applications behind them, the Journey graph of how far they get and where they stopped, and what needs your attention. The same filters as the Applications table narrow it to some applications, for example one company.

![Dashboard with the application filters, status tiles and the Journey graph of applications from Applied to Offer](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/images/dashboard.png)

**Jobs.** Openings your agent found, with each link checked by the app and a Fit column for location, remote and seniority. The "Found in" filter shows what one search found.

![Jobs table with verification badges and fit checks](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/images/jobs.png)

**Applications.** Everything you applied to, with its status. Sync from Gmail proposes changes and finds applications you have not added yet; you can also change a status yourself. When one application shows up twice under different job titles, tick both rows and merge them; Gmail sync keeps matching mail under either name.

![Applications table with a status per row](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/images/applications.png)

**Review.** New applications and status changes found in your mail, with the evidence. Nothing changes until you accept.

![Review screen with proposals showing sender, date, subject and snippet](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/images/review.png)

**Profile.** What you are looking for. The ⓘ next to each field explains what it asks for and how the app uses it.

![Profile form with the help for Target roles open](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/images/profile-help.png)

**Run.** One job search, Gmail sync or import: what happened, in plain words, and the result.

![Run page with run details and a readable log](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/images/run.png)

**Settings.** The agent and app settings, shared by all profiles, each with its own help.

![Settings Runs and Server sections with the Sync interval help open](https://raw.githubusercontent.com/kapantzak/job-applications-tracker/main/docs/images/settings.png)

## Profiles

- Keep one profile per search, for example "Platform roles" and "Data roles". Each profile has its own jobs, applications, proposals and runs; the agent and app settings are shared.
- Profile names use letters, numbers and single spaces (any alphabet), up to 80 characters, and two profiles cannot share a name. Each profile gets a short address from its name, for example `/profiles/platform-roles`; renaming a profile changes it, so old bookmarks to that profile stop working.
- Inside a profile, the top left shows its name; click it to go back to all profiles.
- The start screen lists every profile with how many jobs, applications and runs it holds. Open one to work inside it.
- The same job posting can show up in more than one profile.
- Gmail sync runs per profile: it looks for replies to that profile's open applications and for applications you have not added to it yet. A scheduled sync runs once for each profile that has open applications or a Gmail label or search. To keep two profiles' replies apart, give each one a Gmail label or search (see [How Gmail sync works](#how-gmail-sync-works)).
- Open applications are the ones sync still checks for replies: applied, screening, interview, no response, and offers from the last 30 days. The Dashboard's In progress count is applied, screening and interview only.
- Deleting a profile (Delete on its card, then confirm) removes the profile with its CV, its CV analysis and all its jobs, applications, proposals, status history and run logs. It cannot be undone. While one of its runs is queued or running, cancel the run first.
- Seniority is a set of levels you can toggle (Intern, Junior, Mid-level, Senior, Staff, Principal, Lead, Manager, Director, Executive), plus an Other box for anything else. It is saved as text such as `Senior, Staff`; a value typed before this existed shows up in Other unchanged.
- Upgrading from a version with a single profile keeps your data: the existing profile becomes your first profile, named after its first target role (characters other than letters, numbers and spaces are replaced by spaces).

## Creating a profile from your CV

- On the first-run screen and on New profile, drop your CV on the "Start from your CV" card or choose the file, then click Analyse CV.
- Supported files: PDF, Word (.docx), .txt and .md, up to 10 MB. The app reads the type from the file itself, not its name; only a text file's name decides between Markdown (`.md`, `.markdown`) and plain text. Text files must be UTF-8. Older Word files (.doc), password-protected Office files, OpenDocument, RTF and images are refused with a message.
- The app reads the text out of the file itself and sends only that text to your agent, which uses its own default model and effort. A file with fewer than 100 characters of text (not counting spaces) is refused, and only the first 50,000 characters are sent. Claude Code gets no tools for this task (no web search, no files, no MCP connectors). Codex runs with web search off and its read-only sandbox, so it can still read files on your computer if it decides to; a custom command runs as you configured it. A scanned PDF has no text to read: fill in the form by hand instead.
- While the agent works, a progress bar shows how long it has been running. You can leave the page: the analysis keeps going and its card waits on the Profiles screen, the first-run screen and New profile. It stops after 5 minutes. CV analyses do not wait for job searches or Gmail syncs; they run beside them.
- When it is ready, click Review and create: the profile form opens filled with a suggested name, target roles, locations, remote preference, seniority, keywords and a short summary of your experience in Notes. Excluded companies stay empty. Nothing is saved until you click Create profile.
- One CV analysis for a new profile exists at a time. To analyse another CV, Discard the current one first. Cancel stops a running analysis and deletes the uploaded file.
- If the analysis fails, or the app stops while the agent is running (shown as interrupted after the next start), the card offers Analyse again and Discard. It never restarts on its own.
- The CV stays with the profile you create from it. The Profile screen shows it with Download and Remove CV. Deleting the profile deletes its CV.

## Replacing or adding a CV on a profile

- On the Profile screen, Replace CV (or Add CV when the profile has none) opens the same upload card. Analyse CV runs your agent on the new file, as above.
- Each profile has its own CV analysis, and analyses for different profiles (and for a new profile) run at the same time. A profile can have one at a time: Replace CV comes back once it is saved or discarded. The Profiles screen marks a profile whose analysis is running ("Analysing CV"), ready ("CV changes to review"), failed or interrupted.
- When it is ready, Review changes opens a side panel that compares the suggestions with what is in the form right now, including edits you have not saved:
  - Replace CV lists only the fields that differ. Add CV lists only the fields the profile leaves empty.
  - Only target roles, locations, remote, seniority and keywords are suggested. Name, excluded companies and notes are never changed.
  - A field the CV says nothing about (no locations, no seniority, remote "Any") is never offered, so a suggestion cannot clear a field or loosen your search.
  - Lists that hold the same items in another order or letter case count as the same.
  - Each field offers Keep current or Use suggested; a list that already has items and would gain more also offers Add the new items, which keeps yours and appends the new ones. Replace CV starts every field on Keep current; Add CV starts on Use suggested.
- Apply puts your choices into the form. Nothing is saved until you click Save, which stores the fields and replaces the profile's CV with the new file in one step. If you close the panel or leave the page, the profile and its old CV stay as they were, and the analysis waits on the Profile screen until you save it or discard it.
- Every job search runs for its own profile only. The CV text is not sent to job searches; only the profile fields are, including the Notes summary.

## Cancelling a run

- Runs go one at a time, across all profiles. A Max-effort search runs up to three agents and can take up to about twice the run timeout, and other runs, scheduled Gmail syncs included, wait behind it.
- A queued or running run can be cancelled from its Run page or from the Runs list ("Cancel run", then confirm). The agent is stopped and nothing from that run is saved; the run shows as Stopped with "Cancelled by user".
- Once the agent has finished and the app is checking links and saving results, the run can no longer be cancelled: the Run page shows "Saving results…", and a cancel from the Runs list is refused with a message.
- Stopping the agent can take a few seconds; the Run page shows "Cancelling…" meanwhile.

## Model and effort

- Settings → Agent lets you pick the model and the effort level for Claude Code or Codex, separately for discovery and for Gmail sync. Leave them on "Agent default" to use whatever your Claude Code or Codex configuration sets; the app then passes no flag and cannot tell you which model that is.
- Model suggestions: Claude Code offers `fable`, `opus` and `sonnet` (or type a full model id). Codex lists the models from `codex debug models`; if that fails, type the model id.
- Higher effort (`xhigh`, `max`, Codex `ultra`) makes runs slower and can hit the run timeout. Codex `ultra` delegates work to subagents.
- Each run records what it asked for. The Run page shows it; for Claude Code it also shows the model that actually ran. Neither agent reports the effort it used.
- A custom command carries its own flags, so these settings do not apply to it.

## How discovery works

- The agent searches the web for postings that match your profile and returns structured results. It is told to spend about 10 minutes, prefer employer and ATS (applicant tracking system) pages, read a company's public Greenhouse or Lever job list instead of opening single postings when it can, confirm each posting at most once, and return up to 30 jobs, stopping at about 10 strong matches. Fewer is fine; it is told not to pad the list. It also gets the links of the 200 newest jobs the profile already has, so it does not return them again. A run that exceeds the run timeout in Settings (default 20 minutes) is stopped and saves nothing.
- For each job the agent also says whether it matches your locations, remote preference and seniority. The Jobs screen shows this in the Fit column (✓ matches, ✗ does not match, ? not stated). It never hides a job.
- On Claude Code, discovery runs load only the tools allowed for discovery and skip your MCP servers unless one of those tools is an MCP tool. Loading every MCP server can add hundreds of thousands of tokens to each run. They also stop when Claude Code's own cost estimate reaches the spend cap in Settings → Runs (default $5 per agent; empty means no cap). A stopped agent returns no jobs, so treat the cap as a safety net. On Codex, discovery uses live web search. Gmail sync on Claude Code keeps your MCP servers, because the Gmail connector is one of them, and turns off the built-in tools except the one that loads MCP tools on demand (and any built-in you allow for sync).

## Custom search

- To steer one search, open the arrow next to "Find jobs" and pick "Custom search…". Type what this search should look for, such as a sector, a list of companies or a region (up to 2,000 characters), choose Default or Max effort, and start it. Max effort still asks first.
- Your instructions are added to the usual search prompt, with your profile. The app's own rules still come first: the agent stays read only, keeps to its time and job budget, and the app checks every link as usual. An agent may still follow your words less closely than you meant.
- The instructions apply to that search only. The Run page shows them, and on the Jobs screen the "Found in" filter marks that search "Custom". For something every search should know, use the profile's Notes.

## Import from another agent

You can run the search in any agent you like, such as a chat app or your own Claude Code session, and bring its results into the app.

1. Open the arrow next to "Find jobs" and pick "Import from another agent…".
2. Optionally type instructions for this search, then press "Copy prompt". The prompt is the one the app gives its own agent, with the format the answer must follow. It includes this profile (Notes too) and the links of the 200 newest jobs you already have, so only paste it into a service you are happy to share that with.
3. Paste the prompt into your agent, then paste its whole answer into "Agent answer" and press "Import jobs". Text around the JSON is fine; the app reads the last JSON object in the answer.

The import runs like a search: the app checks every link, skips jobs you already have (they count as seen again) and opens the Run page. On the Jobs screen the "Found in" filter names it "Imported". An answer can hold up to 100 jobs and 1 MB. Agents sometimes invent links; those show up as dead.

An agent that can run shell commands can send its result straight to the app instead. Use the address the app printed when it started (`http://127.0.0.1:4173` unless that port was taken or you chose another) and the profile's id:

```sh
# The profile id, from the slug in the profile's address (/profiles/<slug>/...).
curl -s http://127.0.0.1:4173/api/profiles/by-slug/<slug>

# result.json holds the agent's JSON object: {"jobs": [...], "notes": "..."}
jq '{result: .}' result.json | curl -s -X POST \
  -H 'Content-Type: application/json' --data @- \
  http://127.0.0.1:4173/api/profiles/<profile-id>/runs/import
```

The body is `{"result": {...}}` for a JSON object or `{"reply": "..."}` for a whole answer as text, plus an optional `"custom_prompt"`. The app answers 202 with the run; a second import while one is waiting or running is refused with 409. Other refusals come with a message: 400 for an answer with no JSON object, jobs in the wrong format, no jobs or more than 100, or a body with both or neither of `reply` and `result`; 413 over 1 MB; 415 when the body is not sent as `application/json`.

## Max-effort search

- On the Dashboard and Jobs screens, "Find jobs" is a split button: the arrow picks Default or Max effort, and the button then reads "Find jobs" or "Find jobs with max effort". It starts on Default every time the page loads. Max effort runs five searches by source instead of one: Greenhouse, Lever, Ashby, other ATS and careers pages, and remote and niche job boards. Up to three run at a time, and each gets the full run timeout. The app merges the results, removes duplicates and checks every link as usual.
- It uses several times the tokens of a normal search and can use up your Claude Code or Codex plan's limits. A dialog says so, with the time limit, the spend cap (Claude Code only) and what your last complete Max-effort search used, and nothing starts until you confirm. The app cannot see your bill, so it shows no cost estimate up front.
- If some searches fail, the jobs from the others are kept and the run summary says how many failed. The run fails only when all five fail.
- The Run page shows what each discovery run and Gmail sync used, as the agent reported it: Claude Code's estimated cost (at list price, not your bill) and tokens, or Codex's tokens. A search that times out or is cancelled reports nothing, or for Max effort only what its finished searches used, so the real use can be higher. The Max-effort dialog quotes only your last complete Max-effort search.
- The app then checks every link itself (it does not trust the agent) and shows a badge on each job:
  - **Verified**: the page loaded.
  - **Redirected**: the link led somewhere else; the final address is stored.
  - **Could not verify**: the check timed out, failed with another network error (such as a dropped connection or a certificate problem), the site answered with another error (such as 403 when it blocks automated requests, or 500), or the link redirected more than 5 times. The job is kept.
  - **Dead link**: the page answered 404 or 410, the site's name could not be looked up (which also happens when you are offline) or it refused the connection, or the link is Greenhouse's "posting closed" page (the company's job board with `error=true`). These jobs are hidden by default. A link that cannot be read as an `http` or `https` address is not stored at all and counts as dead in the run summary.
- Clicking Save or Mark applied twice on a job never creates a duplicate application.
- Duplicates are skipped across runs of the same profile: jobs are matched by canonical URL, or by company, title and location when there is no usable URL.
- Each job belongs to the search that first found it. On the Jobs page, the "Found in" filter lists your searches by start time and mode, and "View jobs" on a successful search opens the Jobs page filtered to it. A job a later search finds again shows "Seen again" and the date under its Found date, and takes that search's link check when the site gave a clear answer (it served the page, redirected to one, or said the page is gone); a timeout, a network error or another error keeps the earlier result, so a connection problem never hides a job. A job whose link now redirects elsewhere, often a closed posting sent to the company's job board, is matched to the job you already have and shows Redirected.

## How Gmail sync works

- A sync run asks your agent to search your mailbox for messages about the jobs you applied to.
- Results appear as proposals, for example "move this application to interview". Nothing changes until you accept a proposal; you can also reject it.
- Sync also finds applications you have not added to the app, so it works on a new profile too: application confirmations, and replies, interview invitations, offers or rejections about an application. Job alerts, newsletters and recruiter outreach do not count. Each one appears on the Review page under **New applications**, with the status its latest email shows and the date of its earliest one. Accept adds it (edit it afterwards on its page), Reject drops it for good (sync does not propose that company and role again), and **Accept all new applications** adds the ones on screen after a confirmation. A run proposes at most 500; the next sync finds the rest.
  - With a Gmail label or search, sync looks for new applications in all of that mail. Without one, it looks only at job-board mail (Greenhouse, Lever, and so on) from the last 90 days.
  - An application you already track is not proposed again. Mail about a job you only saved proposes moving that application on (for example Saved → Applied), with the applied date from the mail. If you add or save the application yourself before reviewing, Accept adds nothing twice: a saved one moves on, any other stays as it is.
  - An accepted application keeps the dates from its emails: the applied date of the first one and the last change of the latest one, so an old interview does not look new on the Dashboard.
  - When exactly one job on the Jobs page has the same company and title and no application yet, the new application is linked to it.
- Each proposal shows its evidence (sender, date, subject, snippet) and a link to the message so you can verify it.
- Sync can run on demand from a profile, or on a schedule (Settings → Runs → Sync interval: every hour, 6 hours or 24 hours, or Off). Scheduled sync only runs while the app is running, once per profile with open applications or a Gmail label or search. The first one comes a full interval after the app starts or after any Settings save. Clicking Sync while that profile's sync is already waiting or running opens that run instead of starting another.
- Open applications are the ones sync still checks for replies: applied, screening, interview, no response, and offers from the last 30 days. The Dashboard's In progress count is applied, screening and interview only.
- By default the agent searches for mail from the companies you applied to and from known job-board senders (Greenhouse, Lever, and so on). Profiles share one mailbox, so two profiles that applied to the same company, or through the same job board, can pick up each other's replies. Without a label or search, a profile can also propose another profile's applications as new ones; give each profile its own label or search to keep them apart.
- To tell the agent where a profile's mail is, open the profile and fill in **Gmail sync**:
  - **Gmail label** (the default): the label name as Gmail shows it, for example `Jobs/Frontend`. Gmail has no folders; labels are its folders. Create the label in Gmail and a Gmail filter that applies it to the replies, for example to mail sent to the address you applied with. The app turns the name into the search `label:Jobs-Frontend` (each space or other blank character and each `/` becomes `-`, which is how Gmail matches label names). A label name cannot contain `"`, brackets (`( ) { }`) or invisible characters, and cannot start with `label:`; for those, use a custom search.
  - **Custom Gmail search (advanced)**: any [Gmail search](https://support.google.com/mail/answer/7190), used as typed, for example `label:jobs-frontend OR to:you+frontend@gmail.com`. A plus address (`you+frontend@gmail.com`) is a handy way to tell profiles apart: apply with it, and replies arrive at it.
  - Either way the value is one line of at most 300 characters. Leave it empty to keep the company and job-board search.
- When a profile has a label or search, the agent reads only the mail that matches it, from any sender, including recruiters who write from a personal address. Mail your Gmail filter did not catch is not seen.
- With a label or search, a sync works in two steps, because a Gmail search returns at most 50 conversations and the agent cannot ask for the next page:
  - First the agent lists every conversation in the label, date range by date range, splitting any range that comes back full. The app checks that the ranges leave no gap and asks again for any that do. If some dates still cannot be confirmed, the run's result ends with "some mail may not have been listed".
  - Then the agent reads the conversations in batches of 20, three batches at a time. The app combines what it read into applications and replies. If a batch fails, the others are kept and the result says how many failed.
  - The app remembers which conversations it read. The next sync reads only new ones and ones with new mail, so the first sync of a large label takes longest and costs most, and later ones are quick. The Run page shows what the run cost (Claude Code reports an estimate).
  - Clicking **Sync from Gmail** lists the whole label. A scheduled sync lists only mail from the day before the last complete check (a listing with no gaps whose conversations were all read), which costs much less. Mail dated before that day that you label later is found only by a sync you start yourself. A scheduled sync lists the whole label when there was no complete check yet or the label or search changed. If you click Sync while a scheduled sync is waiting or running, the app opens that run (its log says "Listing mail since …"); click again after it ends to list everything.
- When a label or search matches no mail, the run still succeeds, but its result ends with "the Gmail scope matched no mail": check the label name or the search on the Profile page.
- The Dashboard and the Applications page show what Sync from Gmail searches, under the buttons, with a Change link to the Profile page.
- The app never labels, moves or changes mail; set up the labels and Gmail filters yourself.

## Gmail access for other agents

Sync needs a Gmail tool in your agent.

- **Claude Code**: uses the claude.ai Gmail connector. Connect Gmail in your claude.ai account. The tools the sync run may call are listed in Settings → Permissions under "Allowed tools (sync)"; the default is:
  `mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Gmail__get_message`
- **Codex and custom commands**: configure a Gmail MCP server in that agent yourself. The app cannot do it for you.
- If no Gmail tool is available, the sync run fails with: `Your agent has no Gmail tool. See the setup guide in Settings.`

## Security

- The server binds to `127.0.0.1` only, so other machines cannot reach it.
- There is no authentication, on purpose: it is a single-user local tool.
- Requests must carry a loopback `Host` header, writes (POST, PUT, PATCH, DELETE) with a foreign `Origin` are rejected, and request bodies must be sent as `application/json` (a CV upload as `application/octet-stream`). This stops other websites from using the API through your browser.
- What the agent may do is set in Settings → Permissions, per kind of run:
  - Claude Code: the permission mode (`default`) and the allowed tools (web search and fetch for job searches; for Gmail sync only the search and read tools).
  - Codex: the sandbox (`read-only` by default). Codex gets no tool list, so its Gmail access is whatever its own Gmail MCP server allows; the prompt tells it to only read.
  - A custom command gets none of these: it runs with whatever access you give it.
- On Claude Code the app also loads only your user-level Claude settings, leaves out your personal `CLAUDE.md`, auto-memory and hooks, and blocks subagents. On Codex (tested with codex-cli 0.163.0 or newer) it turns subagents off, but Codex still reads your personal `~/.codex/AGENTS.md`: Codex has no switch for it, and running it from a separate Codex home could leave your normal Codex sign-in on an old token.
- The app never applies to jobs, sends mail, or modifies labels or messages.
- Besides checking job links, the app makes one request of its own: 10 seconds after it starts and then once a day while it runs, it asks the npm registry (`registry.npmjs.org`) for the newest version of this package. The request carries nothing about you or your data; like any request, it shows npm your IP address. Turn it off by unticking Settings → Server → Check for updates, or by setting the `NO_UPDATE_NOTIFIER` environment variable to any value.

## Data and logs

- Data lives in the data directory, `~/.job-applications-tracker/` unless you choose another (see [Choosing the data directory](#choosing-the-data-directory)):
  - `data.db`: profiles, jobs, applications, proposals, settings.
  - `runs/`: one log per run, plus a folder per run with the prompt, schema and agent output files. An import's folder also keeps the pasted answer (`input.json`), and a Max-effort search has a `worker-N/` folder per source search.
  - `profiles/<profile id>/`: the CV kept with a profile (`cv.pdf`, `cv.docx`, `cv.txt` or `cv.md`) and the text read from it (`cv-text.txt`).
  - `cv-analyses/<id>/`: the uploaded CV and its text while an analysis is running or waiting for review, for a new profile or for an existing one. The agent's prompt, which holds the CV text, is deleted as soon as the agent finishes.
- Purge run logs from Settings. This deletes the run logs and the per-run prompt and output files of every run that is not queued or running.
- Run logs can contain agent output, including mail snippets. Do not share them.
- A CV is personal data and stays on your disk. Remove CV on the Profile screen, Discard on an analysis, and deleting a profile each delete the file and its text.

## Choosing the data directory

- The first time you start `jobtrack` in a terminal, it asks where to keep your data. Press Enter for `~/.job-applications-tracker`, or type or drag in another folder (`~`, quotes and escaped spaces work). The folder is created if needed.
- Your answer is saved in `~/.config/job-applications-tracker/config.json` (the same path on macOS, Linux and Windows) and used on every later start. You are not asked again.
- You are not asked when:
  - the start is not in a terminal (a script or CI): the default folder is used and nothing is saved;
  - `--data-dir` or `JOBTRACK_DATA_DIR` is set;
  - you already have data in `~/.job-applications-tracker`;
  - the config file already exists, for example after a `jobtrack config set` or `config unset` before the first start.
- Change it later with the `config` command. Changes apply from the next start:

  ```
  jobtrack config get data-dir           # the folder in use and where it comes from
  jobtrack config set data-dir <path>    # use another folder (created if missing)
  jobtrack config unset data-dir         # go back to ~/.job-applications-tracker
  ```

- Which folder wins: `--data-dir`, then `JOBTRACK_DATA_DIR`, then the config file, then `~/.job-applications-tracker`.
- If the saved folder is missing (deleted, or on a drive that is not connected), the app stops with an error instead of starting empty. Reconnect the drive, or run `config set` or `config unset`.
- To start over with no data, stop the app, delete the data folder and run `jobtrack config unset data-dir`. Deleting the folder alone is not enough once a folder is saved, even the default one.
- Your data is never moved for you. To move it:
  1. Stop the app.
  2. Move the whole folder to its new place, for example `mv ~/.job-applications-tracker ~/Documents/jobs`. Move the folder itself, so the database's `data.db-wal` and `data.db-shm` files go with it.
  3. Run `jobtrack config set data-dir ~/Documents/jobs`.
- Avoid folders synced by iCloud Drive, Dropbox or similar: syncing the database while the app is running can corrupt it.

## Moving to another device

All your data is in the data folder, so moving to another computer means copying that folder.

1. On the old device, stop the app (Ctrl+C in its terminal), so everything is written to disk.
2. Copy the whole data folder. `jobtrack config get data-dir` shows where it is; by default it is `~/.job-applications-tracker`. Copy the folder itself, so `data.db-wal` and `data.db-shm` go with `data.db`.
3. On the new device, install the same version of the app or a newer one (`jobtrack --version` shows it). An older version opens a newer database without a warning and may mishandle it.
4. Put the folder in place before you start the app there:
   - at `~/.job-applications-tracker`, the default: the app finds it and does not ask where to keep data;
   - anywhere else: run `jobtrack config set data-dir <path>`.

   If the app already ran on the new device, stop it first and replace its data folder, or point it at the copy with `config set`.
5. Install your agent CLI on the new device and sign in. Claude Code's Gmail connector belongs to your claude.ai account; for Codex or a custom command, set up its Gmail MCP server again.
6. Start the app and open Settings. The agent choice and custom command (Agent), permissions (Permissions) and port (Server) came with the data; a custom command may point to paths that do not exist on this device.

Keep in mind:

- The database stores file names, not full paths, so the folder works wherever you put it.
- The folder holds your CVs, and run logs can hold mail snippets. Move it over a channel you trust, such as your own drive, and delete copies you no longer need.
- Use the app on one device at a time. Two copies never merge: changes made on the old device after the copy stay there.

## Command line

```
Usage: jobtrack [options]
       jobtrack config <get|set|unset> data-dir [path]

Options:
  --port <n>         Port to listen on (falls back to the next free port)
  --data-dir <path>  Directory for the database and run logs
  --no-open          Do not open the browser
  --help             Show this help
  --version          Show the version

Commands:
  config             Show or change the saved data directory ("jobtrack config --help")
```

- Without `--port`, the app uses the port in Settings → Server (4173 unless you changed it). When the port is taken it tries the next ones, up to 10 in all, then stops with "No free port in range …". `--port 0` lets the system pick any free port.
- `--data-dir` applies to this run only and is not saved. `JOBTRACK_DATA_DIR` sets the data directory too; `--data-dir` takes precedence, and both win over the saved folder. A leading `~` works in both.
- The browser does not open when the `CI` environment variable is set, as on a build server.
- `NO_UPDATE_NOTIFIER`, set to any value, turns off the check for new versions (see [Security](#security)).

## Known limitations

- Windows: agent CLIs installed by npm are resolved through their `.cmd` shims and started as `node <cli.js>`; this path is covered by tests with simulated shims only and has not been exercised on a real Windows machine.
- On POSIX a timeout or abort kills the agent's whole process group; on Windows the process tree is killed with `taskkill /T`. A helper that ignores SIGTERM is only force-killed if the agent itself is still running when the 5 s escalation fires.
- A custom command cannot read Gmail unless that agent has a Gmail tool.

## Interface

- The Dashboard shows In progress, Interviews, Offers, Rejected and To review tiles (each number links to the rows behind it), the Journey graph, and what needs attention: status proposals and new applications waiting on the Review page, and applied, screening or interview applications with no change in 14 days ("Applied 20 days ago, no reply"; five shown, "Show 3 more" for the rest). To review counts both kinds of proposal. Below them: the last successful job search and Gmail sync, and the model and effort that job searches and Gmail sync use. A profile with no applications shows "No applications yet", with a pointer to Jobs and to Sync from Gmail.
- The Dashboard has the Applications search and filters above its tiles. The tiles, the Journey graph and the quiet applications in Needs attention count only the applications the filters keep; To review, waiting proposals, the last runs and the agent do not change. The Dashboard and the Applications page share one set of filters per profile, saved in your browser, so they are still set when you come back. A tile opens Applications with those filters plus its own status, without changing the saved filters.
- Journey is a flow graph where applications move from Applied to Offer, each stage showing its count and its share of the stage before, and those that stop at a stage branch off (waiting, rejected, no response, withdrawn). Every number is written on the graph; hovering a part adds a short tooltip. In windows narrower than about 1280 px the graph keeps its size and scrolls sideways, so its labels stay readable; Tab to it and use the arrow keys to scroll with the keyboard.
- Every form field has an ⓘ button next to its label: click it (or press Enter on it) to see what the field asks for and how the app uses it. Esc or a click elsewhere closes it. Every screen says what it is for under its title.
- Help & about, at the bottom of the sidebar, shows the app version and links to this documentation, the GitHub repository, "Star on GitHub" and "Report an issue" (a new issue on GitHub). The links open in a new tab; the app never contacts GitHub by itself. When a newer version is out, a dot marks the menu and it shows "Update available: <version>", linking to that release's notes.
- Light, dark, or follow your system: pick it from the theme menu at the bottom of the sidebar. The choice is remembered in this browser for the port the app runs on; a different port starts from the system setting again.
- Deleting a profile, purging run logs, dismissing a job, cancelling a run, starting a Max-effort search, accepting all new applications, cancelling or discarding a CV analysis and removing a CV ask for confirmation first.
- A dismissed job is hidden from the Jobs list. Tick "Show dismissed" to see it again, marked Dismissed, and click Restore to bring it back.
- The Jobs, Applications and Runs tables sort by any column: click a header for ascending, again for descending, and a third time for the default newest-first order. A search box and one filter per column sit above each table: tick values (with counts), type text a column must contain, or pick dates on a calendar: each date has a "from" and a "to" filter, and either can be left open, so "Applied from" alone shows everything from that day until today (Jobs by Found date, Applications by Applied date, Runs by Started or Finished date; both days are included, and rows without a date drop out); the Jobs table also filters by Fit (All match, Some not stated, Has a mismatch, No verdict), by Application (Not tracked, or a status) and by the search that found each job ("Found in"); Application and Found in have no column header, so they filter but do not sort. Reset clears search and filters. The view is kept in the page address, so it survives opening an application or run and coming back; the Applications view is also saved in your browser and shared with the Dashboard. The Runs table loads the newest 200 runs.
- The run log shows what the agent is doing in plain words (web searches, pages opened, Gmail reads, errors, a finish summary). Tick "Show raw output" to see everything the agent printed, exactly as saved.
- Desktop browsers only. The interface needs Chrome or Edge 111+, Safari 16.4+, or Firefox 128+.

## Development

```sh
npm install
npm test
npm run build
npm run dev:server  # API server from source on port 4173, restarts on changes; data in .tmp/dev-server
npm run dev:ui      # Vite dev server; proxies the API to port 4173
node bin/jobtrack.js --no-open --data-dir .tmp/dev
npm run sandbox     # build, then run the app on a throwaway data dir (.tmp/sandbox)
npm run sandbox:mock  # build, reseed .tmp/sandbox-mock with mock data, then run the app on it
npm run demo:video  # build, then record docs/video/demo.mp4 and its poster
```

Every pull request and every push to `main` runs `npm run typecheck` and `npm test` on GitHub Actions with Node 22 and the current Node LTS.

`npm run sandbox` never touches your real data in `~/.job-applications-tracker`. Delete `.tmp/sandbox` to start fresh. Extra flags go after `--`, for example `npm run sandbox -- --no-open --port 5000`.

`npm run sandbox:mock` is for trying the UI. It deletes `.tmp/sandbox-mock` and fills it again on every start, so changes made in the UI last until the next start. The data is invented: a profile with a CV, jobs, applications in every status, proposals (two of them new applications from mail, one linked to a job) and past runs, and the Gmail label `Jobs/Frontend`; a sparse profile with a custom Gmail search; an empty one; "Backend Engineering", whose four past searches show search rounds (jobs seen again, one now redirected and one now dead, a custom search, and a latest search with no new jobs); and "Scope Miss", whose label `NoMatch` the mock agent reports as matching no mail, so its Sync shows "the Gmail scope matched no mail". The mock does the same for any label or search containing `nomatch`. The agent is set to a mock command (`scripts/sandbox-mock/mock-agent.mjs`) that returns canned results after a few seconds (Find jobs also returns the profile's newest known link, so a search shows a job seen again, and Sync mail also returns two invented new applications unless they are already tracked), so Find jobs, Sync mail and CV analysis never search the web, read your Gmail or start Claude Code or Codex. The app still checks job links over the network: the mock links point at `example.com`, so without a connection new jobs show up as dead or unverified. Changing the agent in Settings switches the sandbox to your real agent. Do not pass `--data-dir` after `--`: the mock data is always written to `.tmp/sandbox-mock`, and another folder would run the app on that folder's own data and agent instead.

`npm run demo:video` records the README video on a fresh data folder (`.tmp/demo-video/data`) with the mock agent in its `--demo` mode, which writes realistic invented text instead of "Mock …". It installs `playwright-core` under `.tmp/demo-video` (not a project dependency) and the headless Chromium it needs (about 90 MB, in Playwright's usual browser cache; browsers other projects use are left alone), and needs `ffmpeg` and `ffprobe` on your `PATH` and a network connection, because the app checks the mock job links on `example.com`. Captions and the pointer are drawn on the page while recording; the steps and captions live in `scripts/demo-video/record.mjs`. The README plays a copy uploaded to GitHub as an attachment, because GitHub does not play a committed MP4; after re-recording, upload the new file from a comment box on github.com, post the comment (until then the link does not work for visitors), and replace both attachment links at the top of this file.

The UI is built with [shadcn/ui](https://ui.shadcn.com). Component sources live in `src/ui/components/ui/` and are owned by this repo. Add one with:

```sh
npx shadcn@latest add <component>
```

The CLI adds a stray `cn` package and a `cn` placeholder import; see `AGENTS.md` for the fix-up steps.

## License

MIT. See `LICENSE`.
