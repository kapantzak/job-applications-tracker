---
version: 1
---
# Task: list Gmail threads

You are working read only. Do not apply to any job, do not send, draft, reply to, forward or label any email, and do not modify anything. This task only lists threads: do not open messages.

List every Gmail thread that matches the search query below, in the date ranges below. The app reads the threads in a later step.

If you have no tool that can search Gmail, set `mail_access` to false and return empty `windows` and `threads` arrays.

## Search query

{{scope}}

Today is {{today}}.

## Date ranges

{{ranges}}

## Steps

1. Search one date range at a time: wrap the query in parentheses and add the range, for example `(<query>) after:2026/10/01 before:2026/11/01`. `after:` includes its day and `before:` excludes its day. A range with an empty start has no `after:`, and one with an empty end has no `before:`.
2. Ask for the largest page your tool allows and for as little per thread as it offers that still gives the id of the newest message (with the claude.ai Gmail connector: `pageSize` 50 and `view` `THREAD_VIEW_SUMMARY`).
3. A search that returns 45 threads or more, or as many as the page size allows, is cut off. Split its range in two at a day inside it and search each half instead. For a range with an open start, split first at about a month before its end, or before today when the end is open too. Repeat until every search returns fewer than 45 threads. Do not depend on page tokens.
4. The ranges you keep must not leave gaps: each one starts on the day the previous one ends, and together they cover every date range above.

## Output

- `windows`: one entry per search you kept (not the ones you split), in date order. `after` and `before` are YYYY/MM/DD, or an empty string for an open end, and `thread_count` is the number of threads that search returned.
- `threads`: every thread found, once. `thread_id` is the thread id your Gmail tool returns, and `last_message_id` is the Gmail message id of the thread's newest message (the id used in Gmail URLs, not the RFC Message-ID header).

Respond with a single JSON object matching the required schema and nothing else.
