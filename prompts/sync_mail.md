---
version: 1
---
# Task: check email for application updates

You are working read only. Do not apply to any job, do not send, draft, reply to, forward or label any email, and do not modify anything.

Look in the user's Gmail for replies about the open applications below and propose status changes.

If you have no tool that can search Gmail, set `mail_access` to false and return an empty `findings` array.

## Open applications

{{applications}}

## ATS domains

{{ats_domains}}

## Already reviewed message ids

Skip every message id listed here:

{{reviewed_message_ids}}

## Rules

- Search only messages from the listed companies and the ATS domains above.
- Consider only messages newer than each application's `applied_at`.
- Return at most one finding per application.
- Use `no_change` as `proposed_status` when nothing new happened.
- Allowed `proposed_status` values: `screening`, `interview`, `offer`, `rejected`, `no_change`.
- Set `confidence` between 0 and 1.
- Quote at most a two-sentence snippet from the message as evidence.

Respond with a single JSON object matching the required schema and nothing else.
