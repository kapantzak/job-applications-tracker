import { describe, expect, it } from 'vitest';
import { renderPrompt } from '../../../src/server/tasks/prompts.js';

describe('renderPrompt', () => {
  it('renders discover_jobs', () => {
    const r = renderPrompt('discover_jobs', { profile: 'PROFILE_X', known_urls: 'URLS_Y' });
    expect(r.version).toBe('1');
    expect(r.text).toContain('PROFILE_X');
    expect(r.text).toContain('URLS_Y');
    expect(r.text.toLowerCase()).toContain('read only');
    expect(r.text).not.toContain('{{');
    expect(r.text).not.toContain('version: 1');
  });

  it('renders sync_mail with the no-mail-tool instruction', () => {
    const r = renderPrompt('sync_mail', { applications: 'A', reviewed_message_ids: 'R', ats_domains: 'D' });
    expect(r.text).toContain('set `mail_access` to false and return an empty `findings` array.');
    expect(r.text.toLowerCase()).toContain('read only');
  });

  it('throws on a missing variable', () => {
    expect(() => renderPrompt('discover_jobs', { profile: 'P' })).toThrow('Missing prompt variable: known_urls');
  });
});
