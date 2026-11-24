import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aliasesToKeep, keepCandidate, mergedFields } from '../../../src/server/domain/merge.js';
import type { Application } from '../../../src/server/domain/types.js';

function app(over: Partial<Application>): Application {
  return {
    id: 'app-x',
    profile_id: 'pf1',
    job_id: null,
    company: 'Acme',
    role: 'Engineer',
    url: null,
    status: 'applied',
    applied_at: null,
    status_changed_at: '2026-11-01T00:00:00.000Z',
    notes: null,
    sender_domains: [],
    created_at: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

describe('mergedFields', () => {
  it('keeps the kept application\'s URL, job and applied date when it has them', () => {
    const kept = app({ url: 'https://acme.example/1', job_id: 'job-1', applied_at: '2026-11-03T00:00:00.000Z' });
    const other = app({ url: 'https://acme.example/2', job_id: 'job-2', applied_at: '2026-11-01T00:00:00.000Z' });
    expect(mergedFields(kept, [other])).toMatchObject({
      url: 'https://acme.example/1',
      job_id: 'job-1',
      applied_at: '2026-11-03T00:00:00.000Z',
    });
  });

  it('fills URL and job each from the first removed application that has one', () => {
    const kept = app({});
    const first = app({ id: 'a', job_id: 'job-1' });
    const second = app({ id: 'b', url: 'https://acme.example/2', job_id: 'job-2' });
    expect(mergedFields(kept, [first, second])).toMatchObject({ url: 'https://acme.example/2', job_id: 'job-1' });
  });

  it('takes the earliest removed applied date when the kept one has none', () => {
    const kept = app({ status: 'interview' });
    const later = app({ applied_at: '2026-11-05T00:00:00.000Z' });
    const earlier = app({ applied_at: '2026-11-02T00:00:00.000Z' });
    expect(mergedFields(kept, [app({}), later, earlier]).applied_at).toBe('2026-11-02T00:00:00.000Z');
  });

  it('leaves a saved kept application without an applied date', () => {
    const kept = app({ status: 'saved' });
    expect(mergedFields(kept, [app({ applied_at: '2026-11-02T00:00:00.000Z' })]).applied_at).toBeNull();
  });

  it('keeps a saved kept application\'s own applied date', () => {
    const kept = app({ status: 'saved', applied_at: '2026-11-04T00:00:00.000Z' });
    expect(mergedFields(kept, [app({ applied_at: '2026-11-02T00:00:00.000Z' })]).applied_at).toBe('2026-11-04T00:00:00.000Z');
  });

  it('combines sender domains, kept ones first, without repeats', () => {
    const kept = app({ sender_domains: ['acme.example'] });
    const other = app({ sender_domains: ['jobs.acme.example', 'acme.example'] });
    expect(mergedFields(kept, [other]).sender_domains).toEqual(['acme.example', 'jobs.acme.example']);
  });

  it('joins non-blank notes with a blank line and keeps identical notes once', () => {
    const kept = app({ notes: 'Phone screen done' });
    const others = [app({ notes: '  ' }), app({ notes: 'Asked for references' }), app({ notes: 'Phone screen done' })];
    expect(mergedFields(kept, others).notes).toBe('Phone screen done\n\nAsked for references');
  });

  it('gives null notes when every note is blank', () => {
    expect(mergedFields(app({ notes: '' }), [app({ notes: null })]).notes).toBeNull();
  });
});

describe('aliasesToKeep', () => {
  it('adds each removed application\'s aliases, then its own name', () => {
    const kept = app({ role: 'Senior Engineer' });
    const removed = [{ app: app({ role: 'Engineer (React)' }), aliases: [{ company: 'Acme', role: 'Frontend Dev' }] }];
    expect(aliasesToKeep(kept, [], removed)).toEqual([
      { company: 'Acme', role: 'Frontend Dev' },
      { company: 'Acme', role: 'Engineer (React)' },
    ]);
  });

  it('skips names equal to the kept name or a kept alias, ignoring case and blanks, and repeats', () => {
    const kept = app({ role: 'Senior Engineer' });
    const removed = [
      { app: app({ role: 'senior  engineer' }), aliases: [] },
      { app: app({ role: 'Dev' }), aliases: [{ company: 'ACME', role: 'dev' }] },
      { app: app({ role: 'Ops' }), aliases: [] },
    ];
    expect(aliasesToKeep(kept, [{ company: 'Acme', role: 'Ops' }], removed)).toEqual([{ company: 'ACME', role: 'dev' }]);
  });
});

describe('keepCandidate', () => {
  it('picks the furthest stage', () => {
    expect(keepCandidate([app({ id: 'a', status: 'screening' }), app({ id: 'b', status: 'interview' })])).toBe('b');
  });

  it('picks the newest of two at the same stage', () => {
    const older = app({ id: 'a', status: 'interview', created_at: '2026-11-01T00:00:00.000Z' });
    const newer = app({ id: 'b', status: 'interview', created_at: '2026-11-04T00:00:00.000Z' });
    expect(keepCandidate([older, newer])).toBe('b');
    expect(keepCandidate([newer, older])).toBe('b');
  });
});

// The merge dialog imports these rules into the browser bundle, so they must never reach the database layer
// (it pulls in node:crypto).
describe('merge rules in the browser bundle', () => {
  it('reach no module under src/server/db', () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const [, spec] of readFileSync(file, 'utf8').matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.[^']+)'/gms)) {
        visit(resolve(dirname(file), spec!.replace(/\.js$/, '.ts')));
      }
    };
    visit(resolve('src/server/domain/merge.ts'));
    visit(resolve('src/server/domain/new-application.ts'));
    expect([...seen].filter((f) => f.includes('/src/server/db/'))).toEqual([]);
  });
});
