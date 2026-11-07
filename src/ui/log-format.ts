import { RUN_SAVING_LOG_LINE } from '../server/domain/types.js';

// Turns the raw run log (app lines, agent stdout, `[stderr] ` lines) into short human-readable rows.
// Event shapes: Claude Code `--output-format stream-json` (2.1.x) and codex `exec --json`
// (codex-rs/exec/src/exec_events.rs). Unknown agent events are hidden; the raw view shows everything.

export type LogEntryKind =
  | 'app'
  | 'stderr'
  | 'text'
  | 'start'
  | 'finish'
  | 'message'
  | 'search'
  | 'web'
  | 'mail'
  | 'command'
  | 'tool'
  | 'warning'
  | 'error';

export interface LogEntry {
  kind: LogEntryKind;
  text: string;
  tone?: 'muted' | 'warning' | 'error';
}

const MAX_TEXT = 300;
const STDERR_PREFIX = '[stderr] ';
// Tools that only manage the agent's own session or carry the final result (`--json-schema`);
// they say nothing about progress.
const HIDDEN_TOOLS = new Set(['ToolSearch', 'TodoWrite', 'StructuredOutput']);

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

function firstLine(text: string): string {
  return clip(text.split('\n').find((l) => l.trim() !== '') ?? '');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function duration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// What the task returned, from the structured output both task schemas share.
function returned(output: unknown): string | null {
  if (!isObject(output)) return null;
  if (Array.isArray(output.jobs)) return `returned ${plural(output.jobs.length, 'job')}`;
  if (Array.isArray(output.findings)) return `returned ${plural(output.findings.length, 'finding')}`;
  return null;
}

// Gmail tools have the same names under Claude's claude.ai connector and typical Gmail MCP servers; another
// server with the same tool names would also read as Gmail, which is acceptable for a progress log.
function mcpEntry(server: string, tool: string, args: unknown): LogEntry {
  const input = isObject(args) ? args : {};
  if (tool === 'search_threads') return { kind: 'mail', text: clip(`Searching Gmail: ${str(input.query)}`) };
  if (tool === 'get_thread') return { kind: 'mail', text: 'Reading a Gmail thread' };
  if (tool === 'get_message') return { kind: 'mail', text: 'Reading a Gmail message' };
  return { kind: 'tool', text: `Using ${tool} (${server})` };
}

function claudeTool(name: string, input: unknown): LogEntry | null {
  if (HIDDEN_TOOLS.has(name)) return null;
  const args = isObject(input) ? input : {};
  if (name === 'WebSearch') return { kind: 'search', text: clip(`Searching the web: ${str(args.query)}`) };
  if (name === 'WebFetch') return { kind: 'web', text: clip(`Opening ${str(args.url)}`) };
  if (name.startsWith('mcp__')) {
    const [server = '', ...rest] = name.slice('mcp__'.length).split('__');
    return mcpEntry(server, rest.join('__'), args);
  }
  return { kind: 'tool', text: `Using ${name}` };
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (isObject(c) ? str(c.text) : '')).find((t) => t.trim() !== '') ?? '';
  }
  return '';
}

function claudeEvent(e: Json): LogEntry[] | undefined {
  switch (e.type) {
    case 'system':
      return e.subtype === 'init' ? [{ kind: 'start', text: `Agent started (${str(e.model) || 'unknown model'})` }] : [];
    case 'rate_limit_event': {
      const status = isObject(e.rate_limit_info) ? str(e.rate_limit_info.status) : '';
      return status && status !== 'allowed'
        ? [{ kind: 'warning', tone: 'warning', text: `Rate limit: ${status}` }]
        : [];
    }
    case 'assistant':
    case 'user': {
      const content = isObject(e.message) && Array.isArray(e.message.content) ? e.message.content : [];
      const out: LogEntry[] = [];
      for (const block of content) {
        if (!isObject(block)) continue;
        // Text in `user` events is injected context, not something the agent said.
        if (e.type === 'assistant' && block.type === 'text' && str(block.text).trim()) {
          out.push({ kind: 'message', text: clip(str(block.text)) });
        }
        if (block.type === 'tool_use') {
          const entry = claudeTool(str(block.name), block.input);
          if (entry) out.push(entry);
        }
        if (block.type === 'tool_result' && block.is_error === true) {
          out.push({ kind: 'error', tone: 'error', text: `Tool error: ${firstLine(toolResultText(block.content))}` });
        }
      }
      return out;
    }
    case 'result': {
      if (e.subtype !== 'success' || e.is_error === true) {
        // API, sign-in and credit failures arrive as subtype "success" with the message in `result`.
        const reason = firstLine(str(e.result)) || str(e.subtype) || 'error';
        return [{ kind: 'error', tone: 'error', text: `Agent stopped: ${reason}` }];
      }
      const parts = [typeof e.duration_ms === 'number' ? `Agent finished in ${duration(e.duration_ms)}` : 'Agent finished'];
      if (typeof e.total_cost_usd === 'number' && e.total_cost_usd > 0) parts.push(`$${e.total_cost_usd.toFixed(2)}`);
      const what = returned(e.structured_output);
      if (what) parts.push(what);
      return [{ kind: 'finish', text: parts.join(' · ') }];
    }
    default:
      return undefined;
  }
}

