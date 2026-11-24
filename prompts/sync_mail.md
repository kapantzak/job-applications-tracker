---
version: 7
---
# Task: check email for application updates

You are working read only. Do not apply to any job, do not send, draft, reply to, forward or label any email, and do not modify anything.

Look in the user's Gmail for replies about the open applications below and propose status changes. Also look for job applications the user made that are not listed below, and propose them as new applications.

If you have no tool that can search Gmail, set `mail_access` to false and return empty `findings` and `new_applications` arrays.

## Open applications

{{applications}}

## ATS domains

{{ats_domains}}

## Mailbox scope

{{mail_scope}}

## Already reviewed message ids

Skip every message id listed here:

{{reviewed_message_ids}}

## Already tracked

Do not report these as new applications:

{{tracked}}

## Rules

- Search only the messages the mailbox scope above allows.
- A search that returns 45 threads or more, or as many as the page size allows, is cut off: split its date range in two and search each half, until every search returns fewer. Do not depend on page tokens.
- Set `scope_message_count` as the mailbox scope above says.
- Consider only messages newer than each application's `applied_at`.
- Return at most one finding per application.
- Use `no_change` as `proposed_status` when nothing new happened.
- Allowed `proposed_status` values: `screening`, `interview`, `offer`, `rejected`, `no_change`.
- Set `confidence` between 0 and 1.
- Quote at most a two-sentence snippet from the message as evidence.
- `application_id` must be copied exactly from the `id` field of the applications list above.
- An application's `also_known_as` names are the same application under other names: mail about any of them belongs to that application and uses its `id`.
- `evidence.message_id` must be the Gmail message id as returned by your Gmail tool (the id used in Gmail URLs), not the RFC Message-ID header.

## New applications

- Add an entry to `new_applications` for each job application the user made that matches none of the open applications and none of the already tracked ones above (compare company and role).
- Count only mail that shows the user applied: an application confirmation, or a reply, assessment, interview invitation, offer or rejection about that application. Ignore job alerts, newsletters, job recommendations and recruiter outreach about jobs the user did not apply to.
- Return at most one entry per company and role, and at most 500 entries in total.
- `company` is the hiring company, never the job board or the ATS. `role` is the job title as the mail states it.
- `status` is the stage the latest message about that application shows: `applied`, `screening`, `interview`, `offer` or `rejected`.
- `applied_at` is the date of the earliest message about that application, as YYYY-MM-DD.
- `sender_domain` is the hiring company's own email domain when the company wrote from it; otherwise an empty string.
- `evidence` describes the latest message about that application, with the same rules as above.
- Set `confidence` between 0 and 1 and give a short `reason`.

Respond with a single JSON object matching the required schema and nothing else.
