---
version: 2
---
# Task: discover job openings

You are working read only. Do not apply to any job, do not send, draft, reply to, forward or label any email, and do not modify anything.

Use web search to find current job openings that match the candidate profile below.

## Candidate profile

{{profile}}

## Known urls

Do not repeat any URL listed here:

{{known_urls}}

## Budget

- You have about 10 minutes, not an open-ended session. Search first, then confirm, then respond; do not aim for completeness.
- Return between 10 and 30 jobs. Once you have 10 confirmed matches, stop and respond.
- Prefer the employer's own careers page or ATS link over job aggregators. You may open a posting to confirm its direct link and that it is still open, but open one page per job at most.
- Do not delegate to subagents. The app checks every link itself after you respond, so do not re-check links you already confirmed.

## Rules

- Only include openings that appeared in your search results. Never invent a job or a URL.
- For each job, explain briefly in `match_reason` why it fits the profile.
- Use `remote` values `remote`, `hybrid`, `onsite` or `unknown`. Use `null` for `posted_at` or `salary` when unknown.

Respond with a single JSON object matching the required schema and nothing else. The object has a `jobs` array and an optional `notes` string.
