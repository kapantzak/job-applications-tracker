import { describe, expect, it } from 'vitest';
import { stageOf } from '../../../src/server/domain/stage.js';

describe('stageOf', () => {
  it('ranks statuses as sync does when it creates a proposal', () => {
    expect(
      ['saved', 'applied', 'no_response', 'screening', 'interview', 'offer', 'rejected', 'withdrawn', 'no_change'].map(stageOf),
    ).toEqual([0, 1, 1, 2, 3, 4, 5, 0, 0]);
  });
});
