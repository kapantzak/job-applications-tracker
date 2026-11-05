# Product Contracts: v1 (intended)

Status: intended contracts from the approved design (2026-11-05). To be reconciled with shipped behavior when SOW-0001 closes.

Source of truth for the full design: `docs/superpowers/specs/2026-11-05-job-applications-tracker-design.md`. This spec lists the contracts that other work must not break.

## Runtime

- Package `job-applications-tracker`, binary `jobtrack`, Node >= 22, ESM.
- Server binds `127.0.0.1` only, default port 4173, falls back to the next free port (up to 10 attempts).
- Data directory `~/.job-applications-tracker/` (override `--data-dir`, `JOBTRACK_DATA_DIR`) holding `data.db` and `runs/`.
- No authentication on the local API; documented in README.

## Agent integration

- The app never calls a model. It spawns the user's agent CLI (`claude`, `codex`, or a custom command) without a shell.
- Two task kinds: `discover_jobs`, `sync_mail`. Each has a versioned prompt template and a JSON output schema the agent must satisfy.
- Every prompt states: read only; never apply; never send, draft or label mail.
- `sync_mail` output carries a required `mail_access` boolean. `false` fails the run with "Your agent has no Gmail tool".

## Status pipeline

`saved`, `applied`, `screening`, `interview`, `offer`, `rejected`, `withdrawn`, `no_response`.

- `saved` has no applied date and is excluded from mail sync.
- `no_response` is user-set only.
- Status changes from mail are proposals; nothing changes until the user accepts one. Every change is recorded in `status_history` with source `user` or `proposal`.

## Discovery results

- Every returned URL is canonicalised and verified: `ok`, `redirected`, `dead` (404, 410, DNS failure, connection refused), `unverified` (403, 429, 999, 5xx, timeout, redirect loop).
- `dead` jobs are stored but hidden by default; `unverified` jobs are shown with a badge.
- Dedupe key is the canonical URL, else normalised `company|title|location`.

## Runs

- Statuses `queued`, `running`, `succeeded`, `failed`, `aborted`. One run at a time. One active run per kind.
- Each run keeps a full log under `runs/<id>.log`, streamed to the UI over SSE.
- Runs left `running` by a crash are marked `aborted` with reason "server restarted" on next start.

## Scheduled sync

Optional interval (`off`, `1h`, `6h`, `24h`) that enqueues `sync_mail` while the server runs. No OS scheduler.
