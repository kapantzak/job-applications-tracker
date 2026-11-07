# SOW-0023 - Create a profile from an uploaded CV

## Status

Status: completed

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: delivered 2026-11-07 on branch `upload-cv`; committed with this file's move to `done/`; PR opened at the user's request.

## Requirements

### Purpose

Make a profile fast to create: the user drops their CV, the agent reads it, and the user gets a filled profile form to review instead of typing every field. The CV stays with the profile so the user can see, download or remove it. Tracks GitHub issue #12 ("Upload CV": AI analyses the CV and creates an initial profile the user can edit; the file type is detected automatically). Replacing a CV on an existing profile is SOW-0024 (decision 15.B).

### User Request

"When user wants to create a profile, show 2 options, either upload (or drop) a CV file (.pdf, word, whatever else is easy for AI to analyse), or fill the profile form manually. Show a beautiful graphic or something and make the CV option the prominent one. After uploading the CV, show a button that when clicked, starts analysing the CV. When user clicks it, we should show a progress bar and a message saying that we analyse the CV with AI and the profile will be ready soon."

Decisions given on 2026-11-07: "1.A, 2.A, 3.A, 4.A, 5.A, 6.B, 7.A, 8.A, 9.A, 10.A", then "11.B, 12.B, 13.A, 14.A", then "15.B, 16.A, 17.A, 18.B, 19.A, 20.A, 21.yes".

Clarification given on 2026-11-07: "each 'Job search' runs for the current profile ONLY".

### Assistant Understanding

Facts:

- Both entry points that create a profile render the same `CreateProfileForm` (`src/ui/pages/ProfilesPage.tsx:33`): the first-run screen (`:131`) and New profile (`:51`).
- Every run row needs a profile: `profile_id TEXT NOT NULL REFERENCES profiles (id)` and `kind IN ('discover_jobs','sync_mail')` (`src/server/db/migrations.ts:242-243`). A CV analysis happens before the profile exists.
- One queue serves all profiles, one run at a time (`src/server/runs/queue.ts:194`); a Max discovery can hold it for 10+ minutes.
- Request bodies must be JSON (`src/server/api/errors.ts:31`), to rule out cross-site form posts.
- Model/effort selection exists only for `discover` and `sync` (`src/server/agents/presets.ts:21-22`); the adapter factory is keyed by `RunKind` (`AppDeps.adapterFactory` in `src/server/app.ts`).
- Discovery already works on the run's profile only: the handler loads `ctx.run.profile_id` and passes only that profile's fields and known URLs (`src/server/services/discovery.ts:126-132`). Every profile field, including Notes, reaches the discovery prompt (`src/server/services/discovery.ts:94-104`).
- The design document lists "Resume or cover-letter generation" as a non-goal (`docs/superpowers/specs/2026-11-05-job-applications-tracker-design.md:31`). Reading a CV to pre-fill a profile is not generation; this SOW records it as a scope addition to v1.
- No `progress` component exists under `src/ui/components/ui/`.
- Candidate extraction libraries (npm, checked 2026-11-07): `unpdf` 2.1.0, MIT, no dependencies, 3.2 MB unpacked (pdf.js serverless build); `mammoth` 1.13.0, BSD-2-Clause, 1.7 MB unpacked, 8 dependencies. `pdf-parse` (21 MB, pulls `@napi-rs/canvas`) and `pdfjs-dist` (37.6 MB) were rejected on size.
- tsup externalises `dependencies`, so both libraries are installed at runtime from `dependencies`, like `hono` today (`tsup.config.ts`).
- `logStore.purge` deletes every directory under `runs/` whose name is a safe id and not an active run (`src/server/runs/log-store.ts:58`), so CV files must not live under `runs/`.
- Codex receives the prompt as an argv element today (`promptVia: 'argv'`, `src/server/agents/presets.ts`). `codex exec --help` (0.163.0) states that with `-` as the prompt, instructions are read from stdin. A CV-sized prompt in argv risks Linux's 128 KiB per-argument limit and Windows' 32,767-character command line.

Inferences:

