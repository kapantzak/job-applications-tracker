import { describe, expect, it } from 'vitest';
import { formatLog, type LogEntry } from '../../src/ui/log-format.js';

const j = (event: unknown) => JSON.stringify(event);
const texts = (entries: LogEntry[]) => entries.map((e) => e.text);

describe('formatLog: app and plain lines', () => {
  it('mutes app lines and stderr, keeps plain text, and summarises JSON results without a type', () => {
    const entries = formatLog([
      'Run run-1 (discover_jobs) started',
      'Using adapter claude',
      'Model: opus, effort: agent default',
      'Saving results; the run can no longer be cancelled',
      'Run run-1 succeeded: 2 new, 0 duplicates, 0 dead, 0 unverified',
      '[stderr] warning: slow network',
      'custom agent says hi',
      '{"jobs":[]}',
    ]);
    expect(entries.map((e) => [e.kind, e.tone ?? 'normal', e.text])).toEqual([
      ['app', 'muted', 'Run run-1 (discover_jobs) started'],
      ['app', 'muted', 'Using adapter claude'],
      ['app', 'muted', 'Model: opus, effort: agent default'],
      ['app', 'muted', 'Saving results; the run can no longer be cancelled'],
      ['app', 'muted', 'Run run-1 succeeded: 2 new, 0 duplicates, 0 dead, 0 unverified'],
      ['stderr', 'muted', 'warning: slow network'],
      ['text', 'normal', 'custom agent says hi'],
      ['text', 'normal', 'Agent returned 0 jobs'],
    ]);
  });

  it('highlights failed and aborted run lines', () => {
    const entries = formatLog(['Run run-1 failed: Agent run failed: Exited with code 1', 'Run run-2 aborted: Cancelled by user']);
    expect(entries.map((e) => e.tone)).toEqual(['error', 'error']);
  });

  it('recognises the handlers\' own lines', () => {
    const lines = [
      'No open applications to check',
      'Dropping finding for unknown application app-9',
      'Skipping duplicate finding for app-1 (interview)',
      '2 proposals created, 1 skipped',
      '3 new, 1 duplicates, 0 dead, 2 unverified',
      'Skipping unparseable url: not a url',
      'Skipping unsupported url: javascript:alert(1)',
    ];
    expect(formatLog(lines).map((e) => [e.kind, e.tone])).toEqual(lines.map(() => ['app', 'muted']));
  });

  it('recognises the Gmail scope lines, warning when the scope matched no mail', () => {
    const entries = formatLog([
      'The Gmail scope matched no mail; check the label or search on the Profile page',
      '0 proposals created, 0 skipped; the Gmail scope matched no mail',
    ]);
    expect(entries.map((e) => [e.kind, e.tone])).toEqual([
      ['app', 'warning'],
      ['app', 'muted'],
    ]);
  });

  it('recognises the max-effort lines, warning on a failed worker', () => {
    const entries = formatLog([
      'Max effort: 5 workers, up to 3 at a time',
      'Worker 1 (Greenhouse) started',
      'Worker 2 (Lever) failed: Agent run failed: Timed out after 1000 ms',
      '3 new, 0 duplicates, 0 dead, 0 unverified; 2 of 5 workers failed',
    ]);
    expect(entries.map((e) => [e.kind, e.tone])).toEqual([
      ['app', 'muted'],
      ['app', 'muted'],
      ['app', 'warning'],
      ['app', 'muted'],
    ]);
  });

  it('formats worker lines like any other line and names the worker', () => {
    const entries = formatLog([
      `[worker 2] ${j({ type: 'assistant', message: { content: [{ type: 'text', text: 'looking' }] } })}`,
      '[worker 3] [stderr] slow network',
      '[worker 4] plain words',
      `[worker 5] ${j({ type: 'unknown.event' })}`,
    ]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['message', 'Worker 2: looking'],
      ['stderr', 'Worker 3: slow network'],
      ['text', 'Worker 4: plain words'],
    ]);
  });

  it('highlights a finish line with an empty reason', () => {
    expect(formatLog(['Run run-1 failed: ']).map((e) => [e.kind, e.tone])).toEqual([['app', 'error']]);
  });

  it('caps long plain and stderr lines and summarises typeless JSON results', () => {
    const entries = formatLog([
      'x'.repeat(1000),
      `[stderr] ${'y'.repeat(1000)}`,
      JSON.stringify({ mail_access: true, findings: [{ reason: 'quoted email text', evidence: {} }] }),
    ]);
    expect(entries[0]!.text.length).toBe(300);
    expect(entries[1]!.text.length).toBe(300);
    expect(entries[2]).toMatchObject({ kind: 'text', text: 'Agent returned 1 finding' });
  });

  it('treats malformed or non-object JSON as text and parses indented events', () => {
    const entries = formatLog(['[1]', '{"type":5}', '{bad', `  ${JSON.stringify({ type: 'system', subtype: 'init', model: 'm' })}`]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['text', '[1]'],
      ['text', '{"type":5}'],
      ['text', '{bad'],
      ['start', 'Agent started (m)'],
    ]);
  });

  it('skips empty lines', () => {
    expect(formatLog(['', '   '])).toEqual([]);
  });
});