// Codex fills in a web search's query and action only when it ends, so it is shown from the completed item.
function codexWebSearch(item: Json): LogEntry {
  const action = isObject(item.action) ? item.action : {};
  if ((action.type === 'open_page' || action.type === 'find_in_page') && str(action.url)) {
    return { kind: 'web', text: clip(`Opening ${str(action.url)}`) };
  }
  const query = str(item.query) || str(action.query);
  return { kind: 'search', text: query ? clip(`Searching the web: ${query}`) : 'Searching the web' };
}

function codexItemStart(item: Json): LogEntry | null {
  switch (item.type) {
    case 'command_execution':
      return { kind: 'command', text: clip(`Running: ${str(item.command)}`) };
    case 'mcp_tool_call':
      return mcpEntry(str(item.server), str(item.tool), item.arguments);
    default:
      return null;
  }
}

function codexItemFailure(item: Json): LogEntry | null {
  if (item.type === 'command_execution') {
    if (item.status === 'declined') return { kind: 'error', tone: 'error', text: clip(`Command declined: ${str(item.command)}`) };
    const code = typeof item.exit_code === 'number' ? item.exit_code : null;
    if (item.status === 'failed' || (code !== null && code !== 0)) {
      return { kind: 'error', tone: 'error', text: clip(`Command failed (exit ${code ?? '?'}): ${str(item.command)}`) };
    }
  }
  if (item.type === 'file_change' && item.status === 'failed') {
    return { kind: 'error', tone: 'error', text: 'File change failed' };
  }
  if (item.type === 'mcp_tool_call' && item.status === 'failed') {
    const message = isObject(item.error) ? str(item.error.message) : '';
    return { kind: 'error', tone: 'error', text: clip(`Tool error: ${str(item.tool)}: ${message || 'failed'}`) };
  }
  return null;
}

// "Agent returned N jobs" when the text is the structured result, which can quote email content.
function structuredSummary(text: string): string | null {
  if (!text.trim().startsWith('{')) return null;
  try {
    const what = returned(JSON.parse(text));
    return what ? `Agent ${what}` : null;
  } catch {
    return null;
  }
}

function codexMessage(text: string): LogEntry {
  return { kind: 'message', text: structuredSummary(text) ?? clip(text) };
}

function codexEvent(e: Json, started: Set<string>): LogEntry[] | undefined {
  const item = isObject(e.item) ? e.item : null;
  switch (e.type) {
    case 'thread.started':
    case 'turn.started':
    case 'item.updated':
      return [];
    case 'turn.completed': {
      const usage = isObject(e.usage) ? e.usage : {};
      const tokens = [usage.input_tokens, usage.output_tokens].reduce<number>(
        (sum, n) => sum + (typeof n === 'number' ? n : 0),
        0,
      );
      return [{ kind: 'finish', text: `Agent finished · ${tokens.toLocaleString('en-US')} tokens` }];
    }
    case 'turn.failed': {
      const message = isObject(e.error) ? str(e.error.message) : '';
      return [{ kind: 'error', tone: 'error', text: clip(`Agent failed: ${message || 'unknown error'}`) }];
    }
    case 'error':
      return [{ kind: 'error', tone: 'error', text: clip(str(e.message) || 'Agent error') }];
    case 'item.started': {
      if (!item) return [];
      const entry = codexItemStart(item);
      // Only items with an id can be paired with their completion.
      if (entry && str(item.id)) started.add(str(item.id));
      return entry ? [entry] : [];
    }
    case 'item.completed': {
      if (!item) return [];
      const failure = codexItemFailure(item);
      if (failure) return [failure];
      if (item.type === 'agent_message') return str(item.text).trim() ? [codexMessage(str(item.text))] : [];
      if (item.type === 'error') return [{ kind: 'error', tone: 'error', text: clip(str(item.message)) }];
      if (item.type === 'web_search') return [codexWebSearch(item)];
      if (item.type === 'file_change') {
        const paths = Array.isArray(item.changes) ? item.changes.map((c) => (isObject(c) ? str(c.path) : '')) : [];
        const list = paths.filter(Boolean).join(', ');
        return [{ kind: 'tool', text: list ? clip(`Changed files: ${list}`) : 'Changed files' }];
      }
      // A step shown at its start is not repeated; one whose start was missed is shown now.
      if (str(item.id) && started.has(str(item.id))) return [];
      const entry = codexItemStart(item);
      return entry ? [entry] : [];
    }
    default:
      return undefined;
  }
}

