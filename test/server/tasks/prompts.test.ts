import { describe, expect, it } from 'vitest';
import { renderPrompt } from '../../../src/server/tasks/prompts.js';

describe('renderPrompt', () => {
  it('renders discover_jobs', () => {
    const r = renderPrompt('discover_jobs', { profile: 'PROFILE_X', known_urls: 'URLS_Y' });
    expect(r.version).toBe('2');
    expect(r.text).toContain('PROFILE_X');
    expect(r.text).toContain('URLS_Y');
    expect(r.text.toLowerCase()).toContain('read only');
    expect(r.text).not.toContain('{{');
    expect(r.text).not.toContain('version: 2');
  });

  it('discover_jobs tells the agent its budget and that the app verifies links', () => {
    const r = renderPrompt('discover_jobs', { profile: 'P', known_urls: 'U' });
    expect(r.text).toContain('You have about 10 minutes');
    expect(r.text).toContain('Prefer the employer\'s own careers page or ATS link');
    expect(r.text).toContain('You may open a posting to confirm its direct link and that it is still open');
    expect(r.text).toContain('Do not delegate to subagents');
    expect(r.text).toContain('The app checks every link itself after you respond');
    expect(r.text).toContain('Return between 10 and 30 jobs');
    expect(r.text.trim().endsWith('nothing else. The object has a `jobs` array and an optional `notes` string.')).toBe(true);
  });

  it('renders sync_mail with the no-mail-tool instruction', () => {
    const r = renderPrompt('sync_mail', { applications: 'A', reviewed_message_ids: 'R', ats_domains: 'D' });
    expect(r.version).toBe('2');
    expect(r.text).toContain('set `mail_access` to false and return an empty `findings` array.');
    expect(r.text).toContain('Gmail message id');
    expect(r.text).not.toContain('version: 2');
    expect(r.text.toLowerCase()).toContain('read only');
  });

  it('throws on a missing variable', () => {
    expect(() => renderPrompt('discover_jobs', { profile: 'P' })).toThrow('Missing prompt variable: known_urls');
  });
});
