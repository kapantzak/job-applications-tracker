# SOW-0024 - Replace or add a CV on an existing profile, with a review screen

## Status

Status: open

`completed` is the successful terminal status. `done` is a directory name, not a status value. Do not use `Status: done` or `Status: complete`.

Sub-state: split from SOW-0023 (decision 15.B); starts after SOW-0023 closes. Decisions recorded; gate not yet filled.

## Requirements

### Purpose

Let the user keep a profile current with their CV: upload a newer CV (or a first one for a profile that has none), see what the agent would change, and choose field by field. Second half of GitHub issue #12 as scoped on 2026-11-07.

### User Request

Decisions given on 2026-11-07 during SOW-0023 planning: "11.B" (Replace CV re-analyses and suggests changes to the existing profile), "15.B, 16.A, 17.A, 19.A, 20.A".

### Assistant Understanding

Facts:

- Depends on SOW-0023: CV extraction, the `analyse_cv` agent task, the analysis registry and per-profile CV storage.
- Renaming a profile changes its URL slug (`src/ui/pages/ProfilePage.tsx:23-27`); every profile field reaches the discovery prompt (`src/server/services/discovery.ts:94-104`).

Inferences:

- None yet.

Unknowns:

- To be established when the gate is filled after SOW-0023 closes.

### Acceptance Criteria

- From the Profile page, "Replace CV" (or "Add CV" when the profile has none) runs the same upload, analyse and progress flow as SOW-0023.
- A review screen lists only fields whose suggestion differs from the current value, current and suggested side by side, each with Keep current / Use suggested; Apply copies the choices into the form; Save persists them (decision 16.A).
- Only target roles, locations, remote, seniority and keywords can be suggested; name, excluded companies and notes are never touched (decision 17.A).
- The new CV replaces the old one only when the user applies and saves; Cancel or leaving keeps the old CV (decision 19.A).
- For a profile without a CV, only empty fields are filled, listed for review (decision 20.A).

## Analysis

Pending; filled when this SOW moves to `current/`.

## Pre-Implementation Gate

Status: blocked (on SOW-0023 completion)

Problem / root-cause model:

- Blocked: depends on SOW-0023 code that does not exist yet.

Evidence reviewed:

- SOW-0023 decisions 11, 15-20.

Affected contracts and surfaces:

- To be filled after SOW-0023 closes; expected: analysis start for an existing profile, Profile page, CV storage replace path.

Existing patterns to reuse:

- SOW-0023's analysis registry, upload route and `ProfileForm`.

Risk and blast radius:

- To be filled after SOW-0023 closes.

Sensitive data handling plan:

- Same as SOW-0023: invented CVs only; no real CV text in durable artifacts.

Implementation plan:

1. To be written after SOW-0023 closes.

Validation plan:

- To be written after SOW-0023 closes.

Artifact impact plan:

- AGENTS.md, skills, spec `product-v1.md`, README: to be assessed after SOW-0023 closes.
- SOW lifecycle: starts after SOW-0023 is completed.

Open-source reference evidence:

- None expected.

Open decisions:

- 16, 17, 19, 20 resolved (below). Any further decisions are asked when the gate is filled.

## Implications And Decisions

16. Review screen: **A** - side-by-side list of differing fields with Keep current / Use suggested; Apply into the form; Save to persist.
17. Fields a re-analysis may change: **A** - target roles, locations, remote, seniority, keywords; never name, excluded companies or notes.
19. When a new CV replaces the old: **A** - only when the user applies and saves.
20. Profiles without a CV: **A** - "Add CV" runs the same flow and fills only empty fields, listed for review.

## Plan

Pending.

## Execution Log

### 2026-11-07

- Created as the second half of SOW-0023 (decision 15.B).

## Validation

Pending.

## Outcome

Pending.

## Lessons Extracted

Pending.

## Followup

None yet.

## Regression Log

None yet.

Append regression entries here only after this SOW was completed or closed and later testing or use found broken behavior. Use a dated `## Regression - YYYY-MM-DD` heading at the end of the file. Never prepend regression content above the original SOW narrative.
