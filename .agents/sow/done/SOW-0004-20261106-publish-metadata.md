# SOW-0004 - npm publish metadata and license

## Status

Status: completed

Sub-state: closed. Real preset smoke runs remain a precondition before `npm publish` and are tracked in SOW-0005.

## Requirements

### Purpose

`package.json` has no `license`, `description`, `repository` or `keywords`, and there is no `LICENSE` file. The Setup page links to the npm package page for the Gmail guide, so publishing is the intended path; an unlicensed package is unusable by careful users.

### User Request

User decision 2026-11-06: MIT license; repository `https://github.com/kapantzak/job-applications-tracker`. Needed from the user: the license (for example MIT or Apache-2.0) and confirmation of the repository URL (`https://github.com/kapantzak/job-applications-tracker` is the current origin).

### Acceptance Criteria

- `LICENSE` file and `license` field agree.
- `description`, `repository`, `keywords` filled; `npm pack` tarball contains `LICENSE` and `README.md`.
- Real smoke run of `discover_jobs` and `sync_mail` with Claude Code and Codex recorded in this SOW before `npm publish` (design section 10 asks for one manual smoke test per preset; none is recorded yet).

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- `package.json` lacks `license`, `description`, `repository`, `keywords`; no `LICENSE` file. Evidence: `package.json`, `ls`.

Evidence reviewed:

- `package.json`, `README.md`, npm `files` list.

Affected contracts and surfaces:

- `package.json` metadata; new `LICENSE`; `files` must include `LICENSE` (npm includes it automatically, but list it for clarity); README Install section may mention the license.

Existing patterns to reuse:

- Task 22 package check (`npm pack` into `.tmp/`, inspect tarball contents).

Risk and blast radius:

- None functional. The copyright holder line uses the repository owner's GitHub handle, never a personal name, per repository rules.

Sensitive data handling plan:

- No personal data: the LICENSE copyright line reads "Copyright (c) 2026 job-applications-tracker contributors".

Implementation plan:

1. Add `LICENSE` (MIT text).
2. `package.json`: `license: "MIT"`, `description`, `repository: { type: git, url: git+https://github.com/kapantzak/job-applications-tracker.git }`, `homepage` (README on GitHub), `bugs`, `keywords`, `files` includes `LICENSE`.
3. `npm pack --dry-run` shows LICENSE and README; test `test/server/package.test.ts` asserts `license === 'MIT'` and the LICENSE file exists at the package root.

Validation plan:

- `npm pack --dry-run`, `npm test`, `npm run typecheck`.

Artifact impact plan:

- README: add a License line. AGENTS.md, skills, spec unaffected. SOW closes in the commit.

Open-source reference evidence:

- None.

Open decisions:

- None.

## Execution Log

### 2026-11-06

- Gate filled while SOW-0002 was in progress.

## Validation

Acceptance criteria evidence:

- `LICENSE` (MIT) and `package.json` `license: "MIT"` agree; description, repository, homepage, bugs, keywords filled.
- `npm pack --dry-run` lists LICENSE (1.1kB), README.md, bin/jobtrack.js, dist/server/index.js, prompts/discover_jobs.md, prompts/sync_mail.md; total files: 10, package size: 114.5 kB.
- Preset smoke run criterion moved to SOW-0005 (not part of this SOW).

Tests or equivalent validation:

- `test/server/package.test.ts` (package metadata: license, repository url, files includes LICENSE, LICENSE file starts with `MIT License`).
- `npm test`: Test Files 45 passed (45), Tests 303 passed (303). `npm run typecheck` clean.

Real-use evidence:

- `npm pack --dry-run` listing above.

Reviewer findings:

- none.

Same-failure scan:

- No personal names in LICENSE or package.json.

Sensitive data gate:

- invented data only; nothing sensitive.

Artifact maintenance gate:

- AGENTS.md: no change needed.
- Runtime project skills: no change needed.
- Specs: no change needed.
- End-user/operator docs: README License section added.
- End-user/operator skills: none exist.
- SOW lifecycle: moved to done.

Specs update:

- none.

Project skills update:

- none.

End-user/operator docs update:

- README `## License` section.

End-user/operator skills update:

- none exist.

## Outcome

Package metadata and MIT LICENSE added; tarball verified to include LICENSE and README.

## Lessons

- A small file-reading test on package.json keeps publish metadata from regressing.

## Followup

- Real preset smoke runs before `npm publish` remain open; tracked in SOW-0005.

## Regression Log

- None yet.