- The agent CLIs report no progress percentage, so any determinate bar would be invented (basis of decision 5).

Unknowns:

- None that block implementation.

### Acceptance Criteria

- On the first-run screen and on New profile, the user sees two choices; the CV choice is the larger, highlighted card with a themed illustration; the manual choice opens today's empty form. Verified by UI tests and a manual check in light and dark theme.
- The CV card accepts a dropped or chosen PDF, DOCX, TXT or MD file up to 10 MB; the type is detected from the file's content, not its name; anything else gets a clear message. Verified by server and UI tests with invented fixture files.
- After a file is chosen, an "Analyse CV" button starts the analysis; while it runs, an indeterminate progress bar, the message that the CV is being analysed with AI and the profile will be ready soon, an elapsed-time counter and a Cancel button are shown. Verified by UI tests.
- On success the profile form opens pre-filled: roles, locations, remote, seniority, keywords, a suggested name when it passes the name rule, and a 2-3 sentence experience summary in Notes; excluded companies stay empty. Nothing is saved until the user clicks Create profile. Verified by UI and API tests.
- A PDF without a text layer is refused before any agent starts. An agent failure or a timeout (5 minutes) shows the analysis as failed with a specific message, Analyse again and Discard; Cancel and Discard delete the analysis and its files. No profile is created in any of these cases. Verified by tests with the fake agent.
- The analysis starts immediately even while a discovery run is in progress. Verified by an API test with a running fake-agent run.
- The analysis survives leaving the page and server restarts (decisions A2, A3): a card on the Profiles screen, the first-run screen and New profile shows it as analysing, ready or interrupted; an analysis that was running when the server stopped is shown as interrupted with Analyse again and Discard and is never restarted automatically; only one analysis exists at a time. Verified by API, repository and UI tests, and by a restart in the real-use check.
- Seniority in the profile form is a set of toggle chips (Intern, Junior, Mid-level, Senior, Staff, Principal, Lead, Manager, Director, Executive) plus an Other text box, saved in the existing text field as `Senior, Staff`; an existing free-text value that is not on the list appears in Other and is saved back unchanged. Verified by UI tests.
- Create profile keeps the original file and its extracted text with the new profile only; the Profile page shows the CV's file name and date with Download and Remove CV (with confirmation); deleting the profile deletes the CV, and the delete dialog says so. Verified by API and UI tests and on disk in the real-use check.
- Discovery stays scoped to its own profile; the CV text is not sent to discovery. Verified by the existing discovery tests and an unchanged discovery prompt version.
- `npm test`, `npm run typecheck` and `npm run build` pass; a real Claude Code analysis of an invented CV returns a valid draft through the built app.

## Analysis

Sources checked:

- GitHub issue #12 (no comments).
- `src/ui/pages/ProfilesPage.tsx`, `src/ui/pages/ProfilePage.tsx`, `src/ui/components/ProfileForm.tsx`.
- `src/server/api/profiles.ts`, `runs.ts`, `errors.ts`, `guard.ts`; `src/server/app.ts`.
- `src/server/agents/cli-adapter.ts`, `presets.ts`, `types.ts`; `src/server/tasks/prompts.ts`, `schemas.ts`; `prompts/discover_jobs.md`; `src/server/services/discovery.ts`.
- `src/server/runs/queue.ts`, `log-store.ts`; `src/server/db/migrations.ts`; `src/server/config/paths.ts`; `tsup.config.ts`.
- `codex exec --help` (codex-cli 0.163.0); `claude --version` (2.1.319).
- `.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md` (no overlap: no CV, resume or upload items).
- `.agents/sow/specs/product-v1.md`; design document non-goals.

Current state:

- Profiles are created only by typing into `ProfileForm`; there is no upload route and no non-JSON body anywhere in the API.

Risks:

