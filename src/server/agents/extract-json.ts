export class NoJsonFoundError extends Error {
  constructor(message = 'No JSON object found in agent output') {
    super(message);
    this.name = 'NoJsonFoundError';
  }
}

// Only lines that are a bare fence are removed; JSON strings cannot span lines, so this never edits a value.
function stripFences(text: string): string {
  return text.replace(/^[ \t]*```[\w-]*[ \t]*$/gm, '');
}

// Returns the closing index of the object opened at `start`, or -1 if it never closes.
function findObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function extractLastJsonObject(text: string): unknown {
  const cleaned = stripFences(text);
  const candidates: string[] = [];
  let i = cleaned.indexOf('{');
  while (i !== -1) {
    const end = findObjectEnd(cleaned, i);
    if (end === -1) {
      // An unmatched brace in prose would swallow the rest; treat it as prose and move on.
      i = cleaned.indexOf('{', i + 1);
    } else {
      candidates.push(cleaned.slice(i, end + 1));
      i = cleaned.indexOf('{', end + 1);
    }
  }
  const last = candidates.at(-1);
  if (last === undefined) throw new NoJsonFoundError();
  // No fallback to earlier candidates: those may be a schema or example echoed in the agent's prose.
  try {
    return JSON.parse(last);
  } catch (err) {
    throw new NoJsonFoundError(`Last JSON object in agent output does not parse: ${errorText(err)}`);
  }
}

export function extractClaudeStructuredOutput(ndjson: string): unknown {
  let result: Record<string, unknown> | undefined;
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed) as unknown;
      if (event && typeof event === 'object' && (event as { type?: unknown }).type === 'result') {
        result = event as Record<string, unknown>;
      }
    } catch {
      // Non-JSON lines are ignored.
    }
  }
  if (!result) throw new NoJsonFoundError('No result event in Claude stream-json output');
  if (result.structured_output != null) return result.structured_output;
  if (typeof result.result === 'string') return extractLastJsonObject(result.result);
  throw new NoJsonFoundError('Claude result event has no structured_output or result text');
}
