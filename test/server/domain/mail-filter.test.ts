import { describe, expect, it } from 'vitest';
import {
  MAIL_FILTER_MAX,
  mailFilterError,
  mailScopeQuery,
  normalizeMailFilter,
} from '../../../src/server/domain/mail-filter.js';

describe('mail filter rule', () => {
  it.each([
    ['label', ''],
    ['label', 'Jobs/Frontend'],
    ['label', 'Μηχανικός'],
    ['label', 'x'.repeat(MAIL_FILTER_MAX)],
    ['query', 'label:jobs-frontend OR to:you+frontend@example.com'],
    ['query', 'label:"Board Prep" -in:sent'],
  ] as const)('accepts %s %j', (kind, value) => {
    expect(mailFilterError(kind, value)).toBeNull();
  });

  it('counts characters, not UTF-16 units', () => {
    expect(mailFilterError('label', '\u{1d401}'.repeat(MAIL_FILTER_MAX))).toBeNull();
    expect(mailFilterError('label', '\u{1d401}'.repeat(MAIL_FILTER_MAX + 1))).toBe(
      `Use at most ${MAIL_FILTER_MAX} characters.`,
    );
  });

  it.each(['a\nb', 'a\tb', 'a\rb', 'a b', 'a\u0000b'])('refuses a line break or control character in %j', (value) => {
    expect(mailFilterError('query', value)).toBe('Use a single line without control characters.');
    expect(mailFilterError('label', value)).toBe('Use a single line without control characters.');
  });

  it('refuses double quotes in a label but not in a query', () => {
    expect(mailFilterError('label', 'Board "Prep"')).toBe('A label name cannot contain double quotes.');
    expect(mailFilterError('query', 'label:"Board Prep"')).toBeNull();
  });

  it('trims surrounding spaces', () => {
    expect(normalizeMailFilter('  Jobs/Frontend \t')).toBe('Jobs/Frontend');
  });
});

describe('mailScopeQuery', () => {
  it('is null when there is no scope', () => {
    expect(mailScopeQuery('label', '')).toBeNull();
    expect(mailScopeQuery('query', '   ')).toBeNull();
  });

  it('turns a label name into the hyphen form Gmail matches', () => {
    expect(mailScopeQuery('label', 'Jobs')).toBe('label:Jobs');
    expect(mailScopeQuery('label', 'Jobs/Frontend')).toBe('label:Jobs-Frontend');
    expect(mailScopeQuery('label', 'Board Prep')).toBe('label:Board-Prep');
    // Each space and slash becomes one hyphen; quoting such a name matched nothing in Gmail.
    expect(mailScopeQuery('label', 'Jobs - Frontend')).toBe('label:Jobs---Frontend');
    expect(mailScopeQuery('label', 'Μηχανικός')).toBe('label:Μηχανικός');
  });

  it('passes a query through as typed, trimmed', () => {
    expect(mailScopeQuery('query', ' to:you+frontend@example.com OR label:jobs ')).toBe(
      'to:you+frontend@example.com OR label:jobs',
    );
  });
});
