# SOW-0025 - Choose and remember the data directory from the CLI

## Status

Status: completed

Sub-state: delivered; decisions 1-13 implemented and validated.

## Requirements

### Purpose

Let users choose where the app keeps its data, once, and have the app remember that choice, without editing files or passing a flag on every run. GitHub issue #10 ("Data directory").

### User Request

- Issue #10: users should be asked where to store their data, with a default proposed; possibly changeable later.
- 2026-11-08: the data directory is managed only through the CLI. No UI for choosing or moving it.
- The npm install location is out of scope: npm's `prefix` controls it and a package cannot override it.

### Assistant Understanding

Facts:

- Resolution today: `--data-dir`, then `JOBTRACK_DATA_DIR`, then `~/.job-applications-tracker` (`src/server/config/paths.ts:15-20`). Nothing is remembered between runs.
- The bin rejects positionals (`bin/jobtrack.js:17`), so there are no subcommands yet.
- The data directory holds `data.db` (WAL, `src/server/db/connection.ts:9`), `runs/`, `profiles/`, `cv-analyses/` (`src/server/cv/service.ts:84-85`). Paths are rebuilt from `dataDir` plus ids at start, so a moved folder keeps working.
- Settings already shows the data directory read-only from `/api/health` (`src/ui/components/DataSection.tsx:48`, `src/server/api/setup.ts:12`). No UI change is needed.
- The design document lists `config.json` inside the data directory (`docs/superpowers/specs/2026-11-05-job-applications-tracker-design.md:65`); it was never implemented. The pointer file cannot live inside the directory it points to, so this SOW deviates from that line (see decision 4).
- SOW-0005 tracks "Data directory: expand a leading `~`" (`.agents/sow/pending/SOW-0005-20261106-v1-hardening-backlog.md:39`).

Inferences:

- `os.homedir()` reads `HOME` on POSIX, so bin tests can isolate the config file by spawning with a temporary `HOME`.

Unknowns:

- None beyond the open decisions below.

### Acceptance Criteria

- A chosen folder is stored in `~/.config/job-applications-tracker/config.json` and used on later runs without flags (test: bin with temporary `HOME`).
- Precedence is flag, then env, then config file, then default (unit tests in `test/server/config/paths.test.ts`).
- On an interactive terminal with nothing set, the app asks once; Enter accepts the default (test with injected input/output streams).
- Without a terminal and nothing set, the app uses the default without asking (bin test).
- `jobtrack config set data-dir <path>` writes the config file (bin test).
- A leading `~` is expanded in the flag, env, config file and prompt answer (unit tests).
- README "Data and logs" and "Command line" describe the config file, the prompt, the command and the manual move.

## Analysis

Sources checked:

- `src/server/config/paths.ts`, `src/server/index.ts`, `bin/jobtrack.js`, `src/server/cv/service.ts`, `src/server/db/connection.ts`, `src/ui/components/DataSection.tsx`.
- `test/server/config/paths.test.ts`, `test/server/bin.test.ts`, `test/server/index.test.ts`, `test/e2e/discovery-flow.test.ts`.
- `README.md` (Data and logs, Command line, Development), `.agents/sow/specs/product-v1.md:11`, design document lines 65 and 188, SOW-0005.

Current state:

- Every caller of `startApp` in tests passes `dataDir`, so adding a config-file step does not make tests read the real `~/.config`, as long as the flag wins.

Risks:

- A prompt that blocks a non-interactive start (scripts, CI) would hang. Mitigation: prompt only when stdin and stdout are TTYs.
- A stale config (folder deleted, drive unmounted) silently creating an empty folder would look like data loss. Decision 9.
- Tests writing the real `~/.config`. Mitigation: `home` injection in unit tests, temporary `HOME` in bin tests.
- SQLite WAL side files missed in a manual move. Mitigation: the README tells users to stop the app and move the whole folder.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The app has no persisted setting for the data directory, so a non-default location needs the flag or env var on every run. Evidence: `src/server/config/paths.ts:15-20`.

Evidence reviewed:

- Files listed under Analysis. No open-source references were needed: the change uses only Node built-ins (`node:readline`, `node:fs`, `node:os`).

Affected contracts and surfaces:

