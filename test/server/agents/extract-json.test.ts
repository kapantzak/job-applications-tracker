import { describe, expect, it } from 'vitest';
import {
  NoJsonFoundError,
  extractClaudeInitModel,
  extractClaudeStructuredOutput,
  extractLastJsonObject,
} from '../../../src/server/agents/extract-json.js';

describe('extractLastJsonObject', () => {
  it('parses a fenced json block', () => {
    expect(extractLastJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses a bare fenced block', () => {
    expect(extractLastJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('skips prose before the object', () => {
    expect(extractLastJsonObject('Here you go:\n{"a":1}')).toEqual({ a: 1 });
  });

  it('throws NoJsonFoundError on plain text', () => {
    expect(() => extractLastJsonObject('no json here')).toThrow(NoJsonFoundError);
  });

  it('returns the last top-level object, not a nested one', () => {
    expect(extractLastJsonObject('{"a":1}\nthen\n{"b":{"c":2}}')).toEqual({ b: { c: 2 } });
  });

  it('ignores braces inside string literals', () => {
    expect(extractLastJsonObject('x {"s":"}{\\"}"} y')).toEqual({ s: '}{"}' });
  });

  it('recovers from an unbalanced brace in prose', () => {
    expect(extractLastJsonObject('use {placeholder syntax then {"a":1}')).toEqual({ a: 1 });
  });

  it('does not fall back to an earlier object when the last one does not parse', () => {
    expect(() => extractLastJsonObject('{"a":1} and {not json}')).toThrow(NoJsonFoundError);
  });
});

describe('extractClaudeStructuredOutput', () => {
  it('returns structured_output from the result line', () => {
    const ndjson = [
      JSON.stringify({ type: 'system' }),
      'not json',
      JSON.stringify({ type: 'assistant' }),
      JSON.stringify({ type: 'result', structured_output: { jobs: [] } }),
    ].join('\n');
    expect(extractClaudeStructuredOutput(ndjson)).toEqual({ jobs: [] });
  });

  it('uses the last result line', () => {
    const ndjson = [
      JSON.stringify({ type: 'result', structured_output: { n: 1 } }),
      JSON.stringify({ type: 'result', structured_output: { n: 2 } }),
    ].join('\n');
    expect(extractClaudeStructuredOutput(ndjson)).toEqual({ n: 2 });
  });

  it('falls back to JSON inside the result text', () => {
    const ndjson = JSON.stringify({ type: 'result', result: 'Done:\n```json\n{"a":1}\n```' });
    expect(extractClaudeStructuredOutput(ndjson)).toEqual({ a: 1 });
  });

  it('throws NoJsonFoundError without a result line', () => {
    expect(() => extractClaudeStructuredOutput(JSON.stringify({ type: 'system' }))).toThrow(NoJsonFoundError);
  });
});

describe('extractClaudeInitModel', () => {
  it('returns the model of the init event', () => {
    const ndjson = [
      'not json',
      JSON.stringify({ type: 'system', subtype: 'init', model: 'model-a' }),
      JSON.stringify({ type: 'result', structured_output: {} }),
    ].join('\n');
    expect(extractClaudeInitModel(ndjson)).toBe('model-a');
  });

  it('returns undefined without an init event or without a model string', () => {
    expect(extractClaudeInitModel(JSON.stringify({ type: 'result' }))).toBeUndefined();
    expect(extractClaudeInitModel(JSON.stringify({ type: 'system', subtype: 'init', model: 42 }))).toBeUndefined();
    expect(extractClaudeInitModel('')).toBeUndefined();
  });

  it('only looks at the start of the stream for the init event', () => {
    const filler = Array.from({ length: 60 }, () => JSON.stringify({ type: 'assistant' })).join('\n');
    const late = JSON.stringify({ type: 'system', subtype: 'init', model: 'model-late' });
    expect(extractClaudeInitModel(`${filler}\n${late}`)).toBeUndefined();
  });

  it('caps an oversized model name', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', model: 'm'.repeat(500) });
    expect(extractClaudeInitModel(line)).toHaveLength(100);
  });
});
