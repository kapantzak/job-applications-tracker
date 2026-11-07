import { describe, expect, it } from 'vitest';
import { extractClaudeUsage, extractCodexUsage, sumUsage } from '../../../src/server/agents/usage.js';

const lines = (...events: unknown[]) => events.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n');

describe('extractClaudeUsage', () => {
  it('reads cost and sums tokens over models, counting cache reads and writes as input', () => {
    const out = lines(
      { type: 'system', subtype: 'init' },
      {
        type: 'result',
        total_cost_usd: 0.5,
        usage: { input_tokens: 1, output_tokens: 1 },
        modelUsage: {
          'model-a': { inputTokens: 2, cacheReadInputTokens: 30, cacheCreationInputTokens: 400, outputTokens: 5 },
          'model-b': { inputTokens: 1, outputTokens: 2 },
        },
      },
    );
    expect(extractClaudeUsage(out)).toEqual({ costUsd: 0.5, inputTokens: 433, outputTokens: 7 });
  });

  it('falls back to the main-loop usage when modelUsage is missing', () => {
    const out = lines({
      type: 'result',
      usage: { input_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 4 },
    });
    expect(extractClaudeUsage(out)).toEqual({ inputTokens: 13, outputTokens: 4 });
  });

  it('uses the last result event and ignores prose and bad numbers', () => {
    const out = lines(
      'not json',
      { type: 'result', total_cost_usd: 9 },
      { type: 'result', total_cost_usd: -1, modelUsage: { m: { outputTokens: 'x', inputTokens: 7 } } },
    );
    expect(extractClaudeUsage(out)).toEqual({ inputTokens: 7 });
  });

  it('is undefined without a result event or without any usage field', () => {
    expect(extractClaudeUsage(lines({ type: 'assistant' }))).toBeUndefined();
    expect(extractClaudeUsage(lines({ type: 'result', subtype: 'success' }))).toBeUndefined();
  });
});

describe('extractCodexUsage', () => {
  it('takes the last turn.completed because it is a running total', () => {
    const out = lines(
      { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 } },
      { type: 'item.completed' },
      { type: 'turn.completed', usage: { input_tokens: 300, cached_input_tokens: 200, output_tokens: 25 } },
    );
    expect(extractCodexUsage(out)).toEqual({ inputTokens: 300, outputTokens: 25 });
  });

  it('is undefined when turn.completed carries no usage', () => {
    expect(extractCodexUsage(lines({ type: 'turn.completed' }))).toBeUndefined();
    expect(extractCodexUsage('')).toBeUndefined();
  });
});

describe('sumUsage', () => {
  it('adds fields that any worker reported and skips missing workers', () => {
    expect(
      sumUsage([{ costUsd: 0.1, inputTokens: 10 }, undefined, { costUsd: 0.2, outputTokens: 3 }]),
    ).toEqual({ costUsd: 0.1 + 0.2, inputTokens: 10, outputTokens: 3 });
  });

  it('is undefined when nothing was reported', () => {
    expect(sumUsage([undefined, {}])).toBeUndefined();
  });
});
