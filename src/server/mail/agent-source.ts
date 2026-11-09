import type { AgentAdapter } from '../agents/types.js';
import { ATS_DOMAINS } from '../db/applications-repo.js';
import { reportedAgent, requestedAgent, selectionLogLine } from '../runs/agent-record.js';
import { renderPrompt } from '../tasks/prompts.js';
import { outputJsonSchema, SyncMailOutput } from '../tasks/schemas.js';
import { MailAccessError, type MailSource, type MailSyncRequest } from './types.js';

function renderApplications(apps: MailSyncRequest['applications']): string {
  return apps
    .map((a) => {
      const domains = a.sender_domains.length ? a.sender_domains.join(', ') : '(none)';
      return `- id: ${a.id} | company: ${a.company} | role: ${a.role} | applied_at: ${a.applied_at} | sender_domains: ${domains}`;
    })
    .join('\n');
}

// The query sits on a line of its own; validation keeps it to one line (SOW-0031).
function renderScope(scope: string | null): string {
  if (scope === null) {
    return [
      'No scope is set. Search only messages from the listed companies and the ATS domains above.',
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
        mail_scope: renderScope(req.mail_scope),
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

      const parsed = SyncMailOutput.safeParse(result.output);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `Agent output did not match schema: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
        );
      }
      if (!parsed.data.mail_access) throw new MailAccessError();
      return { ...parsed.data, promptVersion: version, adapterId: adapter.id };
    },
  };
}
