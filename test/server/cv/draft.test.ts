import { describe, expect, it } from 'vitest';
import { toProfileDraft } from '../../../src/server/cv/draft.js';
import { AnalyseCvOutput } from '../../../src/server/tasks/schemas.js';

const output = (overrides: Record<string, unknown> = {}) =>
  AnalyseCvOutput.parse({
    name: 'Senior Backend Engineer',
    target_roles: ['Backend Engineer', 'Platform Engineer'],
    locations: ['Lisbon'],
    remote: 'remote',
    seniority: ['senior', 'Staff'],
    keywords: ['TypeScript', 'PostgreSQL'],
    notes: 'Eight years of backend work.',
    ...overrides,
  });

describe('toProfileDraft', () => {
  it('keeps a well-formed answer and joins seniority as the profile form saves it', () => {
    expect(toProfileDraft(output())).toEqual({
      name: 'Senior Backend Engineer',
      target_roles: ['Backend Engineer', 'Platform Engineer'],
      locations: ['Lisbon'],
      remote: 'remote',
      seniority: 'Senior, Staff',
      keywords: ['TypeScript', 'PostgreSQL'],
      notes: 'Eight years of backend work.',
    });
  });

  it('drops a suggested name that fails the profile-name rule', () => {
    expect(toProfileDraft(output({ name: 'Backend / Platform' })).name).toBe('');
    expect(toProfileDraft(output({ name: '  Platform roles  ' })).name).toBe('Platform roles');
  });

  it('puts levels in list order and keeps other words after them', () => {
    expect(toProfileDraft(output({ seniority: ['Staff', 'tech lead', 'Senior'] })).seniority).toBe('Senior, Staff, tech lead');
    expect(toProfileDraft(output({ seniority: [] })).seniority).toBe('');
  });

  it('trims lists, drops empty and repeated entries and bounds their size', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Skill ${i}`);
    const draft = toProfileDraft(
      output({ target_roles: ['  Backend   Engineer ', '', 'backend engineer', 'x'.repeat(150)], keywords: many }),
    );
    expect(draft.target_roles).toEqual(['Backend Engineer', 'x'.repeat(100)]);
    expect(draft.keywords).toHaveLength(20);
  });

  it('fills defaults for fields the agent left out', () => {
    expect(toProfileDraft(AnalyseCvOutput.parse({}))).toEqual({
      name: '',
      target_roles: [],
      locations: [],
      remote: 'any',
      seniority: '',
      keywords: [],
      notes: '',
    });
  });
});
