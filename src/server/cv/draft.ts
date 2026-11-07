import { isValidProfileName, normalizeProfileName } from '../domain/profile-name.js';
import { joinSeniority, splitSeniority } from '../domain/seniority.js';
import type { CvProfileDraft } from '../domain/types.js';
import type { AnalyseCvResult } from '../tasks/schemas.js';

const MAX_ITEMS = 20;
const MAX_ITEM_CHARS = 100;
const MAX_NOTES_CHARS = 2000;

const cut = (text: string, max: number) => Array.from(text).slice(0, max).join('');

// Trimmed, non-empty, first spelling of each entry kept (ignoring case), bounded like a typed list.
function cleanList(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = cut(item.replace(/\s+/g, ' ').trim(), MAX_ITEM_CHARS).trim();
    const key = value.toLowerCase();
    if (value === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length === MAX_ITEMS) break;
  }
  return out;
}

// Agent output is untrusted: every field is bounded, and a name that fails the profile-name rule is
// dropped rather than repaired (decision 10). Excluded companies are never suggested (decision 17 scope).
export function toProfileDraft(output: AnalyseCvResult): CvProfileDraft {
  const name = normalizeProfileName(output.name);
  return {
    name: isValidProfileName(name) ? name : '',
    target_roles: cleanList(output.target_roles),
    locations: cleanList(output.locations),
    remote: output.remote,
    // Levels in list order, any other words after them, as the profile form saves it.
    seniority: joinSeniority(splitSeniority(cleanList(output.seniority).join(', '))),
    keywords: cleanList(output.keywords),
    notes: cut(output.notes.trim(), MAX_NOTES_CHARS).trim(),
  };
}
