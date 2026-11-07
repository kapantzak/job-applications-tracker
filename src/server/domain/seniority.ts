// Seniority choices (SOW-0023, decisions 27-29). Pure functions with no Node imports, so the UI shares them.
// The profile keeps seniority as one text field: chosen levels in list order, then any other text,
// joined with ", ". Discovery reads that text as it always has.

export const SENIORITY_LEVELS = [
  'Intern',
  'Junior',
  'Mid-level',
  'Senior',
  'Staff',
  'Principal',
  'Lead',
  'Manager',
  'Director',
  'Executive',
] as const;

export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export interface SenioritySelection {
  levels: SeniorityLevel[];
  // Everything that is not one of the levels, as typed.
  other: string;
}

const byLowerCase = new Map<string, SeniorityLevel>(SENIORITY_LEVELS.map((l) => [l.toLowerCase(), l]));

export function seniorityLevel(text: string): SeniorityLevel | undefined {
  return byLowerCase.get(text.trim().toLowerCase());
}

// Parts that name a level become chips; the rest stays as Other text, so a stored free-text value
// such as "Senior, ideally Staff" survives a load and save.
export function splitSeniority(value: string): SenioritySelection {
  const levels = new Set<SeniorityLevel>();
  const other: string[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const level = seniorityLevel(trimmed);
    if (level) levels.add(level);
    else other.push(trimmed);
  }
  return { levels: SENIORITY_LEVELS.filter((l) => levels.has(l)), other: other.join(', ') };
}

export function joinSeniority({ levels, other }: SenioritySelection): string {
  const chosen = new Set(levels);
  return [...SENIORITY_LEVELS.filter((l) => chosen.has(l)), other.trim()].filter((p) => p !== '').join(', ');
}
