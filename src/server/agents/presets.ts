import type { RunKind, Settings } from '../domain/types.js';
import type { AgentSelection, CliAdapterConfig, ModelCatalog } from './types.js';

// Model ids and effort levels become argv elements; a leading '-' would be read as a flag, and
// codex receives the effort inside a quoted TOML string.
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/;
export const EFFORT_PATTERN = /^[a-z]{1,20}$/;
// USD amount for `--max-budget-usd`; also reaches argv.
export const BUDGET_PATTERN = /^\d{1,4}(\.\d{1,2})?$/;
// Built-in tool names as `--tools` takes them; permission rules such as `Bash(curl:*)` are cut to the name.
const BUILTIN_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

// From `claude --help` (2.1.319): it names these aliases and these effort levels; it has no catalog command.
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const CLAUDE_MODEL_CATALOG: ModelCatalog = {
  source: 'static',
  models: ['fable', 'opus', 'sonnet'].map((id) => ({ id, label: id, efforts: CLAUDE_EFFORTS })),
  efforts: CLAUDE_EFFORTS,
};

function selectionFor(settings: Settings, agent: 'claude' | 'codex', kind: RunKind): AgentSelection {
  const suffix = kind === 'discover_jobs' ? 'discover' : 'sync';
  const model = settings[`${agent}_model_${suffix}`];
  const effort = settings[`${agent}_effort_${suffix}`];
  // The API validates these; stored values are re-checked because they reach argv.
  if (model !== '' && !MODEL_PATTERN.test(model)) throw new Error(`Invalid model setting: ${model}`);
  if (effort !== '' && !EFFORT_PATTERN.test(effort)) throw new Error('Invalid effort setting');
  return { model, effort };
}

// Discovery needs only the tools it is allowed (SOW-0016). `--tools` drops every other built-in tool
// definition; `--allowedTools` alone only skips prompts. MCP servers loaded through `--setting-sources user`
// cost ~260k context tokens per run on a machine with many connectors (probed 2026-11-07), so they are
// skipped unless the user allowed an MCP tool for discovery. The spend cap is Claude Code's own estimate.
function claudeDiscoverFlags(settings: Settings): string[] {
  const entries = settings.allowed_tools_discover
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const usesMcp = entries.some((t) => t.startsWith('mcp__'));
  const builtins = [
    ...new Set(
      entries
        .filter((t) => !t.startsWith('mcp__'))
        .map((t) => t.split('(')[0]!)
        .filter((t) => BUILTIN_TOOL_NAME.test(t)),
    ),
  ];
  const budget = settings.claude_max_budget_usd_discover;
  if (budget !== '' && (!BUDGET_PATTERN.test(budget) || !(Number(budget) > 0))) {
    throw new Error('Invalid spend cap setting');
  }
  return [
    // An empty value turns every built-in tool off; leaving the flag out would load them all.
    '--tools', builtins.join(','),
    ...(usesMcp ? [] : ['--strict-mcp-config']),
    ...(budget ? ['--max-budget-usd', budget] : []),
  ];
}

// `--setting-sources user` also loads the user's personal CLAUDE.md, auto-memory and hooks, which are
// meant for their own sessions: they change how the agent answers and cost ~9k tokens per run (probed
// 2026-11-07, SOW-0018). These keys drop them while credentials, env and MCP connectors stay.
const CLAUDE_ISOLATION_SETTINGS = JSON.stringify({
  claudeMdExcludes: ['**/CLAUDE.md'],
  disableAllHooks: true,
  autoMemoryEnabled: false,
});

// Whitespace-separated words; single quotes are literal, double quotes allow \" and \\.
// Other backslashes stay literal so Windows paths survive.
export function splitShellWords(input: string): string[] {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) word += input[++i];
      else word += ch;
    } else if (/\s/.test(ch)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else {
      word += ch;
      inWord = true;
    }
  }
  if (quote) throw new Error('Custom command has an unterminated quote');
  if (inWord) words.push(word);
  return words;
}

export function buildAdapterConfig(settings: Settings, kind: RunKind): CliAdapterConfig {
  const discover = kind === 'discover_jobs';
  switch (settings.adapter_id) {
    case 'claude': {
      const selection = selectionFor(settings, 'claude', kind);
      return {
        id: 'claude',
        // `--setting-sources user` keeps credentials and MCP connectors (Gmail) but skips
        // project settings the run cwd might imply; `--bare` would skip the keychain and log the
        // agent out. Denying Agent/Task is the only hard stop on subagent fan-out.
        argv: [
          'claude', '-p', '--output-format', 'stream-json', '--verbose', '--json-schema', '{schema}',
          '--permission-mode', '{permission_mode}', '--allowedTools', '{allowed_tools}',
          '--setting-sources', 'user', '--settings', CLAUDE_ISOLATION_SETTINGS,
          '--disallowedTools', 'Agent,Task',
          ...(discover ? claudeDiscoverFlags(settings) : []),
          ...(selection.model ? ['--model', selection.model] : []),
          ...(selection.effort ? ['--effort', selection.effort] : []),
        ],
        promptVia: 'stdin',
        resultFrom: 'claude-stream-json',
        usageFrom: 'claude-stream-json',
        versionArgv: ['claude', '--version'],
        authArgv: ['claude', 'auth', 'status'],
        vars: {
          permission_mode: discover ? settings.permission_mode_discover : settings.permission_mode_sync,
          allowed_tools: discover ? settings.allowed_tools_discover : settings.allowed_tools_sync,
        },
        selection,
        modelCatalog: CLAUDE_MODEL_CATALOG,
      };
    }
    case 'codex': {
      const selection = selectionFor(settings, 'codex', kind);
      return {
        id: 'codex',
        argv: [
          'codex', 'exec', '--json', '--output-schema', '{schema_file}', '--skip-git-repo-check',
          '--sandbox', '{sandbox}', '-o', '{output_file}',
          // Sub-agents are on by default in codex-cli 0.163; the Claude preset denies them for both kinds too.
          '--disable', 'multi_agent',
          // The default `cached` search reads an OpenAI index without live web access.
          ...(discover ? ['-c', 'web_search="live"'] : []),
          ...(selection.model ? ['-m', selection.model] : []),
          // A TOML string; no shell is involved, so the quotes reach codex as written.
          ...(selection.effort ? ['-c', `model_reasoning_effort="${selection.effort}"`] : []),
        ],
        promptVia: 'argv',
        resultFrom: 'output-file',
        usageFrom: 'codex-json',
        versionArgv: ['codex', '--version'],
        authArgv: ['codex', 'login', 'status'],
        vars: { sandbox: discover ? settings.sandbox_discover : settings.sandbox_sync },
        selection,
        modelsArgv: ['codex', 'debug', 'models'],
      };
    }
    case 'custom': {
      const argv = splitShellWords(settings.custom_command);
      if (argv.length === 0) throw new Error('Custom command is empty');
      return { id: 'custom', argv, promptVia: 'file', resultFrom: 'stdout-json' };
    }
    default:
      // Settings are stored as JSON, so an unexpected value can reach here at runtime.
      throw new Error(`Unknown adapter: ${String((settings as { adapter_id: unknown }).adapter_id)}`);
  }
}