- CLI: new `config` subcommand, first-run prompt, help text.
- `src/server/config/paths.ts` (resolution, `~` expansion, config read/write).
- `src/server/index.ts` exports used by the bin.
- New file on the user's disk: `~/.config/job-applications-tracker/config.json`.
- README, `.agents/sow/specs/product-v1.md`, `project-local-api` skill (bin/bootstrap knowledge).

Existing patterns to reuse:

- `resolveDataDir({ flag, env, home })` injection style; `parseArgs` in the bin; the bin test harness (`launch`, `waitFor`).

Risk and blast radius:

- Startup path for every user. Existing users with data in the default folder must see no change (decision 7).
- No database or schema change. No API change.

Sensitive data handling plan:

- The config file holds only a folder path. Tests and docs use temporary folders and placeholder paths; no real home paths in durable artifacts.

Implementation plan:

1. `src/server/config/paths.ts`: `expandHome`, `configFilePath`, `readConfig`/`writeConfig` (atomic, unknown keys kept), `locateDataDir` returning `{ dir, source }` with precedence flag, env, config, default; `resolveDataDir` keeps returning the folder; `prepareDataDir` (create, refuse a file or an unwritable folder). Tests first in `test/server/config/paths.test.ts`.
2. `src/server/index.ts`: `startApp` takes `home`, uses `locateDataDir`, refuses a config-file folder that does not exist (decision 9). Test in `test/server/index.test.ts`.
3. `src/server/config/first-run.ts`: `chooseDataDirOnFirstRun` (asks only when interactive, no flag, no env, no config file, and no `data.db` in the default folder; saves every answer including the default; re-asks on an invalid folder) and `createTerminalPrompt` (readline; Ctrl-C and end of input cancel). Tests in `test/server/config/first-run.test.ts`.
4. `src/server/config/cli.ts`: `runConfigCommand` for `config get|set|unset data-dir`. `set` creates the folder, saves the absolute path, warns when the old folder holds `data.db` and when `JOBTRACK_DATA_DIR` overrides the file; `unset` keeps the file with no `dataDir`, so the first-run question is not asked again. Tests in `test/server/config/cli.test.ts`.
5. `bin/jobtrack.js`: dispatch `config ...`, run the first-run step before `startApp`, help text. Tests in `test/server/bin.test.ts` with a temporary `HOME`.
6. README, `product-v1.md`, `project-local-api` skill, SOW-0005 line 39.

Validation plan:

- Unit tests for resolution, expansion, config read/write; bin tests for prompt-less start, `config set`, stale config; `npm test`, `npm run typecheck`; manual run with a temporary `HOME`.

Artifact impact plan:

- AGENTS.md: no workflow change expected; re-check at close.
- Runtime project skills: `project-local-api` lists `bin/jobtrack.js` in scope; add the config file and subcommand.
- Specs: `product-v1.md:11` gains the config file and precedence.
- End-user/operator docs: README "Data and logs", "Command line".
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: mark the `~` part of SOW-0005 line 39 done here; the "close the db if migration fails" part stays in SOW-0005.

Open-source reference evidence:

- None checked; Node built-ins only.

Open decisions:

- None. Decisions 1-11 recorded below.

## Implications And Decisions

Recorded 2026-11-08 from the user's answers:

1. Remember the chosen folder: **A**, a config file outside the data directory. Precedence: flag, env, config file, default.
2. First-run prompt: **C**, both an interactive prompt (TTY only, Enter accepts the default, non-TTY uses the default silently) and a command to set the folder.
3. Moving data: **B**, no move command; document the manual steps (stop the app, move the folder, set the new path).
4. Config file location: **A**, `~/.config/job-applications-tracker/config.json` on every OS. Deviates from design document line 65 (`config.json` inside the data directory), because the pointer cannot live inside the folder it points to.
5. `~` expansion: **A**, included here; the `~` part of SOW-0005 line 39 is closed by this SOW.

