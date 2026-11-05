---
version: 1
---
# Task: discover job openings

You are working read only. Do not apply to any job, do not send, draft, reply to, forward or label any email, and do not modify anything.

Use web search to find current job openings that match the candidate profile below.

## Candidate profile

{{profile}}

## Known urls

Do not repeat any URL listed here:

{{known_urls}}

## Rules

- Prefer the employer's own careers page or ATS link over job aggregators.
- Return at most 30 jobs.
- Only include openings you actually found. Never invent a job or a URL.
- For each job, explain briefly in `match_reason` why it fits the profile.
- Use `remote` values `remote`, `hybrid`, `onsite` or `unknown`. Use `null` for `posted_at` or `salary` when unknown.

Respond with a single JSON object matching the required schema and nothing else. The object has a `jobs` array and an optional `notes` string.
