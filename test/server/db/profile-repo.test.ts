import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createProfileRepo, type ProfileInput } from '../../../src/server/db/profile-repo.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  return { db, repo: createProfileRepo(db) };
}

const input: ProfileInput = {
  target_roles: ['Staff Engineer', 'Tech Lead'],
  locations: ['Berlin', 'Athens'],
  remote: 'hybrid',
  seniority: 'senior',
  keywords: ['typescript', 'node'],
  excluded_companies: ['Acme'],
  notes: 'prefer small teams',
};

describe('profile repo', () => {
  it('returns null on an empty database', () => {
    const { repo } = setup();
    expect(repo.get()).toBeNull();
  });

  it('round-trips list fields', () => {
    const { repo } = setup();
    const saved = repo.save(input);
    expect(saved).toMatchObject(input);
    expect(repo.get()).toEqual(saved);
    expect(new Date(saved.created_at).toISOString()).toBe(saved.created_at);
  });

  it('replaces on second save and keeps a single row and created_at', () => {
    const { db, repo } = setup();
    const first = repo.save(input);
    const second = repo.save({ ...input, target_roles: ['Architect'], remote: 'remote' });
    expect(second.target_roles).toEqual(['Architect']);
    expect(second.remote).toBe('remote');
    expect(second.created_at).toBe(first.created_at);
    expect((db.prepare('SELECT COUNT(*) AS n FROM profile').get() as { n: number }).n).toBe(1);
  });
});
