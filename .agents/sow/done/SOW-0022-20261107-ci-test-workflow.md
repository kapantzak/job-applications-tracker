# SOW-0022 - CI workflow for the test suite

## Status

Status: completed

Sub-state: delivered 2026-11-07 on branch `Add-CI` (PR #13); both CI jobs passed on the PR; committed with this file's move to `done/`.

## Requirements

### Purpose

Catch regressions automatically: every change to `main` and every pull request runs the test suite on GitHub, without anyone running it locally first.

### User Request

"Please add a CI job that runs the tests suite on each commit." Decisions given on 2026-11-07: "1.B, 2.B, 3.B, 4.A, 5.B", then "5.B confirmed, add Dependabot too, go ahead".

### Assistant Understanding

Facts:

- The repository has no `.github/` directory and no CI of any kind (checked 2026-11-07).
- `npm ci && npm test` passes from a clean install: 55 files, 651 tests, about 8 s on Node 24.11.1; the same on Node 22.14.0 in a clean copy under `.tmp/ci-node22`. `npm run typecheck` exits 0 on both.
- The suite needs no real agent and no network: the design document states "tests run against a fake agent script ... so CI never needs a real agent" (`docs/superpowers/specs/2026-11-05-job-applications-tracker-design.md:240`); network tests bind local servers on `127.0.0.1` (`test/server/verify/links.test.ts`, `test/e2e/discovery-flow.test.ts`).
- `test/server/bin.test.ts:11-13` runs `npm run build` in `beforeAll` (60 s timeout), so `npm test` also covers the build.
- `bin/jobtrack.js` skips opening a browser when `CI` is set (`docs/superpowers/plans/2026-11-05-job-applications-tracker.md:376`); GitHub Actions sets `CI=true`.
- `package.json` declares `"engines": { "node": ">=22" }` and has no `packageManager` field, so `actions/setup-node` caches npm only when `cache: npm` is given (its `action.yml` at the pinned commit, input `package-manager-cache`).
- `better-sqlite3` is a native dependency; it installed from prebuilt binaries on both local Node versions.
- `main` has branch protection with required status checks enabled but an empty check list, so a new workflow does not block merges until a check is added there.
- Latest releases on 2026-11-07: `actions/checkout` v7.0.1 = `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node` v7.1.0 = `949feb2413d6458794dcd2491c4babbbce0c15c1` (both tags are lightweight and point directly at those commits; verified with `gh api repos/<repo>/git/ref/tags/<tag>`).

Inferences:

- "On each commit" in practice means each push / PR update: GitHub Actions runs on the head commit of a push, not on every commit inside it.

Unknowns:

- None that block implementation. Whether the workflow runs green on GitHub-hosted Ubuntu can only be proven by a real run (see Validation).

### Acceptance Criteria

- A workflow runs on every push to `main` and on every pull request. Verified by reading the `on:` block and by a real run on the PR for this branch.
- The workflow runs `npm ci`, `npm run typecheck` and `npm test` on Ubuntu with Node 22 and the current Node LTS. Verified by the job list and logs of the real run.
- Every action is pinned to a full commit SHA with a version comment, and the workflow token is read-only. Verified by reading the file.
- Dependabot opens PRs for new versions of the pinned actions. Verified by the config passing GitHub's schema (the repo's Dependabot status after merge) and by reading the file.

## Analysis

Sources checked:

- `package.json`, `package-lock.json` (lockfileVersion 3), `vitest.config.ts`, `test/server/bin.test.ts`, `test/e2e/discovery-flow.test.ts`, `test/server/agents/cli-adapter.test.ts:151` (one test skipped on win32), `test/server/agents/resolve-command.test.ts`.
- `README.md` "Development" section, `AGENTS.md` "Project-specific commands", `.agents/skills/project-testing/SKILL.md`.
- Design doc and plan under `docs/superpowers/`.
- `actions/setup-node` and `actions/checkout` `action.yml` at the pinned commits (inputs `cache`, `package-manager-cache`, `persist-credentials`).
- GitHub branch protection for `main` via `gh api`.