6. `config` command: **B**, `get`, `set` and `unset` for `data-dir`. `get` prints the folder and its source.
7. Existing users: **A**, no question when the default folder already holds `data.db`; nothing is written.
8. `config set`: **A**, creates a missing folder, refuses a file or an unwritable folder, saves the absolute path, warns when the old folder holds data that is not moved.
9. Missing configured folder at start: **A**, stop with an error naming the folder and the `config set`/`unset` commands. Flag and env keep creating missing folders.
10. First-run answer: **A**, always saved, including the default. No question and no write when the flag or env is set.
11. `XDG_CONFIG_HOME`: **A**, ignored.

Defaults stated to the user and not objected to: config shape `{ "dataDir": "<absolute path>" }`; a corrupt or invalid file stops the app with an error and is never overwritten; only `~` and `~/...` are expanded; the `config` command takes no options except `--help`.

12. Pasted answers at the first-run question (from review): **A**, trim, strip one pair of matching outer quotes and, except on Windows, turn `\ ` into a space.
13. Deleting a saved folder to start over (from review; consequence of 9A and 10A): **A**, keep decision 9 without exceptions; the README says to run `config unset` after deleting the folder.

Derived from 6B and 10A: the question is asked only when the config file does not exist, so `config unset` writes the file without `dataDir` and the default is used without asking again.

## Plan

See the implementation plan in the gate; chunks run in order, tests first.

## Execution Log

### 2026-11-08

- Drafted SOW; recorded decisions 1-5, then 6-11; gate ready; moved to `current/`.
- Chunks 1-5 implemented tests first: `src/server/config/paths.ts`, `first-run.ts`, `cli.ts`, `src/server/index.ts`, `bin/jobtrack.js`; tests in `test/server/config/{paths,first-run,cli}.test.ts`, `test/server/index.test.ts`, `test/server/bin.test.ts`.
- Docs: README "Data and logs", new "Choosing the data directory", "Command line"; `product-v1.md`; `project-local-api` skill; SOW-0005 line for `~` marked done.
- Independent reviewer (general-purpose subagent, read-only) on the full diff; findings and handling under Validation. Decisions 12-13 taken from two of its findings.
- No deviation from the decided design.

## Validation

Acceptance criteria evidence:

- Config file stored and used without flags: `test/server/bin.test.ts` ("uses the folder saved by "config set data-dir" on the next start"), `test/server/index.test.ts` ("uses the folder from the config file ...").
- Precedence flag, env, config, default: `test/server/config/paths.test.ts` (`locateDataDir` block).
- First-run question on a terminal, Enter takes the default: `test/server/config/first-run.test.ts`; real pseudo-terminal runs below.
- No question and no write without a terminal: `test/server/bin.test.ts` ("uses the default without asking or writing a config file ..."), `first-run.test.ts`.
- `config set data-dir` writes the file: `test/server/config/cli.test.ts`, `bin.test.ts`.
- `~` expanded in flag, env, config file and answer: `paths.test.ts`, `first-run.test.ts`.
- README describes the config file, the question, the command and the manual move: `README.md` "Choosing the data directory".

Tests or equivalent validation:

- `npm run typecheck`: exit 0.
- `npm test`: `Test Files  65 passed (65)`, `Tests  854 passed (854)`; no warnings or `act(...)` messages in the output.
- `grep -rn "0.0.0.0" src bin`: one hit, `src/ui/format.ts:11` (`toFixed(1)` text), not a bind address.

Real-use evidence:

- `npm run build`, then `script -q <log> node bin/jobtrack.js --no-open --port 0` with a temporary `HOME` under `.tmp/`:
  - answer `~/Jobs data`: folder created, config saved, app started there; second start did not ask;
  - Ctrl-C at the question: exit 130, "No data directory chosen.", nothing written;
  - answer `~/My\ Jobs` (drag-style): saved and started in `<home>/My Jobs`; Ctrl-C then shut down with exit 0.
- `config set data-dir ""` from a temporary `HOME` saved the cwd before the fix (reviewer finding 2); after the fix it exits 2 (`cli.test.ts`).
- The real `~/.config/job-applications-tracker` was checked after the suite and the manual runs: it does not exist.

Reviewer findings:

