import type { AgentAdapter } from '../agents/types.js';
import { ATS_DOMAINS } from '../db/applications-repo.js';
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
      });

      ctx.log(`Using adapter ${adapter.id}`);
      const result = await adapter.run(
        { kind: 'sync_mail', prompt: text, outputSchema: outputJsonSchema('sync_mail') },
        { timeoutMs: ctx.timeoutMs, cwd: ctx.runDir, onLog: ctx.log, signal: ctx.signal },
      );
      if (!result.ok) throw new Error(`Agent run failed: ${result.error}`);

      const parsed = SyncMailOutput.safeParse(result.output);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `Agent output did not match schema: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
        );
      }
      if (!parsed.data.mail_access) throw new MailAccessError();
      return { ...parsed.data, promptVersion: version };
    },
  };
}
