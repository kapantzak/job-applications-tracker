import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../../src/ui/default-profile.js';

const alpha = { id: 'pa', slug: 'alpha-roles' };
const beta = { id: 'pb', slug: 'beta-roles' };

describe('defaultProfile', () => {
  it('returns the stored profile when it exists', () => {
    expect(defaultProfile([alpha, beta], 'pb')).toBe(beta);
  });

  it('returns the only profile when nothing valid is stored', () => {
    expect(defaultProfile([alpha], '')).toBe(alpha);
    expect(defaultProfile([alpha], 'deleted')).toBe(alpha);
  });

  it('returns null for several profiles without a valid stored one, and for none', () => {
    expect(defaultProfile([alpha, beta], '')).toBeNull();
    expect(defaultProfile([alpha, beta], 'deleted')).toBeNull();
    expect(defaultProfile([], 'pa')).toBeNull();
  });
});
