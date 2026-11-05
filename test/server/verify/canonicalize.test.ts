import { describe, expect, it } from 'vitest';
import { canonicalUrl, dedupeKey } from '../../../src/server/verify/canonicalize.js';

const A = 'https://Boards.Greenhouse.io/acme/jobs/123?utm_source=x';
const B = 'https://boards.greenhouse.io/acme/jobs/123/';

describe('canonicalUrl', () => {
  it('treats tracking-param and trailing-slash variants as equal', () => {
    expect(canonicalUrl(A)).toBe(canonicalUrl(B));
    expect(canonicalUrl(A)).toBe('https://boards.greenhouse.io/acme/jobs/123');
  });

  it('drops hash, default port and tracking params, sorts the rest', () => {
    expect(
      canonicalUrl('HTTPS://Example.com:443/Jobs/?b=2&UTM_x=1&a=1&gh_src=z&a=0#frag'),
    ).toBe('https://example.com/Jobs?a=0&a=1&b=2');
  });

  it('keeps the root slash', () => {
    expect(canonicalUrl('https://example.com/?ref=x')).toBe('https://example.com/');
  });

  it('throws on unparseable input', () => {
    expect(() => canonicalUrl('not a url')).toThrow();
  });
});

describe('dedupeKey', () => {
  it('returns the canonical url when present', () => {
    const job = { canonical_url: A, company: 'x', title: 'y', location: 'z' };
    expect(dedupeKey(job)).toBe(A);
    expect(dedupeKey({ ...job, canonical_url: canonicalUrl(A) })).toBe(
      dedupeKey({ ...job, canonical_url: canonicalUrl(B) }),
    );
  });

  it('falls back to normalised company|title|location', () => {
    expect(
      dedupeKey({ canonical_url: null, company: ' Acme  Corp ', title: 'Senior Engineer', location: 'Berlin' }),
    ).toBe('acme corp|senior engineer|berlin');
    expect(
      dedupeKey({ canonical_url: '', company: 'Zoé', title: 'T', location: 'Zürich' }),
    ).toBe('zoe|t|zurich');
  });
});
