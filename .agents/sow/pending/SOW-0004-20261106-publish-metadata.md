# SOW-0004 - npm publish metadata and license

## Status

Status: open

Sub-state: awaiting user decision (final review of SOW-0001, item 8).

## Requirements

### Purpose

`package.json` has no `license`, `description`, `repository` or `keywords`, and there is no `LICENSE` file. The Setup page links to the npm package page for the Gmail guide, so publishing is the intended path; an unlicensed package is unusable by careful users.

### User Request

Not yet requested. Needed from the user: the license (for example MIT or Apache-2.0) and confirmation of the repository URL (`https://github.com/kapantzak/job-applications-tracker` is the current origin).

### Acceptance Criteria

- `LICENSE` file and `license` field agree.
- `description`, `repository`, `keywords` filled; `npm pack` tarball contains `LICENSE` and `README.md`.
- Real smoke run of `discover_jobs` and `sync_mail` with Claude Code and Codex recorded in this SOW before `npm publish` (design section 10 asks for one manual smoke test per preset; none is recorded yet).

## Pre-Implementation Gate

Status: needs-user-decision

Open decisions: license choice; whether to publish from this repository.
