import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentAdapter, AgentResult, AgentTask } from '../agents/types.js';
import { sumUsage } from '../agents/usage.js';
import { ATS_DOMAINS } from '../db/applications-repo.js';
import { describeRange, uncoveredRanges, type DateRange, type ListedWindow } from '../domain/mail-coverage.js';
import { reportedAgent, requestedAgent, selectionLogLine } from '../runs/agent-record.js';
import { mapLimit } from '../runs/map-limit.js';
import { renderPrompt } from '../tasks/prompts.js';
import {
  ListedThread,
  NewApplicationFinding,
  outputJsonSchema,
  SyncMailListOutput,
  SyncMailOutput,
  SyncMailReadOutput,
  ThreadRecord,
  ThreadWindow,
  type NewApplicationResult,
  type ThreadRecordResult,
} from '../tasks/schemas.js';
import { MailAccessError, type MailSource, type MailSyncContext, type MailSyncFindings, type MailSyncRequest } from './types.js';

// Decision 8A: about 20 threads keep a batch's mail bodies well inside the agent's context; three calls at a
// time, as Max discovery.
export const READ_BATCH_SIZE = 20;
export const READ_CONCURRENCY = 3;
// Follow-up list calls for date ranges the first one left uncovered.
const LIST_RETRIES = 2;
// Gmail thread ids are short hex strings. A listed id reaches the read prompt on its own line, so anything
// else is dropped rather than passed on (review L3).
const THREAD_ID = /^[A-Za-z0-9_-]{1,128}$/;

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

const renderRanges = (ranges: DateRange[]): string =>
  ranges.map((r) => `- ${describeRange(r)} (after: ${r.after || 'empty'}, before: ${r.before || 'empty'})`).join('\n');

const issueText = (issue: z.core.$ZodIssue | undefined, path: (string | number)[] = []): string =>
  `${[...path, ...(issue?.path ?? [])].join('.')} ${issue?.message ?? ''}`;

// The agent's schema is strict, but our parse checks new applications one by one: a custom agent's bad entry
// must not cost the status findings of the same run (S1).
const LenientSyncMailOutput = SyncMailOutput.extend({ new_applications: z.unknown().optional() });
// The same for the scoped calls: one bad window, thread or record is dropped, not the whole call.
const LenientListOutput = SyncMailListOutput.extend({ windows: z.array(z.unknown()), threads: z.array(z.unknown()) });
const LenientReadOutput = SyncMailReadOutput.extend({
  threads: z.array(z.unknown()),
  not_applications: z.array(z.unknown()).default([]),
});

function keepValid(entries: unknown[], log: (line: string) => void): NewApplicationResult[] {
  const kept: NewApplicationResult[] = [];
  entries.forEach((entry, i) => {
    const parsed = NewApplicationFinding.safeParse(entry);
    if (parsed.success) {
      kept.push(parsed.data);
      return;
    }
    log(`Dropping a new application the agent returned in the wrong shape: ${issueText(parsed.error.issues[0], ['new_applications', i])}`);
  });
  return kept;
}

// Without a scope the agent searches by company and ATS sender itself; with one, the list and read calls
// below take over (SOW-0051, decision 7A).
function renderScope(since: string): string {
  return [
    'No scope is set. Search only messages from the listed companies and the ATS domains above.',
    `For new applications, search only messages from the ATS domains above, sent after ${since}.`,
    'Set `scope_message_count` to null.',
  ].join('\n');
}

type BatchOutcome = { ok: true; records: ThreadRecordResult[]; read: string[] } | { ok: false; error: string };

