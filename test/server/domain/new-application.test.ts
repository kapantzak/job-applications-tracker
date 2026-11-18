import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanName,
  cleanSenderDomain,
  gmailDay,
  matchKey,
  toAppliedAt,
  toChangedAt,
} from '../../../src/server/domain/new-application.js';

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe('new application helpers', () => {
  it('cleanName trims and collapses blanks but keeps case', () => {
    expect(cleanName('  Acme \t Corp\n ')).toBe('Acme Corp');
    expect(cleanName('   ')).toBe('');
  });

  it('matchKey ignores case and blanks', () => {
    expect(matchKey(' ACME  corp ', 'Senior   Engineer')).toBe(matchKey('Acme Corp', 'senior engineer'));
    expect(matchKey('Acme', 'Engineer')).not.toBe(matchKey('Acme', 'Engineer II'));
  });

  it.each([
    ['acme.example.com', 'acme.example.com'],
    [' @Acme.Example.com ', 'acme.example.com'],
    ['www.acme.example.com', 'acme.example.com'],
    ['mail.greenhouse.io', null],
    ['linkedin.com', null],
    ['', null],
    ['not a domain', null],
    ['localhost', null],
    ['gmail.com', null],
    ['acme.wd5.myworkdayjobs.com', null],
    ['talent.icims.com', null],
    ['Outlook.com', null],
    ['proton.me', null],
  ])('cleanSenderDomain(%j) is %j', (input, expected) => {
    expect(cleanSenderDomain(input)).toBe(expected);
  });

  it.each(['America/Los_Angeles', 'Asia/Tokyo'])('toAppliedAt stores a YYYY-MM-DD day as local midnight in %s', (tz) => {
    process.env.TZ = tz;
    expect(toAppliedAt('2026-03-04', '', new Date())).toBe(new Date(2026, 2, 4).toISOString());
  });

  it('toAppliedAt falls back to a full timestamp, then the evidence date, then now', () => {
    const now = new Date('2026-11-11T10:00:00.000Z');
    expect(toAppliedAt('2026-03-04T08:30:00Z', '', now)).toBe('2026-03-04T08:30:00.000Z');
    expect(toAppliedAt('2026-02-30', '2026-03-05T09:00:00Z', now)).toBe('2026-03-05T09:00:00.000Z');
    expect(toAppliedAt('soon', 'yesterday', now)).toBe(now.toISOString());
  });

  it('toAppliedAt never returns a future date (S7)', () => {
    const now = new Date('2026-11-11T10:00:00.000Z');
    expect(toAppliedAt('2027-01-01T00:00:00Z', '', now)).toBe(now.toISOString());
  });

  it('toChangedAt takes the latest email date, kept between the applied date and now (decision 16A)', () => {
    const now = new Date('2026-11-11T10:00:00.000Z');
    const applied = '2026-03-01T00:00:00.000Z';
    expect(toChangedAt('2026-04-02T09:00:00Z', applied, now)).toBe('2026-04-02T09:00:00.000Z');
    expect(toChangedAt('2026-02-01T09:00:00Z', applied, now)).toBe(applied);
    expect(toChangedAt('2027-02-01T09:00:00Z', applied, now)).toBe(now.toISOString());
    expect(toChangedAt('unknown', applied, now)).toBe(now.toISOString());
  });

  it('gmailDay formats a local day for Gmail search', () => {
    expect(gmailDay(new Date(2026, 7, 3))).toBe('2026/08/03');
  });
});