- Independent reviewer (read-only subagent), full diff, including its own pty runs (Enter, Ctrl-C, Ctrl-D, invalid answer):
  1. `product-v1.md:18` said "There is no `config.json`": fixed, reworded.
  2. `config set data-dir ""` saved the cwd: fixed, empty or blank path is a usage error (exit 2), tests added.
  3. Quoted or escaped pasted answers taken literally: user decision 12A, implemented with tests.
  4. `finally` in the bin skipped on `process.exit`: fixed, readline closed explicitly on every path.
  5. Temporary config file left behind on a failed write: fixed, removed on failure, test added.
  6. UTF-8 BOM in a hand-edited config file reported as invalid JSON: rejected; consistent with "broken file is an error, never overwritten", and the app writes the file itself.
  7. Skill text overstated bin test isolation: fixed, reworded.
  8. Deleting a saved default folder now blocks the start: user decision 13A, README line added.
  9. An empty mount point left by an unmounted Linux drive passes the existence check: tracked in SOW-0005 (Server).

Same-failure scan:

- Other places that resolve a user path from an empty value: `grep -n "resolve(" src/server/config/*.ts`; `locateDataDir` already treats empty flag and env as unset, `first-run.ts` maps an empty answer to the default, `cli.ts` now refuses an empty `set` path. No other path input exists.
- Other writers of files outside the data directory: `grep -rn "homedir()" src/server`; hits only in `src/server/config/paths.ts`, `cli.ts` and `first-run.ts`, and the last two only default `home` and write through `writeConfig` in `paths.ts`.

Sensitive data gate:

- Durable artifacts contain only placeholder paths (`/data/a`, `/Users/x/...`, `~/...`) and temporary test folders. No real paths, names, mail or logs. The pty runs' logs stayed under git-ignored `.tmp/` and were deleted.

Artifact maintenance gate:

- AGENTS.md: no update; no workflow, command or guardrail changed (`npm run sandbox` still passes `--data-dir`, so it never reads the config file).
- Runtime project skills: `.agents/skills/project-local-api/SKILL.md` gained the data-directory bullet, evidence files and an update rule.
- Specs: `.agents/sow/specs/product-v1.md` (data directory choice; line 18 reworded).
- End-user/operator docs: `README.md` "Data and logs", "Choosing the data directory", "Command line".
- End-user/operator skills: none exist (AGENTS.md "Output/reference skills: none").
- SOW lifecycle: `Status: completed`, moved to `.agents/sow/done/` in the same commit as the work; SOW-0005 updated (one item part done, one item added).

Specs update:

- `product-v1.md` updated as above.

Project skills update:

- `project-local-api` updated as above. `project-testing` unchanged: the temporary-`HOME` rule is specific to the bin and recorded in `project-local-api`.

End-user/operator docs update:

- README updated as above. The design document line 65 (`config.json` inside the data directory) is left as the historical v1 design; the deviation is recorded in decision 4 and the spec states current behaviour.

End-user/operator skills update:

- None exist.

Lessons:

- A fresh worktree has no `node_modules`; `npm ci` is needed before vitest runs.
- Readline without a `SIGINT` listener pauses on Ctrl-C and leaves the question hanging; the prompt aborts its question on `SIGINT` and on `close`.
- `config set` creates the target folder, so moving data must happen before `config set` (`mv old new` into an existing `new` nests the folder); the README orders the steps that way.

Follow-up mapping:

- Mount-point check (reviewer finding 9): tracked in SOW-0005.
- "Close the db if migration fails before listen" (other half of SOW-0005 line 39): stays tracked in SOW-0005.
- UTF-8 BOM (finding 6): rejected, reason above.
- Windows branches (`~\` expansion, `USERPROFILE`) are untested in CI (Ubuntu only): covered by the existing README "Known limitations" stance on Windows; no new item.

## Outcome

Users choose the data directory once, from the CLI: on the first interactive start or with `jobtrack config set data-dir <path>`. The choice is saved in `~/.config/job-applications-tracker/config.json` and used on every later start; `config get` shows the folder in use and its source, `config unset` returns to the default. A missing saved folder stops the start instead of starting empty. Issue #10 is delivered with the UI part dropped by the user.

## Lessons Extracted

- Recorded in `project-local-api` (data directory resolution, bin command, test isolation, manual pty check). The `node_modules` and readline lessons are under Validation; neither is a repeated project hazard yet.

## Followup

- SOW-0005: mount-point check; close the db if migration fails before listen.

## Regression Log

None yet.
