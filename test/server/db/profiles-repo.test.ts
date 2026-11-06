import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createProfilesRepo, ProfileNotFoundError, type ProfileInput } from '../../../src/server/db/profiles-repo.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  return { db, repo: createProfilesRepo(db) };
}

const input: ProfileInput = {
  name: 'Lead roles',
  target_roles: ['Staff Engineer', 'Tech Lead'],
  locations: ['Berlin', 'Athens'],
  remote: 'hybrid',
  seniority: 'senior',
  keywords: ['typescript', 'node'],
  excluded_companies: ['Acme'],
  notes: 'prefer small teams',
};

describe('profiles repo', () => {
  it('lists nothing and gets null on an empty database', () => {
    const { repo } = setup();
    expect(repo.list()).toEqual([]);
    expect(repo.get('missing')).toBeNull();
  });

  it('creates profiles with uuid ids and round-trips list fields', () => {
    const { repo } = setup();
    const created = repo.create(input);
    expect(created).toMatchObject(input);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(created.created_at).toISOString()).toBe(created.created_at);
    expect(repo.get(created.id)).toEqual(created);
  });

  it('lists by name ignoring case, with zero counts for a new profile', () => {
    const { repo } = setup();
    repo.create({ ...input, name: 'beta' });
    repo.create({ ...input, name: 'Alpha' });
    expect(repo.list().map((p) => [p.name, p.counts])).toEqual([
      ['Alpha', { jobs: 0, applications: 0, runs: 0 }],
      ['beta', { jobs: 0, applications: 0, runs: 0 }],
    ]);
  });

  it('update replaces the fields and keeps id and created_at; unknown ids throw', () => {
    const { repo } = setup();
    const first = repo.create(input);
    const second = repo.update(first.id, { ...input, name: 'Architect roles', remote: 'remote' });
    expect(second).toMatchObject({ id: first.id, created_at: first.created_at, name: 'Architect roles', remote: 'remote' });
    expect(() => repo.update('missing', input)).toThrow('Profile not found: missing');
  });

  it('nameTaken ignores ASCII case and the profile being edited, and the index enforces it', () => {
    const { repo } = setup();
    const p = repo.create(input);
    expect(repo.nameTaken('LEAD ROLES')).toBe(true);
    expect(repo.nameTaken('lead roles', p.id)).toBe(false);
    expect(repo.nameTaken('Other')).toBe(false);
    expect(() => repo.create({ ...input, name: 'LEAD roles' })).toThrow(/UNIQUE/);
  });

  it('rejects a blank name at the database level', () => {
    const { repo } = setup();
    expect(() => repo.create({ ...input, name: '  ' })).toThrow(/CHECK/);
  });

  it('update and remove throw ProfileNotFoundError for an unknown profile', () => {
    const { repo } = setup();
    expect(() => repo.remove('missing')).toThrow(ProfileNotFoundError);
    expect(() => repo.update('missing', input)).toThrow(ProfileNotFoundError);
  });
});
