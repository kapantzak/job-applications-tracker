import { describe, expect, it } from 'vitest';
import {
  cleanProfileName,
  isValidProfileName,
  normalizeProfileName,
  slugBase,
  uniqueSlug,
} from '../../../src/server/domain/profile-name.js';

// Written as escapes so the source never depends on how an editor stores accents.
const CAFE_DECOMPOSED = 'Café';
const CAFE = 'Café';
const BOLD_B = '\u{1d401}'; // one character, two UTF-16 units

describe('profile name rule', () => {
  it.each([
    'Data roles',
    'Platform 2',
    'Μηχανικός λογισμικού',
    CAFE,
    CAFE_DECOMPOSED,
    '42',
    'a'.repeat(80),
    'हिन्दी डेवलपर',
    'தமிழ்',
    '한국 개발',
    BOLD_B.repeat(80),
  ])('accepts %j', (name) => {
    expect(isValidProfileName(name)).toBe(true);
  });

  it.each([
    '',
    ' Data',
    'Data ',
    'Data  roles',
    'Data-roles',
    'SRE / Platform',
    'C++',
    'tab\tname',
    'a'.repeat(81),
    '́a',
    'x िy',
    BOLD_B.repeat(81),
  ])('rejects %j', (name) => {
    expect(isValidProfileName(name)).toBe(false);
  });

  it('normalizes to NFC and trims, so a decomposed accent is stored as one letter', () => {
    expect(normalizeProfileName(` ${CAFE_DECOMPOSED} `)).toBe(CAFE);
  });

  it('cleans invalid names into valid ones, keeping marks that belong to a letter', () => {
    expect(cleanProfileName('Senior SRE / Platform')).toBe('Senior SRE Platform');
    expect(cleanProfileName('  C++ -- dev  ')).toBe('C dev');
    expect(cleanProfileName('!!!')).toBe('Profile');
    expect(cleanProfileName('हिन्दी / डेवलपर')).toBe('हिन्दी डेवलपर');
    expect(cleanProfileName('́ abc')).toBe('abc');
    expect(isValidProfileName(cleanProfileName(`${'x'.repeat(79)} y z`))).toBe(true);
  });

  it('cuts long names by character, never splitting one', () => {
    const cut = cleanProfileName(`${'a'.repeat(79)}${BOLD_B}${BOLD_B}`);
    expect(cut).toBe(`${'a'.repeat(79)}${BOLD_B}`);
    expect(isValidProfileName(cut)).toBe(true);
  });
});

describe('profile slugs', () => {
  it('lowercases, drops Latin and Greek accents, keeps any script and joins words with hyphens', () => {
    expect(slugBase('Data roles')).toBe('data-roles');
    expect(slugBase(`${CAFE} Crème 2`)).toBe('cafe-creme-2');
    expect(slugBase(CAFE_DECOMPOSED)).toBe('cafe');
    expect(slugBase('Μηχανικός λογισμικού')).toBe('μηχανικος-λογισμικου');
    expect(slugBase('  --  ')).toBe('profile');
  });

  it('keeps marks other scripts need and returns composed (NFC) text', () => {
    expect(slugBase('हिन्दी डेवलपर')).toBe('हिन्दी-डेवलपर');
    const korean = slugBase('한국 개발');
    expect(korean).toBe('한국-개발');
    expect(korean).toBe(korean.normalize('NFC'));
    expect(slugBase('ガス')).not.toBe(slugBase('カス'));
  });

  it('numbers clashes and never hands out a reserved slug', () => {
    const taken = new Set(['data-roles', 'data-roles-2']);
    expect(uniqueSlug('data-roles', (s) => taken.has(s))).toBe('data-roles-3');
    expect(uniqueSlug('fresh', (s) => taken.has(s))).toBe('fresh');
    expect(uniqueSlug('new', () => false)).toBe('new-2');
  });
});