Current state:

- No automated checks; the suite and typecheck are run by hand before commits.

Risks:

- Runner differences (Linux vs the user's macOS) could surface a platform-specific test failure. Mitigation: the real run on the PR is part of validation; any failure is investigated before close.
- `test/server/bin.test.ts` builds inside `beforeAll` with a 60 s limit; a slow runner could hit it. Local build takes a few seconds, so the margin is large.
- Tag-based action references could run altered code; mitigated by SHA pins (decision 5).

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- There is no CI, so nothing checks a change unless someone runs the suite locally. The suite is hermetic (fake agent, loopback servers, in-memory DB), so it can run on a hosted runner as is.

Evidence reviewed:

- See Analysis "Sources checked". No external open-source mirrors were used; the two GitHub actions were read through the GitHub API at the pinned commits.

Affected contracts and surfaces:

- New: `.github/workflows/ci.yml`, `.github/dependabot.yml`.
- Docs: `README.md` "Development" (one line on CI), `AGENTS.md` "Project-specific commands" (CI line), `.agents/skills/project-testing/SKILL.md` (CI facts).
- No product code, API, schema, UI or prompt changes.

Existing patterns to reuse:

- `npm ci`, `npm run typecheck`, `npm test` exactly as documented in `AGENTS.md`; no CI-only scripts.

Risk and blast radius:

- Limited to repository automation. No runtime behavior changes. Workflow token is `contents: read`; no secrets are used; `persist-credentials: false` keeps the token out of the checked-out git config.

Sensitive data handling plan:

- No secrets or personal data are involved. The workflow uses no secrets. This SOW and the docs cite only public action names, public commit SHAs and repository paths.

Implementation plan:

1. Add `.github/workflows/ci.yml` per decisions 1-5.
2. Add `.github/dependabot.yml` for the `github-actions` ecosystem only.
3. Update `README.md`, `AGENTS.md`, `.agents/skills/project-testing/SKILL.md`.
4. Validate locally (YAML parse, action inputs, suite on both Node majors), then on GitHub through the PR for `Add-CI`.

Validation plan:

- Parse both YAML files; check every `with:` key against the pinned `action.yml`.
- Local `npm ci && npm run typecheck && npm test` on Node 22 and Node 24.
- Real run: open the PR for `Add-CI` and confirm both matrix jobs pass; record run id and summary lines.
- Same-failure search: grep for other unpinned `uses:` lines.

Artifact impact plan:

- AGENTS.md: add a CI line under "Project-specific commands".
- Runtime project skills: `project-testing` gains the CI facts (what CI runs, Node versions, that CI sets `CI=true`).
- Specs: no update; `.agents/sow/specs/product-v1.md` records product behavior, and CI does not change it.
- End-user/operator docs: `README.md` "Development" gets one line saying PRs and `main` run CI.
- End-user/operator skills: none exist (`AGENTS.md` "Output/reference skills: none").
- SOW lifecycle: single SOW; closes as `completed` in `done/` together with the work.

Open-source reference evidence:

- No local mirrors or clones were checked; the only external code involved is the two pinned GitHub actions, read via the GitHub API at the commits recorded above.

Open decisions:

- All resolved; see Implications And Decisions.

## Implications And Decisions

Decided by the user on 2026-11-07:

1. Triggers: **B** - `push` to `main` plus every `pull_request`. No duplicate runs on PR branches; pushes to branches without a PR are not checked.
2. Steps: **B** - `npm ci`, `npm run typecheck`, `npm test`.
3. Node versions: **B** - matrix of `22` (the `engines` floor) and `lts/*` (current LTS, resolves automatically).
4. Operating systems: **A** - `ubuntu-latest` only. macOS/Windows are not part of this SOW.
5. Action references: **B** - full commit SHA pins with a `# vX.Y.Z` comment; workflow `permissions: contents: read`.
6. Dependabot: **added** for the `github-actions` ecosystem so SHA pins get update PRs. The npm ecosystem was not requested and is not included.

Implementation details that follow from those decisions (reported to the user):

- `concurrency` cancels an older run of the same PR when a new commit is pushed; runs on `main` are never cancelled.
- `strategy.fail-fast: false`, so one Node version failing still shows the other's result.
- `timeout-minutes: 15` per job, so a hung test cannot hold a runner for the default 6 hours.
- `actions/checkout` with `persist-credentials: false`.
- `actions/setup-node` with `cache: npm` (keyed on `package-lock.json`).
- Dependabot checks weekly.

## Plan

1. Workflow file and Dependabot config.
2. Docs and skill updates.
3. Local validation; PR; real-run validation; close.

## Execution Log

### 2026-11-07

- Investigation, decisions, SOW created.
- Added `.github/workflows/ci.yml`, `.github/dependabot.yml`; updated `README.md`, `AGENTS.md`, `.agents/skills/project-testing/SKILL.md`.
- Decision 7 (user, 2026-11-07): **A** - commit with this SOW in progress, push `Add-CI`, open the PR; after a green run, amend the same commit to record the run and close this SOW, then push with `--force-with-lease` to `Add-CI` only.
- `actionlint` via its Docker image was blocked by the local permission policy; the real GitHub run replaces it as workflow validation.
- Committed `81cf6ef`, pushed `Add-CI`, opened PR #13. CI run 42400477181 (event `pull_request`, head `81cf6ef`) passed both jobs. This SOW was then closed by amending that commit and pushing with `--force-with-lease`, per decision 7. Run 42400649132 on the amended head `6ff97c1` passed both jobs.
- User request "make the CI jobs required checks on main": `PATCH repos/kapantzak/job-applications-tracker/branches/main/protection/required_status_checks` with `strict: true` (unchanged) and checks `Test (Node 22)`, `Test (Node lts/*)`, both bound to the GitHub Actions app (`app_id` 15368). Read back from the API; all other protection settings unchanged (`enforce_admins` stays false).
- User request "add the note": `AGENTS.md` CI line now states that those job names are required checks and that changing the job `name` or the matrix needs a matching branch-protection update. Folded into the same commit with another `--force-with-lease` push.

## Validation

Acceptance criteria evidence:

- Triggers: `.github/workflows/ci.yml` `on:` has `push: branches: [main]` and `pull_request`; run 42400477181 started from the `pull_request` event of PR #13.
- Steps and matrix: run 42400477181 jobs `Test (Node 22)` (success, 37 s) and `Test (Node lts/*)` (success, 34 s) each ran `npm ci`, `npm run typecheck`, `npm test`. `22` resolved to Node 22.23.4 (npm 10.9.9); `lts/*` resolved to Node 26.13.0.
- Pins and token: both `uses:` lines are 40-hex SHAs with `# vX.Y.Z` comments; SHAs equal the release tags (`gh api repos/actions/checkout/git/ref/tags/v7.0.1`, `repos/actions/setup-node/git/ref/tags/v7.1.0`); `permissions: contents: read`; `persist-credentials: false`.
- Dependabot: `.github/dependabot.yml` parses and uses the `github-actions` ecosystem, `directory: /`, `weekly`. GitHub reads it from the default branch, so its first update check happens only after merge.

Tests or equivalent validation:

- Local, Node 24.11.1: `npm test` exit 0, "Test Files 55 passed (55)", "Tests 651 passed (651)"; `npm run typecheck` exit 0.
- Local clean copy (`git archive HEAD` into `.tmp/ci-node22`, removed afterwards), Node 22.14.0 / npm 10.9.2: `npm ci` OK, "Test Files 55 passed (55)", "Tests 651 passed (651)"; `npm run typecheck` exit 0.
- Both YAML files parse (Ruby `YAML.load_file`). Every `with:` key (`persist-credentials`; `node-version`, `cache`) exists in the pinned `action.yml`.
- `bash .agents/sow/audit.sh`: "SOW initialization complete and clean."

Real-use evidence:

- CI run 42400477181 on PR #13: Node 22 job "Tests 651 passed (651)"; Node 26.13.0 job "Tests 651 passed (651)"; both typecheck steps passed; no `##[warning]` or `##[error]` annotations.
- Cache: the `lts/*` job logged "Cache saved with the key: node-cache-Linux-x64-npm-..."; the Node 22 job logged "Failed to save: Unable to reserve cache ... another job may be creating this cache". Benign: both jobs share one npm cache key, which is correct because the npm download cache does not depend on the Node version.

Reviewer findings:

- No independent reviewer agent was run for this change (a 40-line workflow and a 7-line config). Validation relies on the real CI run and the required code-owner review on PR #13 (branch protection: 1 approving review, code owner review required).

Same-failure scan:

- `grep -rnE 'uses:' .github | grep -vE '@[0-9a-f]{40} # v[0-9]'` returned nothing: no unpinned action references.

Sensitive data gate:

- The workflow uses no secrets. This SOW, `README.md`, `AGENTS.md` and the skill cite only public action names, public commit SHAs, a public run id and repository paths. No personal data, credentials or private endpoints.

Artifact maintenance gate:

- AGENTS.md: updated "Project-specific commands" with the CI line, the "never replace a pin with a tag" rule, and the required-check naming hazard.
- Runtime project skills: updated `.agents/skills/project-testing/SKILL.md` with the CI facts (what runs, Node versions, `CI=true`, Linux, 127.0.0.1-only network, 15-minute timeout, local pass is not CI proof).
- Specs: no update; `.agents/sow/specs/product-v1.md` records product behavior and CI changes none of it.
- End-user/operator docs: updated `README.md` "Development" with one line on CI.
- End-user/operator skills: none exist (`AGENTS.md`: "Output/reference skills: none").
- SOW lifecycle: single SOW; `Status: completed`, moved to `.agents/sow/done/`, committed together with the work in one commit (amended per decision 7).

Specs update:

- None needed; see Artifact maintenance gate.

Project skills update:

- `.agents/skills/project-testing/SKILL.md` (CI bullet under Mandatory Knowledge).

End-user/operator docs update:

- `README.md` "Development".

End-user/operator skills update:

- None exist; nothing to update.

Lessons:

- See Lessons Extracted.

Follow-up mapping:

- Making `Test (Node 22)` and `Test (Node lts/*)` required checks on `main`: implemented on user request (see Execution Log), with the hazard recorded in `AGENTS.md`.
- macOS and Windows runners: rejected by decision 4A.
- Dependabot for npm dependencies: not requested (decision 6 covers actions only); not tracked.
- `actionlint`: rejected as unnecessary; the real CI run validated the workflow.

## Outcome

Every push to `main` and every pull request now runs `npm ci`, `npm run typecheck` and `npm test` on Ubuntu with Node 22 and the current LTS (Node 26.13.0 on 2026-11-07). The first run on PR #13 passed both jobs. Actions are SHA-pinned, the token is read-only, and Dependabot will propose action updates after merge.

## Lessons Extracted

- `lts/*` already resolves to Node 26 while the local dev machine runs Node 24, so CI tests a newer major than local development. Recorded in the `project-testing` skill as "a local pass is not proof of a CI pass".
- With trigger decision 1B, pushing a branch alone runs nothing; real-run evidence needs an open PR. Plan the SOW close (evidence after push) around that.
- Two matrix jobs share the npm cache key; one "Failed to save" line per run is expected and harmless.

## Followup

None. See Follow-up mapping.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