describe('formatLog: Claude Code stream-json', () => {
  it('hides hooks, command changes, thinking, allowed rate limits and successful tool results', () => {
    expect(
      formatLog([
        j({ type: 'system', subtype: 'hook_started', hook_name: 'h' }),
        j({ type: 'system', subtype: 'hook_response', hook_name: 'h', output: 'x' }),
        j({ type: 'system', subtype: 'commands_changed', commands: [] }),
        j({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'secret plan' }] } }),
        j({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
        j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'page text' }] } }),
        j({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'ToolSearch', input: { query: 'x' } }] } }),
        j({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: {} }] } }),
      ]),
    ).toEqual([]);
  });

  it('announces the start with the model', () => {
    const [entry] = formatLog([j({ type: 'system', subtype: 'init', model: 'model-a' })]);
    expect(entry).toMatchObject({ kind: 'start', text: 'Agent started (model-a)' });
  });

  it('turns tool calls into one line each', () => {
    const entries = formatLog([
      j({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Looking for roles.' },
            { type: 'tool_use', name: 'WebSearch', input: { query: 'platform engineer Lisbon' } },
            { type: 'tool_use', name: 'WebFetch', input: { url: 'https://jobs.example.com/1', prompt: 'p' } },
          ],
        },
      }),
      j({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'mcp__claude_ai_Gmail__search_threads', input: { query: 'from:acme.example.com' } },
            { type: 'tool_use', name: 'mcp__claude_ai_Gmail__get_thread', input: { thread_id: 'thr-1' } },
            { type: 'tool_use', name: 'mcp__claude_ai_Gmail__get_message', input: { message_id: 'msg-001' } },
            { type: 'tool_use', name: 'mcp__notes__lookup', input: {} },
            { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' } },
          ],
        },
      }),
    ]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['message', 'Looking for roles.'],
      ['search', 'Searching the web: platform engineer Lisbon'],
      ['web', 'Opening https://jobs.example.com/1'],
      ['mail', 'Searching Gmail: from:acme.example.com'],
      ['mail', 'Reading a Gmail thread'],
      ['mail', 'Reading a Gmail message'],
      ['tool', 'Using lookup (notes)'],
      ['tool', 'Using Read'],
    ]);
  });

  it('caps long agent text and collapses whitespace', () => {
    const long = `${'word '.repeat(100)}\n\nend`;
    const [entry] = formatLog([j({ type: 'assistant', message: { content: [{ type: 'text', text: long }] } })]);
    expect(entry!.text.length).toBeLessThanOrEqual(300);
    expect(entry!.text.endsWith('…')).toBe(true);
    expect(entry!.text).not.toContain('\n');
  });

  it('shows tool errors with their first line, from string or block content', () => {
    const entries = formatLog([
      j({
        type: 'user',
        message: { content: [{ type: 'tool_result', is_error: true, content: 'Request failed\nstack trace' }] },
      }),
      j({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'Permission denied' }] }],
        },
      }),
    ]);
    expect(entries.map((e) => [e.kind, e.tone, e.text])).toEqual([
      ['error', 'error', 'Tool error: Request failed'],
      ['error', 'error', 'Tool error: Permission denied'],
    ]);
  });

  it('warns about a rate limit that is not allowed', () => {
    const [entry] = formatLog([j({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } })]);
    expect(entry).toMatchObject({ kind: 'warning', tone: 'warning', text: 'Rate limit: rejected' });
  });

  it('summarises a successful result with duration, cost and what it returned', () => {
    const entries = formatLog([
      j({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 252_400,
        total_cost_usd: 0.4213,
        structured_output: { jobs: [{}, {}, {}] },
      }),
      j({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 5_000,
        structured_output: { mail_access: true, findings: [{}] },
      }),
      j({ type: 'result', subtype: 'success', duration_ms: 900 }),
    ]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['finish', 'Agent finished in 4m 12s · $0.42 · returned 3 jobs'],
      ['finish', 'Agent finished in 5s · returned 1 finding'],
      ['finish', 'Agent finished in 1s'],
    ]);
  });

  it('shows an error result', () => {
    const [entry] = formatLog([j({ type: 'result', subtype: 'error_max_turns', is_error: true, duration_ms: 1000 })]);
    expect(entry).toMatchObject({ kind: 'error', tone: 'error', text: 'Agent stopped: error_max_turns' });
  });

  it('shows the message of an error result reported as success', () => {
    const [entry] = formatLog([
      j({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low\nmore', duration_ms: 10 }),
    ]);
    expect(entry).toMatchObject({ kind: 'error', text: 'Agent stopped: Credit balance is too low' });
  });

  it('hides the structured-output tool call and text injected into user events', () => {
    expect(
      formatLog([
        j({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: { jobs: [] } }] } }),
        j({ type: 'user', message: { content: [{ type: 'text', text: 'injected context' }] } }),
      ]),
    ).toEqual([]);
  });

  it('hides unknown event types', () => {
    expect(formatLog([j({ type: 'stream_event', event: {} }), j({ type: 'system', subtype: 'something_new' })])).toEqual(
      [],
    );
  });
});