// Lines the app itself writes (queue.ts, discovery.ts, mail-sync.ts, agent-source.ts). A custom agent
// printing the same words is styled as app output too, which is harmless.
const APP_LINES: RegExp[] = [
  /^Run \S+ \(\w+\) started$/,
  /^Using adapter /,
  /^Model: /,
  /^No open applications to check$/,
  /^Dropping finding for unknown application /,
  /^Skipping duplicate finding for /,
  /^Skipping (unparseable|unsupported) url: /,
  /^\d+ proposals created, \d+ skipped$/,
  /^\d+ new, \d+ duplicates, \d+ dead, \d+ unverified(; \d+ of \d+ workers failed)?$/,
  /^Max effort: \d+ workers, up to \d+ at a time$/,
  /^Worker \d+ \(.+\) started$/,
];
// A failed Max worker does not fail the run, so it is a warning rather than an error.
const WORKER_FAILED = /^Worker \d+ \(.+\) failed: /;
// Max workers' own output is written with this prefix (src/server/services/discovery.ts).
const WORKER_PREFIX = /^\[worker (\d+)\] (.*)$/;

function appLine(line: string): LogEntry | null {
  const finished = /^Run \S+ (succeeded|failed|aborted)(:.*)?$/.exec(line);
  if (finished) return { kind: 'app', tone: finished[1] === 'succeeded' ? 'muted' : 'error', text: clip(line) };
  if (WORKER_FAILED.test(line)) return { kind: 'app', tone: 'warning', text: clip(line) };
  if (line === RUN_SAVING_LOG_LINE || APP_LINES.some((re) => re.test(line))) {
    return { kind: 'app', tone: 'muted', text: clip(line) };
  }
  return null;
}

// One raw line; `started` is shared across lines because Codex reports a step at its start and its end.
function formatLine(line: string, started: Set<string>): LogEntry[] {
  if (line.startsWith(STDERR_PREFIX)) {
    return [{ kind: 'stderr', tone: 'muted', text: clip(line.slice(STDERR_PREFIX.length)) }];
  }
  const app = appLine(line);
  if (app) return [app];
  let event: unknown;
  if (line.trim().startsWith('{')) {
    try {
      event = JSON.parse(line);
    } catch {
      event = undefined;
    }
  }
  // Plain output, or JSON that is not an agent event (a custom command's own result), is kept as text.
  if (!isObject(event) || typeof event.type !== 'string') {
    return [{ kind: 'text', text: structuredSummary(line) ?? clip(line) }];
  }
  return claudeEvent(event) ?? codexEvent(event, started) ?? [];
}

export function formatLog(lines: string[]): LogEntry[] {
  const started = new Set<string>();
  // Each Max worker is its own agent process with its own item ids.
  const workerStarted = new Map<string, Set<string>>();
  const out: LogEntry[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') continue;
    const worker = WORKER_PREFIX.exec(line);
    if (worker) {
      const id = worker[1]!;
      if (!workerStarted.has(id)) workerStarted.set(id, new Set());
      for (const entry of formatLine(worker[2]!, workerStarted.get(id)!)) {
        out.push({ ...entry, text: `Worker ${id}: ${entry.text}` });
      }
      continue;
    }
    out.push(...formatLine(line, started));
  }
  return out;
}
