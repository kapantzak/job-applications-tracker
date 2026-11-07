import { describe, expect, it } from 'vitest';
import { joinSeniority, SENIORITY_LEVELS, splitSeniority } from '../../../src/server/domain/seniority.js';

describe('seniority', () => {
  it('offers the ten levels in ladder order', () => {
    expect(SENIORITY_LEVELS).toEqual([
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
    ]);
  });

  it('splits stored text into levels, ignoring case, and other text', () => {
    expect(splitSeniority('staff, Senior')).toEqual({ levels: ['Senior', 'Staff'], other: '' });
    expect(splitSeniority('Senior, ideally Staff')).toEqual({ levels: ['Senior'], other: 'ideally Staff' });
    expect(splitSeniority('')).toEqual({ levels: [], other: '' });
    expect(splitSeniority(' , ')).toEqual({ levels: [], other: '' });
  });

  it('joins levels in ladder order, then other text', () => {
    expect(joinSeniority({ levels: ['Staff', 'Senior'], other: '' })).toBe('Senior, Staff');
    expect(joinSeniority({ levels: ['Lead'], other: '  tech lead ' })).toBe('Lead, tech lead');
    expect(joinSeniority({ levels: [], other: '' })).toBe('');
  });

  it('saves a free-text value that is not on the list back unchanged', () => {
    for (const value of ['Senior, ideally Staff', 'IC4 or IC5', 'Lead, Tech']) {
      expect(joinSeniority(splitSeniority(value))).toBe(value);
    }
  });
});
