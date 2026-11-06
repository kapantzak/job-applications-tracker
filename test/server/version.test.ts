import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/server/version.js';

describe('APP_VERSION', () => {
  it('is a semver-like string', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
