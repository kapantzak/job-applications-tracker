// Profile name and slug rules (SOW-0015). Pure functions with no Node imports, so the UI shares them.

export const PROFILE_NAME_MAX = 80;
export const PROFILE_NAME_HINT = 'Letters, numbers and spaces only.';
export const PROFILE_NAME_ERROR = 'Use only letters, numbers and single spaces.';

// Letters and digits of any script, words separated by single spaces. Combining marks may follow a
// letter or digit: Indic vowel signs and viramas have no precomposed form.
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?: [\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u;

// Accents of Latin, Greek and Cyrillic letters once decomposed; other scripts' marks carry meaning.
const ACCENTS = /[\u0300-\u036f]+/g;

// Length and cuts count characters (code points), so a cut never splits a surrogate pair.
const chars = (text: string): string[] => Array.from(text);

// `new` would be shadowed by the /profiles/new route.
export const RESERVED_SLUGS: readonly string[] = ['new'];

// NFC first, so a letter typed as base + combining accent counts as one letter.
export function normalizeProfileName(name: string): string {
  return name.normalize('NFC').trim();
}

export function isValidProfileName(name: string): boolean {
  return chars(name).length <= PROFILE_NAME_MAX && NAME_PATTERN.test(name);
}

// Cuts to at most `max` characters without splitting one, and drops trailing spaces.
export function cutProfileName(name: string, max: number): string {
  return chars(name).slice(0, max).join('').trimEnd();
}

// Turns any stored name into a valid one: other characters become spaces, spaces collapse.
export function cleanProfileName(name: string): string {
  const spaced = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    // A mark with no letter before it cannot start a word.
    .replace(/(^| )\p{M}+/gu, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
  const cleaned = cutProfileName(spaced, PROFILE_NAME_MAX);
  return cleaned === '' ? 'Profile' : cleaned;
}

// Lowercase, Latin/Greek/Cyrillic accents dropped, letters, marks and digits of any script kept,
// everything else a single hyphen. Recomposed (NFC), so it matches what a keyboard types in a URL.
export function slugBase(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(ACCENTS, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'profile' : base;
}

// First free candidate: base, base-2, base-3, ... skipping reserved and taken slugs.
export function uniqueSlug(base: string, isTaken: (slug: string) => boolean): string {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!RESERVED_SLUGS.includes(candidate) && !isTaken(candidate)) return candidate;
  }
}
