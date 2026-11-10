import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { insertTestProfile } from './test-profile.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const pid = insertTestProfile(db);
  return { db, pid, repo: createRunsRepo(db) };
}

describe('runs repo', () => {
  it('creates default runs unless max is asked for, with no usage recorded', () => {
    const { pid, repo } = setup();
    const plain = repo.create('discover_jobs', pid, { adapter_id: '', prompt_version: null });
    const max = repo.create('discover_jobs', pid, { adapter_id: '', prompt_version: null, effort_mode: 'max' });
    expect(plain).toMatchObject({
      effort_mode: 'default',
      usage_cost_usd: null,
      usage_input_tokens: null,
      usage_output_tokens: null,
    });
    expect(repo.get(max.id)!.effort_mode).toBe('max');
  });

  it('updates the usage columns', () => {
    const { pid, repo } = setup();
    const run = repo.create('discover_jobs', pid, { adapter_id: '', prompt_version: null });
    const updated = repo.update(run.id, { usage_cost_usd: 1.25, usage_input_tokens: 1000, usage_output_tokens: 50 });
    expect(updated).toMatchObject({ usage_cost_usd: 1.25, usage_input_tokens: 1000, usage_output_tokens: 50 });
  });

  it('does not let a patch change the effort mode', () => {
    const { pid, repo } = setup();
    const run = repo.create('discover_jobs', pid, { adapter_id: '', prompt_version: null });
    repo.update(run.id, { effort_mode: 'max' } as never);
    expect(repo.get(run.id)!.effort_mode).toBe('default');
  });

  it('stores custom instructions only when given, and a patch cannot change them', () => {
    const { pid, repo } = setup();
    const plain = repo.create('discover_jobs', pid, { adapter_id: '', prompt_version: null });
    const custom = repo.create('discover_jobs', pid, {
      adapter_id: '',
      prompt_version: null,
      custom_prompt: 'Only fintech companies',
    });
    expect(plain.custom_prompt).toBeNull();
    expect(custom.custom_prompt).toBe('Only fintech companies');
    repo.update(custom.id, { custom_prompt: 'Something else' } as never);
    expect(repo.get(custom.id)!.custom_prompt).toBe('Only fintech companies');
  });
});
