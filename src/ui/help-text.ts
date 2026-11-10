// User-facing help for the ⓘ buttons and the screen intros, kept in one place so the wording stays
// consistent and reviewable (SOW-0038). `code` spans are written with backticks; see InfoTip.

export const FIELD_HELP = {
  profileName:
    'A name for this search, for example "Platform roles". It names the profile in your list and in its address (`/profiles/platform-roles`), so renaming it changes the address. Your agent never sees it.',
  targetRoles:
    'The job titles you want, for example "Platform engineer". Discovery searches for these titles and close variants.',
  locations:
    'Cities, countries or regions you can work in, for example "Berlin" or "European Union". Discovery marks whether each job\'s location matches (Fit column). A remote job open only to other countries does not match. Leave empty to accept any location.',
  remote: 'Remote, hybrid or on-site. Discovery checks each job against it (Fit column). Any accepts all three.',
  seniority:
    "The levels you are aiming for. Discovery checks each job's level against them (Fit column). Pick more than one if you are open to it; use Other for a level the list lacks, such as IC4.",
  keywords:
    'Skills, tools or fields a good match should involve, for example "Kubernetes" or "fintech". Discovery uses them to judge which jobs fit you.',
  excludedCompanies:
    'Companies you never want to see, such as your current employer. Discovery is told to leave them out; the app does not filter them itself, so a rare one may slip through.',
  profileNotes:
    'Anything else the search should know, in your own words: visa needs, a salary floor, industries to avoid. Discovery reads it with the other fields. A profile created from a CV gets a short summary of your experience here.',
  gmailSync:
    "Where sync looks for replies about this profile's applications. Empty: your agent searches mail from the companies you applied to and from job-board senders. A label or search limits sync to that mail, from any sender, which keeps two profiles' replies apart.",
  gmailLabel:
    'The label exactly as Gmail shows it, for example `Jobs/Frontend`. Create the label and a Gmail filter that applies it to replies yourself; the app only reads mail and never labels it.',
  gmailSearch:
    "Any Gmail search, used as typed, for example `label:jobs-frontend OR to:you+frontend@gmail.com`. Sync reads only the mail it finds. Try it in Gmail's search box first.",

  company: "The employer's name. Sync uses it to match replies to this application.",
  role: 'The job title you applied for. Sync uses it to tell two applications at the same company apart.',
  url: 'Link to the job posting. When you add an application, the app takes the sender domain from it (for example `example.com`) so sync can look for mail from that domain. Job-board links such as Greenhouse or Lever give no domain.',
  status:
    'Where this application stands now. Pick Saved for a job you have not applied to yet. Sync checks only open applications: Applied, Screening, Interview, No response, and Offers from the last 30 days.',
  appliedDate:
    'The day you sent the application. When you add an application as Applied without a date, today is used. Sync tells your agent to skip mail older than this date.',
  applicationNotes: 'Your own notes, such as a contact name or the next step. They are never sent to your agent.',
  senderDomains:
    'Email domains this company writes from, for example `example.com`. Without a Gmail label or search on the profile, sync looks for mail from these domains and from job-board senders. Add one when replies come from a domain the app did not guess.',

  findJobs:
    'Starts a discovery run: your agent searches the web for jobs that fit this profile, then the app checks every link. Default runs one agent. Max effort runs five, one per source, uses several times the tokens, and asks before it starts. The arrow also offers Custom search, to add your own instructions to one search, and Import from another agent, to run the search prompt in any agent and paste its answer.',
  customInstructions:
    'Your own words for this search only, such as a sector, a list of companies or a region. They are sent to your agent with your profile, and the Run page keeps them. The app\'s search rules still come first. For something every search should know, use the profile\'s Notes.',
  importInstructions:
    'Optional. Your own words for this search, added to the copied prompt and kept with the import, like a custom search. Leave empty for a normal search.',
  importReply:
    "Paste the agent's whole answer. The app reads the last JSON object in it, so text around it is fine. It checks every link before saving, and jobs you already have are not added twice.",
  showDeadLinks:
    'Jobs whose link was dead when the app checked it after the search (the page was gone or the site did not exist) are hidden. Tick to show them.',
  showDismissed: 'Jobs you dismissed are hidden. Tick to show them again.',
  showRawOutput:
    'Everything the agent printed, exactly as saved, instead of the plain-words log. It can include mail snippets; do not share it.',

  agentAdapter:
    'The agent CLI that runs every job search, Gmail sync and CV analysis. Claude Code and Codex are set up for you; Custom command runs a command you write. The app checks that it is installed and, for Claude Code and Codex, signed in.',
  customCommand:
    "The command and arguments the app runs for each task, without a shell. `{prompt_file}` and `{schema_file}` become the paths of the task's prompt and JSON schema files; `{schema}` puts the schema itself in an argument. The last JSON object the command prints must match the schema.",
  modelAndEffort:
    'Which model the agent uses and how hard it works, set separately for job searches and Gmail sync. Agent default passes nothing, so your own Claude Code or Codex configuration decides.',
  model: "Pick a suggestion or type a model id. Empty uses the agent's default.",
  effort:
    'How much the agent thinks before answering. Higher levels are slower, use more tokens and can hit the run timeout.',
  permissionMode:
    'Claude Code only. Passed to Claude Code as `--permission-mode`. With `default`, a run is refused any tool call that needs approval unless Allowed tools lists it.',
  allowedTools:
    'Claude Code only. The tools a run may use, comma-separated. Job searches need web search and fetch; Gmail sync needs the Gmail tools. Each tool you add gives the agent more access.',
  sandbox: 'Codex only. The Codex sandbox for this kind of run. `read-only` lets Codex read files but not change them.',
  runTimeout:
    "How long one agent may run, in milliseconds (1200000 = 20 minutes). An agent that goes over is stopped and what it found is lost. In a Max-effort search each of the five agents gets this much on its own, and the others' results are kept.",
  syncInterval:
    'How often the app syncs Gmail by itself, once for each profile with open applications. It runs only while the app is running. Off: sync only when you click Sync.',
  spendCap:
    "Applies to Claude Code job searches only. The estimate is Claude Code's own, at list price, so it is not what your plan bills.",
  port: 'The port the app listens on, on this computer only (`127.0.0.1`). If it is taken, the next free port is used. `--port` on the command line overrides it.',
} as const;

export type FieldHelpKey = keyof typeof FIELD_HELP;

export const SCREEN_INTROS = {
  dashboard: "How this profile's applications are doing. Click a number to see the applications behind it.",
  applicationDetail: 'The details sync uses to find replies, and every status change so far.',
  run: 'One job search, Gmail sync or import: its progress, what happened, and the result.',
  manualProfile:
    'Describe the jobs you want. Name and at least one target role are required; the more you fill in, the better discovery can judge a fit.',
  settingsRuns: 'Time limits, scheduled Gmail sync and the Claude spend cap.',
  settingsServer: 'Where the app listens on this computer.',
  runs: 'Every job search, Gmail sync and import, newest first. Open one to see what happened.',
  settings: 'Agent and app settings, shared by all profiles. Each section saves on its own.',
} as const;