export function createAgentMailSource(adapter: AgentAdapter): MailSource {
  return {
    id: 'agent',
    async sync(req, ctx) {
      ctx.log(`Using adapter ${adapter.id}`);
      const selectionLine = selectionLogLine(adapter);
      if (selectionLine) ctx.log(selectionLine);
      ctx.recordAgent(requestedAgent(adapter));

      const results: AgentResult[] = [];
      const run = async (task: AgentTask, cwd: string, onLog: (line: string) => void): Promise<AgentResult> => {
        const result = await adapter.run(task, { timeoutMs: ctx.timeoutMs, cwd, onLog, signal: ctx.signal });
        results.push(result);
        return result;
      };
      try {
        return req.mail_scope === null ? await singleRun(req, ctx, run) : await threadSync(req, req.mail_scope, ctx, run);
      } finally {
        // Kept on failure too, like Max discovery.
        const reported = results.map(reportedAgent).find((r) => r !== null);
        if (reported) ctx.recordAgent(reported);
        const usage = sumUsage(results.map((r) => r.usage));
        if (usage) {
          ctx.recordUsage({
            usage_cost_usd: usage.costUsd ?? null,
            usage_input_tokens: usage.inputTokens ?? null,
            usage_output_tokens: usage.outputTokens ?? null,
          });
        }
      }
    },
  };

  async function singleRun(
    req: MailSyncRequest,
    ctx: MailSyncContext,
    run: (task: AgentTask, cwd: string, onLog: (line: string) => void) => Promise<AgentResult>,
  ): Promise<MailSyncFindings> {
    const { text, version } = renderPrompt('sync_mail', {
      applications: renderApplications(req.applications),
      reviewed_message_ids: req.reviewed_message_ids.length ? req.reviewed_message_ids.join(', ') : '(none)',
      ats_domains: ATS_DOMAINS.join(', '),
      mail_scope: renderScope(req.new_applications_since),
      tracked: renderTracked(req.tracked),
    });
    const result = await run({ kind: 'sync_mail', prompt: text, outputSchema: outputJsonSchema('sync_mail') }, ctx.runDir, ctx.log);
    if (!result.ok) throw new Error(`Agent run failed: ${result.error}`);

    const parsed = LenientSyncMailOutput.safeParse(result.output);
    if (!parsed.success) throw new Error(`Agent output did not match schema: ${issueText(parsed.error.issues[0])}`);
    if (!parsed.data.mail_access) throw new MailAccessError();
    // A missing list is an empty one; anything else that is not a list is logged and ignored.
    const raw = parsed.data.new_applications === undefined ? [] : parsed.data.new_applications;
    if (!Array.isArray(raw)) ctx.log('Ignoring new_applications: the agent did not return a list');
    const newApplications = keepValid(Array.isArray(raw) ? raw : [], ctx.log);
    return { ...parsed.data, new_applications: newApplications, promptVersion: version, adapterId: adapter.id };
  }

  // SOW-0051: the Gmail search returns at most 50 threads and no page token, so one agent run cannot be trusted
  // to see a large scope. The app lists the scope by date window, checks the windows for gaps, and reads only
  // new or changed threads in batches.
  async function threadSync(
    req: MailSyncRequest,
    scope: string,
    ctx: MailSyncContext,
    run: (task: AgentTask, cwd: string, onLog: (line: string) => void) => Promise<AgentResult>,
  ): Promise<MailSyncFindings> {
    const windows: ListedWindow[] = [];
    const listed = new Map<string, string>();
    let lists = 0;

    async function list(ranges: DateRange[]): Promise<void> {
      const n = ++lists;
      const { text } = renderPrompt('sync_mail_list', { scope, today: req.today, ranges: renderRanges(ranges) });
      const cwd = join(ctx.runDir, `list-${n}`);
      mkdirSync(cwd, { recursive: true });
      const log = (line: string) => ctx.log(`[list ${n}] ${line}`);
      const result = await run({ kind: 'sync_mail', prompt: text, outputSchema: outputJsonSchema('sync_mail_list') }, cwd, log);
      if (!result.ok) throw new Error(`Agent run failed: ${result.error}`);
      const parsed = LenientListOutput.safeParse(result.output);
      if (!parsed.success) throw new Error(`Agent output did not match schema: ${issueText(parsed.error.issues[0])}`);
      if (!parsed.data.mail_access) throw new MailAccessError();
      parsed.data.windows.forEach((w, i) => {
        const p = ThreadWindow.safeParse(w);
        if (p.success) windows.push(p.data);
        else log(`Dropping a date range the agent returned in the wrong shape: ${issueText(p.error.issues[0], ['windows', i])}`);
      });
      parsed.data.threads.forEach((t, i) => {
        const p = ListedThread.safeParse(t);
        if (p.success && THREAD_ID.test(p.data.thread_id)) listed.set(p.data.thread_id, p.data.last_message_id);
        else log(`Dropping a listed thread in the wrong shape: threads.${i}`);
      });
    }

    const listVersion = renderPrompt('sync_mail_list', { scope, today: req.today, ranges: '' }).version;
    const readVersion = renderPrompt('sync_mail_read', { threads: '', applications: '', ats_domains: '' }).version;

    const from = req.list_since ?? '';
    ctx.log(from ? `Listing mail since ${from}` : 'Listing all mail');
    await list([{ after: from, before: '' }]);
    let gaps = uncoveredRanges(windows, from);
    for (let attempt = 0; attempt < LIST_RETRIES && gaps.length > 0; attempt++) {
      ctx.log(`Listing again: ${gaps.map(describeRange).join(', ')}`);
      try {
        await list(gaps);
      } catch (err) {
        if (err instanceof MailAccessError) throw err;
        ctx.log(`Listing again failed: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      gaps = uncoveredRanges(windows, from);
    }
    ctx.log(`Listed ${listed.size} threads`);
    if (gaps.length > 0) ctx.log(`Could not confirm that every thread was listed: ${gaps.map(describeRange).join(', ')}`);

    // A blank newest-message id cannot show a change, so such a thread is read every time (review M1).
    const toRead = [...listed].filter(([id, last]) => last.trim() === '' || req.known_threads.get(id) !== last).map(([id]) => id);
    const batches: string[][] = [];
    for (let i = 0; i < toRead.length; i += READ_BATCH_SIZE) batches.push(toRead.slice(i, i + READ_BATCH_SIZE));
    if (batches.length === 0) ctx.log('No new or changed threads to read');
    else {
      ctx.log(
        `Reading ${toRead.length} of ${listed.size} threads in ${batches.length} batches of up to ${READ_BATCH_SIZE}, ${READ_CONCURRENCY} at a time`,
      );
    }

    const applications = renderApplications(req.applications);
    const outcomes = await mapLimit(
      batches.map((threads, i) => ({ threads, n: i + 1 })),
      READ_CONCURRENCY,
      async ({ threads, n }): Promise<BatchOutcome> => {
        // After a cancel, batches still waiting for a slot never start.
        if (ctx.signal.aborted) return { ok: false, error: 'Agent run failed: Aborted' };
        // A batch must settle, never reject: a rejection would end the sync while other batches keep running.
        try {
          const log = (line: string) => ctx.log(`[batch ${n}] ${line}`);
          const { text } = renderPrompt('sync_mail_read', {
            threads: threads.map((t) => `- ${t}`).join('\n'),
            applications,
            ats_domains: ATS_DOMAINS.join(', '),
          });
          const cwd = join(ctx.runDir, `batch-${n}`);
          mkdirSync(cwd, { recursive: true });
          const result = await run({ kind: 'sync_mail', prompt: text, outputSchema: outputJsonSchema('sync_mail_read') }, cwd, log);
          if (!result.ok) return { ok: false, error: `Agent run failed: ${result.error}` };
          const parsed = LenientReadOutput.safeParse(result.output);
          if (!parsed.success) return { ok: false, error: `Agent output did not match schema: ${issueText(parsed.error.issues[0])}` };
          if (!parsed.data.mail_access) return { ok: false, error: new MailAccessError().message };

          const inBatch = new Set(threads);
          const records: ThreadRecordResult[] = [];
          const read = new Set<string>();
          let outside = 0;
          parsed.data.threads.forEach((t, i) => {
            const p = ThreadRecord.safeParse(t);
            if (!p.success) {
              log(`Dropping a thread the agent returned in the wrong shape: ${issueText(p.error.issues[0], ['threads', i])}`);
              return;
            }
            if (!inBatch.has(p.data.thread_id)) outside++;
            else if (!read.has(p.data.thread_id)) {
              records.push(p.data);
              read.add(p.data.thread_id);
            }
          });
          for (const id of parsed.data.not_applications) {
            if (typeof id === 'string' && inBatch.has(id)) read.add(id);
            else outside++;
          }
          if (outside > 0) log(`Dropping ${outside} threads that were not in the batch`);
          const unread = threads.filter((t) => !read.has(t)).length;
          if (unread > 0) log(`${unread} threads were not read; the next sync tries them again`);
          return { ok: true, records, read: [...read] };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    );

    // As Max discovery (decision 11A): keep the batches that worked; fail only when every batch failed.
    const failed = outcomes.flatMap((o, i) => (o.ok ? [] : [{ n: i + 1, error: o.error }]));
    for (const f of failed) ctx.log(`Batch ${f.n} failed: ${f.error}`);
    if (outcomes.length > 0 && failed.length === outcomes.length) {
      if (failed.every((f) => f.error === new MailAccessError().message)) throw new MailAccessError();
      throw new Error(failed[0]!.error);
    }
    const ok = outcomes.flatMap((o) => (o.ok ? [o] : []));
    const readCount = ok.reduce((n, o) => n + o.read.length, 0);
    return {
      mail_access: true,
      findings: [],
      new_applications: [],
      notes: '',
      scope_message_count: listed.size,
      promptVersion: `list ${listVersion} + read ${readVersion}`,
      adapterId: adapter.id,
      threads: {
        records: ok.flatMap((o) => o.records),
        read: ok.flatMap((o) => o.read.map((id) => ({ thread_id: id, last_message_id: listed.get(id)! }))),
        listed: listed.size,
        uncovered: gaps,
        batches: { total: outcomes.length, failed: failed.length },
        unread: toRead.length - readCount,
      },
    };
  }
}
