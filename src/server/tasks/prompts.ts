import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentTaskKind } from '../domain/types.js';

const PACKAGE_NAME = 'job-applications-tracker';

// Walk up so the same code works from src/server/tasks and dist/server.
function findPromptsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const name = (JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string }).name;
        if (name === PACKAGE_NAME) return path.join(dir, 'prompts');
      } catch {
        // Unreadable package.json: keep walking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate ${PACKAGE_NAME} package root to find prompts directory`);
}

export const PROMPTS_DIR = findPromptsDir();

export function renderPrompt(
  kind: AgentTaskKind,
  vars: Record<string, unknown>,
): { text: string; version: string } {
  const raw = fs.readFileSync(path.join(PROMPTS_DIR, `${kind}.md`), 'utf8');
  const m = /^---\r?\nversion:\s*(\S+)\s*\r?\n---\r?\n/.exec(raw);
  if (!m) throw new Error(`Prompt template ${kind}.md is missing front matter`);
  const text = raw.slice(m[0].length).replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`Missing prompt variable: ${name}`);
    return String(vars[name]);
  });
  return { text, version: m[1]! };
}