- The agent may misread a CV (for example the seniority). Mitigated by decision 4.A: the user reviews every field before saving.
- The Notes summary (decision 18.B) reaches every discovery prompt of that profile; its effect on result quality is unmeasured. The user can edit or clear it before saving.
- New runtime dependencies (`unpdf`, `mammoth` and its 8 dependencies) grow the install and the supply-chain surface.
- A CV analysis can run while a discovery agent runs (decision 3.A): two agents at once for a short time.
- The CV and its text are personal data kept on disk (decisions 6.B, 12.B); README must say where and how to remove them.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Profile creation has a single manual path. The building blocks for an agent-driven path exist (adapter, prompt templates, strict output schemas), but the run system assumes an existing profile and a shared queue, the API accepts only JSON, and no profile owns a file, so the CV path needs its own short-lived job, an upload route, a task preset and per-profile file storage.

Evidence reviewed:

- See Analysis. No open-source mirrors were consulted.

Affected contracts and surfaces:

- New API (one analysis at a time, decision 24, so a singular resource): `GET /api/cv-analysis` (the analysis or `null`), `POST /api/cv-analysis` (raw bytes, starts one; 409 when one exists), `POST /api/cv-analysis/retry` (failed or interrupted only), `DELETE /api/cv-analysis` (cancels a running agent and deletes the analysis and its files; used by Cancel and Discard). `POST /api/profiles` accepts an optional `cv_analysis_id`; `GET /api/profiles/:pid/cv` (download) and `DELETE /api/profiles/:pid/cv`; profile responses gain `cv: { file_name, added_at } | null`.
- Database: migration 6 adds `cv_file_name`, `cv_file_type` and `cv_added_at` (nullable) to `profiles` (add-column, no rebuild) and creates `cv_analyses` (status `running|succeeded|failed|interrupted`, file name and type, timestamps, draft JSON, error, adapter id, reported model).
- Agent: task kind `analyse_cv` for the presets (Claude: `--tools ""`, `--strict-mcp-config`, no `--allowedTools`; Codex: read-only sandbox, no web search, prompt on stdin via `-`; custom: the user's command, prompt via file), prompt `prompts/analyse_cv.md` v1, output schema in `src/server/tasks/schemas.ts`. Discovery and sync argv stay byte-identical.
- Server: text extraction module, CV analysis service (start, retry, discard, consume on Create profile), start-up marks running analyses interrupted and sweeps CV folders without a database row, shutdown aborts an in-flight analysis, profile delete removes the CV folder.
- UI: create-profile chooser with illustration, CV drop zone, analysis status card (analysing / ready / failed / interrupted) on the Profiles screen, first-run screen and New profile, pre-filled `ProfileForm`; seniority toggle chips with Other in `ProfileForm` (every profile); Profile page CV section (name, date, Download, Remove CV); profile delete dialog text; new shadcn `progress` component.
- Domain: shared seniority list and split/join helpers used by the UI, the draft normaliser and the prompt.
- Data directory: `<dataDir>/cv-analyses/<id>/` (the upload, its text and the agent's `work/` folder, deleted when the agent ends), `<dataDir>/profiles/<profile-id>/` (kept CV and text).
- Docs: README, spec `product-v1.md`, skills `project-agent-adapter`, `project-local-api`, `project-testing` (new fixtures).

Existing patterns to reuse:

- `createCliAdapter().run()` with its never-reject contract, abort signal and process-group kill.
- `renderPrompt()` with `version:` front matter; `toAgentSchema()` strict schema shape.
- `requireUsableAdapter()` 422 pattern from `src/server/api/runs.ts`.
- `HttpError` mapping; the request guard covers the new state-changing routes because they live under `/api`.
- `ProfileForm` with an `initial` value; `EMPTY_PROFILE`; shadcn `Card`, `Button`, `Empty`, `Alert`, `AlertDialog`.
- Migration runner in `src/server/db/migrations.ts` and its test pattern.
- Fake agent fixture `test/fixtures/fake-agent.mjs` and the API harness.

Risk and blast radius:

- Adapter factory signature widens from `RunKind` to a task kind; every call site and test double changes type. Existing preset tests pin discovery and sync argv.
- A raw-bytes route is the first non-JSON body: it must still refuse cross-site writes (Origin guard applies; `application/octet-stream` is not a CORS-safelisted type, so browsers preflight it).
- Body size must be capped while reading (10 MB) to avoid memory exhaustion.
- Profile responses gain a `cv` field; `toProfileInput` and the strict `ProfileBody` must keep it out of PUT bodies. UI and API test fixtures that build `Profile` literals gain `cv: null`.
- The seniority chips change the form for every profile; a stored free-text value must survive a load-and-save unchanged.
- Create profile with a CV moves files and writes rows: files are moved first and moved back if the database write fails, and start-up sweeps any folder without a row.
- Shutdown must kill a running CV analysis agent, as it does for runs.

Sensitive data handling plan:

- Tests and docs use an invented CV (invented name, `example.com` address, invented employers such as Acme). No real CV text, run log or prompt file is copied into any durable artifact.
- Agent working files (`prompt.md` holds the CV text) are deleted when the analysis ends.
- The server log never prints CV text; errors name the failure class only.

Implementation plan:

1. Server: text extraction (`unpdf`, `mammoth`, plain text) with content sniffing, size cap, minimum-text check and prompt text cap; tests with invented fixtures.
2. Agent: task kind `analyse_cv`, preset branches, prompt v1, output schema; fake-agent tests; real Claude and Codex schema probes.
3. Server: `cv_analyses` table and repository, analysis service (start, retry, discard, interrupt at start-up, sweep, shutdown) and routes; API tests including guard, size and type limits.
4. Server: profile CV storage (migration, create with `cv_analysis_id`, download, remove, delete with profile); tests.
5. UI: shadcn `progress`, seniority chips, chooser with illustration, drop zone, analysis status card, pre-filled form, Profile page CV section, delete dialog text; client functions and UI tests.
6. Docs, spec, skills; full validation; real-use check; independent review.

Validation plan:

- `npm test`, `npm run typecheck`, `npm run build`.
- Real Claude Code run on an invented CV through the built app (`npm run sandbox`), plus schema probes for `claude -p --json-schema` and `codex exec --output-schema` with a trivial prompt.
- Manual check of the chooser, drop, progress, pre-filled form and CV section in light and dark theme.
- Independent review of the implementation.
- Same-failure scans: `grep -rn "shell: true\|exec(" src/server`; `grep -rn "0.0.0.0" src bin`; `grep -rn "c.req.json()" src/server` outside `readJson`.

Artifact impact plan:

- AGENTS.md: likely no change; add a note only if a new project-wide rule appears.
- Runtime project skills: `project-agent-adapter` (task kind, prompt, preset flags, codex stdin); `project-local-api` (first raw-bytes route, size cap, new global and profile routes); `project-testing` (CV fixtures).
- Specs: `product-v1.md` gains a "Create a profile from a CV" section.
- End-user/operator docs: README (feature, supported files, what is stored where, how to remove it).
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: in `current/` since 2026-11-07; closes in one commit with the work; SOW-0024 starts after this one closes.

Open-source reference evidence:

- None: the work uses this repository's own code, two npm packages' published metadata and the installed CLIs' help output.

Open decisions:

- All resolved 2026-11-07: decisions 1-29 and A1-A10 (A2, A3, A9 as overridden by the user).

## Implications And Decisions

1. How the CV content reaches the agent: **A** - the server extracts the text and puts it in the prompt. Recommendation was A.
2. File types: **A** - PDF, DOCX, TXT, MD; detected from content; `.doc`, ODT, RTF and images refused with a message. Recommendation was A.
3. How the analysis runs: **A** - its own short-lived job outside the run queue, polled by the UI, cancellable, held in memory. Recommendation was A.
4. After the analysis: **A** - the profile form opens pre-filled; nothing is saved until Create profile. Recommendation was A.
5. Progress bar: **A** - indeterminate animated bar, the analysing message, elapsed time and Cancel. Recommendation was A.
6. What stays on disk: **B** - keep the CV in the data folder. Recommendation was A; the user chose B.
7. Model, effort, timeout: **A** - the agent's own default model and effort, fixed 5-minute timeout, no new settings. Recommendation was A.
8. Graphic: **A** - a custom inline SVG illustration using theme colours; CV card prominent, manual card quieter; on both the first-run screen and New profile. Recommendation was A.
9. Upload transport: **A** - raw bytes as `application/octet-stream`, file name in a header, 10 MB limit. Recommendation was A.
10. Profile name: **A** - the agent suggests a name; it is dropped when it fails the profile-name rule. Recommendation was A.
11. What keeping the CV enables: **B** - the CV stays with the profile it created, the Profile page shows it with Download, and "Replace CV" re-analyses a new CV and suggests changes. Recommendation was A; the user chose B. Replace CV is delivered in SOW-0024 (decision 15).
12. What is kept: **B** - the original file plus the extracted text; the agent's working files are deleted when the analysis ends. Recommendation was A; the user chose B.
13. CV that never becomes a profile: **A** - discarded; kept only on Create profile; leftovers deleted on cancel and swept at server start. Recommendation was A.
14. Profile delete: **A** - the CV is deleted with the profile and the confirmation text mentions it. Recommendation was A.
15. Packaging: **B** - two SOWs in sequence: this one (create from CV, keep CV, show/download/remove) and SOW-0024 (Replace CV and Add CV with the review screen). Recommendation was B.
16. Review screen for suggested changes: **A** - side-by-side list of differing fields with Keep current / Use suggested, Apply into the form, Save to persist. SOW-0024. Recommendation was A.
17. Fields a re-analysis may change: **A** - target roles, locations, remote, seniority, keywords; never name, excluded companies or notes. SOW-0024. Recommendation was A.
18. Notes on creation: **B** - the agent writes a 2-3 sentence experience summary into Notes, which the user reviews before saving. Recommendation was A (uncertain); the user chose B. This SOW.
19. When a new CV replaces the old: **A** - only when the user applies and saves. SOW-0024. Recommendation was A.
20. Profiles without a CV: **A** - "Add CV" runs the same flow and fills only empty fields, listed for review. SOW-0024. Recommendation was A.
21. Remove CV: **yes** - a Remove CV button with confirmation on the Profile page. This SOW.
22. Constraint (user clarification): each job search runs for the current profile only. Already true (`src/server/services/discovery.ts:126-132`); this SOW must keep it so: the kept CV belongs to one profile and its text is not sent to discovery.

Assistant implementation calls. User reply 2026-11-07: "All proposed except: A2: CV analysis results should be persisted in database and survive restarts. A3: finish in the background. A9: Seniority should provide options (and maybe an alternative to add free text)". So A1, A4-A8 and A10 are confirmed; A2, A3 and A9 are replaced by the user's versions below, with follow-up decisions 23-29. Decision 13.A's "swept at server start" now applies only to files without a database row. Original proposals, for the record:

- A1. One CV analysis at a time across the app; starting a second answers 409 "A CV analysis is already running".
- A2. A finished analysis is kept in memory for 30 minutes, then discarded with its files.
- A3. Leaving the page while an analysis runs cancels it.
- A4. The extracted text sent to the agent is capped at 50,000 characters; a file with fewer than 100 non-space characters is refused as "no readable text" (scanned PDF).
- A5. Codex gets the CV prompt on stdin (`-`), not argv, because of OS argument-size limits. Discovery and sync keep argv.
- A6. Claude runs the analysis with no built-in tools and no MCP servers (`--tools ""`, `--strict-mcp-config`); Codex with the read-only sandbox and no web search.
- A7. Storage: `<dataDir>/profiles/<profile-id>/cv.<pdf|docx|txt|md>` and `cv.txt`; the database records only the original file name and the date added.
- A8. Download serves the file as an attachment under its original name.
- A9. The seniority suggestion uses free text like the existing field (for example "Senior"); remote is one of the four existing values, `any` when the CV does not say.
- A10. Locations come from where the candidate lives or has said they want to work; past job locations are not listed.

User overrides:

- A2 (user): CV analysis results are persisted in the database and survive restarts.
- A3 (user): leaving the page does not cancel; the analysis finishes in the background.
- A9 (user): seniority offers predefined options, possibly with a free-text alternative. This changes the profile form for every profile, not only CV-created ones.

Follow-up decisions (user reply 2026-11-07: "23.A, 24.A, 25.A, 26.A, 27.A, 29.A"):

23. Finding a background analysis: **A** - a card on the Profiles screen, the first-run screen and New profile showing the analysis as analysing (Cancel), ready (Review & create, Discard) or interrupted (Analyse again, Discard). Recommendation was A.
24. How many unfinished analyses: **A** - one; it stays until Create profile or Discard; uploading another CV asks to discard the current one first. Recommendation was A.
25. Retention of an unused analysis: **A** - until Create profile or Discard; no automatic deletion. Recommendation was A.
26. Analysis running when the server stops: **A** - shown as interrupted, with Analyse again (reuses the kept file) and Discard; never restarted automatically. Recommendation was A.
27. Seniority options: **A** - Intern, Junior, Mid-level, Senior, Staff, Principal, Lead, Manager, Director, Executive. Recommendation was A.
28. One or several seniority choices: **A** - several, as toggle chips plus an Other text box; saved as `Senior, Staff` (user reply "28.A", 2026-11-07). Recommendation was A.
29. Seniority storage: **A** - the existing text column, choices joined as `Senior, Staff`; values not in the list show in Other; discovery prompt text and version unchanged. Recommendation was A.

## Plan

See Pre-Implementation Gate, Implementation plan.

## Execution Log

### 2026-11-07

- SOW created; decisions 1-10 recorded.
- Decisions 11-14 recorded.
- Decisions 15-21 and the profile-scope clarification recorded; scope split into this SOW and SOW-0024.
- A1-A10 answered (A2, A3, A9 overridden by the user); follow-up decisions 23-29 recorded; gate set to ready; moved to `current/`.
- Dependency correction (no design change): `unpdf` 2.x declares `engines.node >=24`, but the app supports Node 22 and CI tests it, so `unpdf@^1.9.1` is used (engines `>=22`, no dependencies, 2.2 MB, released 2026-10-19). Extraction checked on Node 22.14.0 and 24.11.1. `mammoth@^1.13.0` as planned.
- File names under a CV folder are `cv.<type>` and `cv-text.txt` (not `cv.txt` as A7 said), because a `.txt` CV would otherwise share the text file's name.
- Server: `src/server/cv/{extract,draft,service}.ts`, `src/server/db/cv-analyses-repo.ts`, migration 6, `src/server/api/{cv-analysis,agent-check}.ts` (the adapter check moved out of `runs.ts` to be shared), profile CV routes in `profiles.ts`, error mapping, bootstrap and shutdown in `index.ts`; `AgentTaskKind` and `cvAdapterConfig()` in the agent layer; prompt `prompts/analyse_cv.md` v1; schema `AnalyseCvOutput`.
- UI: `CreateProfileFlow`, `CvUploadCard`, `CvAnalysisCard`, `CvIllustration`, `ProfileCvCard`, `SeniorityInput`, `use-cv-analysis` hook, shadcn `progress` (source from `npx shadcn@4.23.0 view progress`, import fixed, marked indeterminate change), keyframes in `styles.css`; `ProfilesPage`, `ProfilePage`, `ProfileForm`, client calls.
- The Analyse CV button appears only once a file is chosen ("After uploading the CV, show a button").
- User request after the first review: "choose a file" in the drop zone is now always underlined so it reads as a call to action (`CvUploadCard.tsx`); checked in the built app.
- The real-agent probe script wrote its working folders to the repository root by mistake; they held only the invented CV and were moved to `.tmp/probe/` before any commit.

## Validation

Acceptance criteria evidence:

- Two choices with the CV prominent, illustration, light and dark: `test/ui/CreateProfileFlow.test.tsx` ("offers the CV as the recommended choice ..."), manual check in the built app (first-run screen in light theme, New profile and Profiles screen in dark theme).
- Types from content, 10 MB, messages: `test/server/cv/extract.test.ts` (16), `test/server/api/cv-analysis.test.ts` ("refuses a file larger than 10 MB", "refuses an unsupported file type and a scanned PDF ..."), curl against the built app (scanned PDF 422, fake zip 415).
- Analyse button only after a file, progress bar, message, elapsed time, Cancel: `CreateProfileFlow.test.tsx` ("shows the chosen file, then starts the analysis ...", "cancels a running analysis only after confirmation").
- Pre-filled form, nothing saved before Create profile, notes summary, excluded companies empty: `CreateProfileFlow.test.tsx` ("polls a running analysis and opens the review ...", "creates the reviewed profile with the analysis ..."), `test/server/cv/draft.test.ts`; real run below.
- Failure, timeout, retry, cancel, discard leave no profile or files: `cv-analysis.test.ts` failure/retry/discard tests.
- Starts while a discovery run is running: `cv-analysis.test.ts` ("starts at once while a discovery run of a profile is running").
- Background and restart: `cv-analysis.test.ts` ("after a restart ..." with a fresh service over the same database and folder; "refuses to start an agent once shutdown has begun ..."); built app: page reload kept the ready analysis; stopping the app mid-analysis left no `claude -p` process and the row `running`; the next start showed it `interrupted`; Analyse again finished.
- Seniority chips and round-trip of free text: `test/ui/SeniorityInput.test.tsx`, `test/server/domain/seniority.test.ts`.
- CV kept, download, remove, deleted with the profile, delete dialog: `cv-analysis.test.ts` ("profiles with a CV"), `test/ui/ProfilePage.test.tsx`, `test/ui/ProfilesPage.test.tsx`; built app: files under `profiles/<id>/`, download byte-identical with the expected headers.
- Discovery stays per profile and gets no CV text: discovery code unchanged; `prompts/discover_jobs.md` still v4 (`test/server/tasks/prompts.test.ts`).

Tests or equivalent validation:

- `npm run typecheck`: exit 0.
- `npm test`: "Test Files 61 passed (61)", "Tests 739 passed (739)", no stderr output, no act warnings.
- `npm run build`: built. Vite's ">500 kB chunk" warning predates this change (the committed version builds to 510.06 kB; now 528 kB, +5 kB gzip).
- Mutation checks: disabling profile-folder removal fails "deleting the profile deletes its CV"; removing the poll generation guard fails "keeps a cancelled analysis gone when an older poll answers late".
- Packaging: `npm pack` includes `prompts/analyse_cv.md`; the tarball installed in an empty folder ran and extracted text through its own `unpdf` dependency.

Real-use evidence:

- Real agents on an invented CV (2026-11-07): Claude Code 2.1.319 with the CV preset returned a valid draft in 7.3 s (about $0.05, 4,740 input tokens); codex-cli 0.163.0 in 13.5 s, and again in 11.9 s with `-c web_search="disabled"`.
- Built app (`node bin/jobtrack.js --data-dir .tmp/sandbox-cv`) in Chrome: upload by file picker, Analyse CV, progress card, ready card after about 10 s, review form pre-filled (name, four roles, Lisbon/Portugal/Europe, Remote, Senior and Staff chips, keywords, notes summary), Create profile, Profile page with the CV; DOCX upload interrupted by stopping the app and finished after Analyse again; Discard through its confirmation removed every file.

Reviewer findings:

- Independent reviewer (subagent, read-only), 10 findings, all handled:
  1. Medium: Codex kept its default cached web search, against A6. Fixed: `-c web_search="disabled"`, pinned in `cli-adapter.test.ts`, probed on 0.163.0. The reviewer also noted that the read-only sandbox lets Codex run read commands; that is what A6 approved, and the README now says it.
  2. Medium-low: shutdown during text extraction or a late retry could spawn an orphaned agent. Fixed: `stopped` flag checked in `start()` (before and after extraction) and `retry()`; test added.
  3. Low-medium: stale UI after a change in another tab (409 on upload, 404/409 on Discard/retry/create). Fixed: the cards re-read the analysis on those errors; tests added.
  4. Low: an older poll could bring back a cancelled analysis. Fixed: a generation counter in `use-cv-analysis`; test added and mutation-checked.
  5. Low: a failed move halfway could strand the upload. Fixed: files are checked first (409) and anything already moved goes back; test added.
  6. Low: a start-up clean-up error could stop the app from starting. Fixed: errors are logged and the folder left.
  7. Low: pdf.js memory and a zip-bomb .docx. pdf.js: fixed with `loadingTask.destroy()` (the proxy's typed `destroy()` does not exist at runtime). Zip bomb: rejected; the user uploads their own CV to a loopback-only app with a 10 MB limit, so there is no attacker in that path.
  8. Low: status changes were not announced. Fixed: a persistent `role="status"` region; test added.
  9. Low: a password-protected .docx got the ".doc" message. Fixed: the message names both.
  10. Low: the restart test reused one service instance. Fixed: a fresh service over the same database and folder.

Same-failure scan:

- `grep -rn "shell: true\|exec(" src/server`: no matches.
- `grep -rn "0.0.0.0" src bin`: no matches.
- `grep -rn "c.req.json()" src/server`: only inside `readJson`; the CV route reads `arrayBuffer()` after its own content-type check.
- Every other agent task kind keeps its argv (pinned by `cli-adapter.test.ts`, "leaves the discovery and sync presets as they were").

Sensitive data gate:

- Only invented data in tests, docs and this SOW (Alex Example, `alex@example.com`, Acme, Globex, Initech). CV fixtures are built in memory; no binary document (and so no author metadata) is committed. Probe outputs and the sandbox data stay under the ignored `.tmp/`.

Artifact maintenance gate:

- AGENTS.md: the marked local change in `src/ui/components/ui/progress.tsx` added to the shadcn note.
- Runtime project skills: `project-agent-adapter` (task kind, preset flags, probes, shutdown rule, pdf.js release), `project-local-api` (raw-bytes route rules, error mapping, global routes, shutdown order), `project-testing` (harness data folder and `agentRun`, in-memory CV fixtures, `getCvAnalysis` mock).
- Specs: `.agents/sow/specs/product-v1.md`: new "Profiles from a CV" section plus runtime, guard, delete, task-kind and UI-route updates.
- End-user/operator docs: README: first run, new "Creating a profile from your CV" section, seniority, profile delete, data folders, privacy note, confirmations.
- End-user/operator skills: none exist (AGENTS.md lists "Output/reference skills: none").
- SOW lifecycle: `Status: completed`, moved to `done/` in the same commit as the work (user asked to open the PR on 2026-11-07); SOW-0024 waits in `pending/`.

Specs update:

- Updated; see the artifact gate.

Project skills update:

- Updated; see the artifact gate.

End-user/operator docs update:

- README updated; see the artifact gate.

End-user/operator skills update:

- None exist.

Lessons:

- Check `engines` of a new dependency against the project's Node range before installing: `unpdf` 2.x needs Node 24.
- A type declaration is not proof a method exists at runtime (`PDFDocumentProxy.destroy`); tests caught it.
- Run probe scripts with explicit working folders under `.tmp/`; a relative working folder wrote probe files to the repository root.

Follow-up mapping:

- Replace CV / Add CV with the review screen: tracked in `.agents/sow/pending/SOW-0024-20261107-replace-cv-review.md`.
- Zip-bomb guard for .docx: rejected with evidence above (reviewer item 7).
- The Vite chunk-size warning: predates this work; not part of this SOW.

## Outcome

Delivered: profiles can be created from an uploaded CV (PDF, DOCX, TXT, MD) analysed by the user's agent outside the run queue, persisted across restarts, reviewed in a pre-filled form, and kept with the profile (download, remove, deleted with the profile); seniority is a set of chips plus Other text. Replace CV / Add CV continues in SOW-0024.

## Lessons Extracted

See Validation, Lessons. The `unpdf` and pdf.js facts are recorded in `project-agent-adapter`; the probe working-folder slip needs no skill change beyond that note.

## Followup

- Replace CV / Add CV with the review screen: `.agents/sow/pending/SOW-0024-20261107-replace-cv-review.md`.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
