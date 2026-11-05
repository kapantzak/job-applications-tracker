import type { RunKind, Settings } from '../domain/types.js';
import type { CliAdapterConfig } from './types.js';

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
    case 'claude':
      return {
        id: 'claude',
        argv: [
          'claude', '-p', '--output-format', 'stream-json', '--verbose', '--json-schema', '{schema}',
          '--permission-mode', '{permission_mode}', '--allowedTools', '{allowed_tools}',
        ],
        promptVia: 'stdin',
        resultFrom: 'claude-stream-json',
        versionArgv: ['claude', '--version'],
        vars: {
          permission_mode: discover ? settings.permission_mode_discover : settings.permission_mode_sync,
          allowed_tools: discover ? settings.allowed_tools_discover : settings.allowed_tools_sync,
        },
      };
    case 'codex':
      return {
        id: 'codex',
        argv: [
          'codex', 'exec', '--json', '--output-schema', '{schema_file}', '--skip-git-repo-check',
          '--sandbox', '{sandbox}', '-o', '{output_file}',
        ],
        promptVia: 'argv',
        resultFrom: 'output-file',
        versionArgv: ['codex', '--version'],
        vars: { sandbox: discover ? settings.sandbox_discover : settings.sandbox_sync },
      };
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
