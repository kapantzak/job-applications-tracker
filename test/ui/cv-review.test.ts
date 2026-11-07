import { describe, expect, it } from 'vitest';
import type { CvProfileDraft } from '../../src/server/domain/types.js';
import type { ProfileInput } from '../../src/ui/api/client.js';
import { addItems, applyChoices, reviewRows } from '../../src/ui/cv-review.js';

const FORM: ProfileInput = {
  name: 'Platform roles',
  target_roles: ['Platform Engineer'],
  locations: ['Lisbon'],
  remote: 'remote',
  seniority: 'Senior',
  keywords: ['Kubernetes', 'Terraform'],
  excluded_companies: ['Initech'],
  notes: 'Typed by hand.',
};

const DRAFT: CvProfileDraft = {
  name: 'Something else',
  target_roles: ['Platform Engineer', 'Site Reliability Engineer'],
  locations: ['Porto'],
  remote: 'hybrid',
  seniority: 'Staff',
  keywords: ['terraform', 'Go'],
  notes: 'A summary from the CV.',
};

const fields = (rows: ReturnType<typeof reviewRows>) => rows.map((r) => r.field);

describe('reviewRows on Replace CV', () => {
  it('lists every differing field in form order with Keep current pre-selected, never name or notes', () => {
    const rows = reviewRows(FORM, DRAFT, 'replace');
    expect(fields(rows)).toEqual(['target_roles', 'locations', 'remote', 'seniority', 'keywords']);
    expect(rows.every((r) => r.initial === 'keep')).toBe(true);
  });

  it('treats the same items in another order or case as no change', () => {
    const rows = reviewRows(
      { ...FORM, keywords: ['Terraform', 'go'], target_roles: ['site reliability engineer', 'Platform Engineer'] },
      DRAFT,
      'replace',
    );
    expect(fields(rows)).toEqual(['locations', 'remote', 'seniority']);
  });

  it('compares seniority as the form saves it', () => {
    expect(fields(reviewRows({ ...FORM, seniority: 'staff' }, DRAFT, 'replace'))).not.toContain('seniority');
    expect(fields(reviewRows({ ...FORM, seniority: 'Staff, ' }, DRAFT, 'replace'))).not.toContain('seniority');
  });

  it('never offers to clear a field or to loosen Remote to Any', () => {
    const silent: CvProfileDraft = {
      ...DRAFT,
      target_roles: [],
      locations: [],
      remote: 'any',
      seniority: '',
      keywords: [],
    };
    expect(reviewRows(FORM, silent, 'replace')).toEqual([]);
  });

  it('offers Add the new items only when it would keep something and add something', () => {
    const rows = reviewRows(FORM, DRAFT, 'replace');
    expect(rows.find((r) => r.field === 'keywords')!.choices).toEqual(['keep', 'use', 'add']);
    expect(rows.find((r) => r.field === 'remote')!.choices).toEqual(['keep', 'use']);
    // Every suggested location is new, but a subset adds nothing.
    const subset = reviewRows({ ...FORM, keywords: ['Terraform', 'Go', 'Rust'] }, DRAFT, 'replace');
    expect(subset.find((r) => r.field === 'keywords')!.choices).toEqual(['keep', 'use']);
  });
});

describe('reviewRows on Add CV', () => {
  it('lists only the empty fields the CV can fill, with Use suggested pre-selected', () => {
    const form: ProfileInput = { ...FORM, locations: [], remote: 'any', keywords: [] };
    const rows = reviewRows(form, DRAFT, 'add');
    expect(fields(rows)).toEqual(['locations', 'remote', 'keywords']);
    expect(rows.every((r) => r.initial === 'use' && r.choices.join() === 'keep,use')).toBe(true);
  });
});

describe('applyChoices', () => {
  it('keeps the form for Keep current and unlisted fields, and writes the chosen suggestions', () => {
    const edited = { ...FORM, notes: 'An unsaved edit.' };
    const rows = reviewRows(edited, DRAFT, 'replace');
    const next = applyChoices(edited, rows, { target_roles: 'use', keywords: 'add', remote: 'use', seniority: 'keep' });
    expect(next).toEqual({
      ...edited,
      target_roles: ['Platform Engineer', 'Site Reliability Engineer'],
      keywords: ['Kubernetes', 'Terraform', 'Go'],
      remote: 'hybrid',
    });
  });

  it('uses each row pre-selection when no choice was made', () => {
    const form: ProfileInput = { ...FORM, locations: [] };
    expect(applyChoices(form, reviewRows(form, DRAFT, 'add'), {}).locations).toEqual(['Porto']);
    expect(applyChoices(FORM, reviewRows(FORM, DRAFT, 'replace'), {})).toEqual(FORM);
  });
});

describe('addItems', () => {
  it('appends new items after the current ones, ignoring case', () => {
    expect(addItems(['Go', 'Rust'], ['rust', 'Zig', 'zig'])).toEqual(['Go', 'Rust', 'Zig']);
  });
});
