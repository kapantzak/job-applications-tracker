// Rules for merging applications the user knows are one (SOW-0055, decisions 3A and 6C): the kept application's
// own details stay, its gaps are filled from the others, and every other name is remembered as an alias.
import { matchKey } from './new-application.js';
import { stageOf } from './stage.js';
import type { Application, ApplicationAlias } from './types.js';

export interface MergedFields {
  url: string | null;
  job_id: string | null;
  applied_at: string | null;
  sender_domains: string[];
  notes: string | null;
}

const present = (value: string | null): value is string => value !== null && value.trim() !== '';

export function mergedFields(kept: Application, removed: Application[]): MergedFields {
  const dates = removed.map((a) => a.applied_at).filter(present).sort((a, b) => Date.parse(a) - Date.parse(b));
  // The kept date stays; a saved application gets none from the others (spec "Status pipeline").
  const appliedAt = kept.applied_at ?? (kept.status === 'saved' ? null : (dates[0] ?? null));
  const notes = [...new Set([kept, ...removed].map((a) => a.notes).filter(present).map((n) => n.trim()))];
  return {
    url: present(kept.url) ? kept.url : (removed.map((a) => a.url).find(present) ?? null),
    job_id: kept.job_id ?? removed.map((a) => a.job_id).find((id) => id !== null) ?? null,
    applied_at: appliedAt,
    sender_domains: [...new Set([kept, ...removed].flatMap((a) => a.sender_domains))],
    notes: notes.length ? notes.join('\n\n') : null,
  };
}

// The aliases to add to the kept application, in order: each removed application's aliases, then its own name.
export function aliasesToKeep(
  kept: Application,
  keptAliases: ApplicationAlias[],
  removed: { app: Application; aliases: ApplicationAlias[] }[],
): ApplicationAlias[] {
  const known = new Set([kept, ...keptAliases].map((n) => matchKey(n.company, n.role)));
  const added: ApplicationAlias[] = [];
  for (const { app, aliases } of removed) {
    for (const name of [...aliases, { company: app.company, role: app.role }]) {
      const key = matchKey(name.company, name.role);
      if (known.has(key)) continue;
      known.add(key);
      added.push({ company: name.company, role: name.role });
    }
  }
  return added;
}

// The application the merge dialog offers to keep: the furthest stage, so the Dashboard keeps the stage the
// user reached; on a tie the newest.
export function keepCandidate(apps: Application[]): string {
  const best = [...apps].sort(
    (a, b) => stageOf(b.status) - stageOf(a.status) || Date.parse(b.created_at) - Date.parse(a.created_at),
  )[0];
  if (!best) throw new Error('No applications to choose from');
  return best.id;
}