describe('formatLog: Codex exec --json', () => {
  it('hides thread and turn starts, updates, reasoning and todo lists', () => {
    expect(
      formatLog([
        j({ type: 'thread.started', thread_id: 'th-1' }),
        j({ type: 'turn.started' }),
        j({ type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'thinking' } }),
        j({ type: 'item.started', item: { id: 'i1', type: 'todo_list', items: [] } }),
        j({ type: 'item.updated', item: { id: 'i1', type: 'todo_list', items: [] } }),
        j({ type: 'item.completed', item: { id: 'i1', type: 'todo_list', items: [] } }),
      ]),
    ).toEqual([]);
  });

  it('shows a tool step once, at its start, and only failures at completion', () => {
    const entries = formatLog([
      // Codex fills in the query only when the search ends.
      j({ type: 'item.started', item: { id: 'w1', type: 'web_search', query: '', action: { type: 'other' } } }),
      j({
        type: 'item.completed',
        item: { id: 'w1', type: 'web_search', query: 'backend jobs Porto', action: { type: 'search', query: 'backend jobs Porto' } },
      }),
      j({
        type: 'item.started',
        item: { id: 'c1', type: 'command_execution', command: 'curl -sI https://jobs.example.com/2', status: 'in_progress' },
      }),
      j({
        type: 'item.completed',
        item: {
          id: 'c1',
          type: 'command_execution',
          command: 'curl -sI https://jobs.example.com/2',
          exit_code: 6,
          status: 'failed',
          aggregated_output: '',
        },
      }),
      j({
        type: 'item.started',
        item: { id: 'm1', type: 'mcp_tool_call', server: 'gmail', tool: 'search_threads', arguments: { query: 'acme' }, status: 'in_progress' },
      }),
      j({
        type: 'item.completed',
        item: {
          id: 'm1',
          type: 'mcp_tool_call',
          server: 'gmail',
          tool: 'search_threads',
          arguments: { query: 'acme' },
          status: 'failed',
          error: { message: 'Not authorized' },
        },
      }),
    ]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['search', 'Searching the web: backend jobs Porto'],
      ['command', 'Running: curl -sI https://jobs.example.com/2'],
      ['error', 'Command failed (exit 6): curl -sI https://jobs.example.com/2'],
      ['mail', 'Searching Gmail: acme'],
      ['error', 'Tool error: search_threads: Not authorized'],
    ]);
  });

  it('pairs steps per worker, since every codex process numbers its items from the start', () => {
    const start = j({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'ls' } });
    const done = j({
      type: 'item.completed',
      item: { id: 'item_0', type: 'command_execution', command: 'ls', exit_code: 0, status: 'completed' },
    });
    expect(texts(formatLog([`[worker 1] ${start}`, `[worker 2] ${done}`, `[worker 1] ${done}`]))).toEqual([
      'Worker 1: Running: ls',
      'Worker 2: Running: ls',
    ]);
  });

  it('shows a completed step whose start was not seen', () => {
    const entries = formatLog([
      j({
        type: 'item.completed',
        item: { id: 'c9', type: 'command_execution', command: 'ls', exit_code: 0, status: 'completed', aggregated_output: 'a' },
      }),
    ]);
    expect(texts(entries)).toEqual(['Running: ls']);
  });

  it('shows web searches and page opens once, from the completed item', () => {
    const entries = formatLog([
      j({ type: 'item.started', item: { id: 'w2', type: 'web_search', query: '', action: { type: 'other' } } }),
      j({
        type: 'item.completed',
        item: { id: 'w2', type: 'web_search', query: '', action: { type: 'open_page', url: 'https://jobs.example.com/7' } },
      }),
      j({
        type: 'item.completed',
        item: {
          id: 'w3',
          type: 'web_search',
          query: '',
          action: { type: 'find_in_page', url: 'https://jobs.example.com/8', pattern: 'apply' },
        },
      }),
      j({ type: 'item.completed', item: { id: 'w4', type: 'web_search', query: '', action: { type: 'other' } } }),
    ]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['web', 'Opening https://jobs.example.com/7'],
      ['web', 'Opening https://jobs.example.com/8'],
      ['search', 'Searching the web'],
    ]);
  });

  it('pairs only items that carry an id', () => {
    const entries = formatLog([
      j({ type: 'item.started', item: { type: 'command_execution', command: 'a', status: 'in_progress' } }),
      j({ type: 'item.completed', item: { type: 'command_execution', command: 'b', exit_code: 0, status: 'completed' } }),
    ]);
    expect(texts(entries)).toEqual(['Running: a', 'Running: b']);
  });

  it('marks a failed file change as an error', () => {
    const entries = formatLog([
      j({ type: 'item.completed', item: { id: 'f2', type: 'file_change', changes: [], status: 'failed' } }),
    ]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([['error', 'File change failed']]);
  });

  it('shows agent messages, summarising structured JSON output', () => {
    const entries = formatLog([
      j({ type: 'item.completed', item: { id: 'a1', type: 'agent_message', text: 'Checking postings now.' } }),
      j({
        type: 'item.completed',
        item: { id: 'a2', type: 'agent_message', text: JSON.stringify({ jobs: [{}, {}], notes: '' }) },
      }),
    ]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['message', 'Checking postings now.'],
      ['message', 'Agent returned 2 jobs'],
    ]);
  });

  it('summarises the turn and reports failures', () => {
    const entries = formatLog([
      j({
        type: 'turn.completed',
        usage: { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 300, reasoning_output_tokens: 50 },
      }),
      j({ type: 'turn.failed', error: { message: 'stream disconnected' } }),
      j({ type: 'error', message: 'Reconnecting… 1/5' }),
      j({ type: 'item.completed', item: { id: 'e1', type: 'error', message: 'Model refused' } }),
      j({ type: 'item.completed', item: { id: 'f1', type: 'file_change', changes: [{ path: 'a.txt', kind: 'add' }], status: 'completed' } }),
    ]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['finish', 'Agent finished · 1,500 tokens'],
      ['error', 'Agent failed: stream disconnected'],
      ['error', 'Reconnecting… 1/5'],
      ['error', 'Model refused'],
      ['tool', 'Changed files: a.txt'],
    ]);
  });
});
