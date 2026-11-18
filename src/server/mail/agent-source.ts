import { z } from 'zod';
import type { AgentAdapter } from '../agents/types.js';
import { ATS_DOMAINS } from '../db/applications-repo.js';
import { reportedAgent, requestedAgent, selectionLogLine } from '../runs/agent-record.js';
import { renderPrompt } from '../tasks/prompts.js';
import { NewApplicationFinding, outputJsonSchema, SyncMailOutput, type NewApplicationResult } from '../tasks/schemas.js';
import { MailAccessError, type MailSource, type MailSyncRequest } from './types.js';

function renderApplications(apps: MailSyncRequest['applications']): string {
  if (apps.length === 0) return '(none)';
  return apps
    .map((a) => {
      const domains = a.sender_domains.length ? a.sender_domains.join(', ') : '(none)';
      return `- id: ${a.id} | company: ${a.company} | role: ${a.role} | applied_at: ${a.applied_at} | sender_domains: ${domains}`;
    })
    .join('\n');
}

function renderTracked(tracked: MailSyncRequest['tracked']): string {
  if (tracked.length === 0) return '(none)';
  return tracked.map((t) => `- company: ${t.company} | role: ${t.role}`).join('\n');
}

// The agent's schema is strict, but our parse checks new applications one by one: a custom agent's bad entry
// must not cost the status findings of the same run (S1).
const LenientSyncMailOutput = SyncMailOutput.extend({ new_applications: z.unknown().optional() });

function keepValid(entries: unknown[], log: (line: string) => void): NewApplicationResult[] {
  const kept: NewApplicationResult[] = [];
  entries.forEach((entry, i) => {
    const parsed = NewApplicationFinding.safeParse(entry);
    if (parsed.success) {
      kept.push(parsed.data);
      return;
    }
    const issue = parsed.error.issues[0];
    log(
      `Dropping a new application the agent returned in the wrong shape: new_applications.${[i, ...(issue?.path ?? [])].join('.')} ${issue?.message ?? ''}`,
    );
  });
  return kept;
}

// The query sits on a line of its own; validation keeps it to one line (SOW-0031).
function renderScope(scope: string | null, since: string): string {
  if (scope === null) {
    return [
      'No scope is set. Search only messages from the listed companies and the ATS domains above.',
      `For new applications, search only messages from the ATS domains above, sent after ${since}.`,
      'Set `scope_message_count` to null.',
    ].join('\n');
  }
  return [
    'Search only messages that match this Gmail search query, copied exactly as written:',
    '',
    scope,
    '',
    'First run this query once on its own, without date limits, and set `scope_message_count` to the number of messages or threads it returned (the search tool\'s estimate is fine; 0 when it returned none).',
    'To add date limits or other narrowing terms, wrap the query in parentheses first, for example `(<query>) after:2026/01/31`. Never search outside it.',
    'Messages in this scope may come from any sender, including recruiters writing from personal addresses. Match each message to an application by company, role or content.',
    'For new applications, search the whole scope, with no date limit of your own.',
  ].join('\n');
}

export function createAgentMailSource(adapter: AgentAdapter): MailSource {
  return {
    id: 'agent',
    async sync(req, ctx) {
      const { text, version } = renderPrompt('sync_mail', {
        applications: renderApplications(req.applications),
        reviewed_message_ids: req.reviewed_message_ids.length
          ? req.reviewed_message_ids.join(', ')
          : '(none)',
        ats_domains: ATS_DOMAINS.join(', '),
        mail_scope: renderScope(req.mail_scope, req.new_applications_since),
        tracked: renderTracked(req.tracked),
      });

      ctx.log(`Using adapter ${adapter.id}`);
      const selectionLine = selectionLogLine(adapter);
      if (selectionLine) ctx.log(selectionLine);
      ctx.recordAgent(requestedAgent(adapter));
      const result = await adapter.run(
        { kind: 'sync_mail', prompt: text, outputSchema: outputJsonSchema('sync_mail') },
        { timeoutMs: ctx.timeoutMs, cwd: ctx.runDir, onLog: ctx.log, signal: ctx.signal },
      );
      const reported = reportedAgent(result);
      if (reported) ctx.recordAgent(reported);
      if (!result.ok) throw new Error(`Agent run failed: ${result.error}`);

      const parsed = LenientSyncMailOutput.safeParse(result.output);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `Agent output did not match schema: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
        );
      }
      if (!parsed.data.mail_access) throw new MailAccessError();
      // A missing list is an empty one; anything else that is not a list is logged and ignored.
      const raw = parsed.data.new_applications === undefined ? [] : parsed.data.new_applications;
      if (!Array.isArray(raw)) ctx.log('Ignoring new_applications: the agent did not return a list');
      const newApplications = keepValid(Array.isArray(raw) ? raw : [], ctx.log);
      return { ...parsed.data, new_applications: newApplications, promptVersion: version, adapterId: adapter.id };
    },
  };
}
