import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile } from '../../src/server/domain/types.js';
import { SyncScopeNote } from '../../src/ui/components/SyncScopeNote.js';
import { InProfile, TEST_PROFILE } from './profile-shell.js';

afterEach(cleanup);

function renderNote(scope: Pick<Profile, 'mail_filter_kind' | 'mail_filter'>) {
  render(
    <InProfile profile={{ ...TEST_PROFILE, ...scope }}>
      <MemoryRouter>
        <SyncScopeNote />
      </MemoryRouter>
    </InProfile>,
  );
}

describe('SyncScopeNote', () => {
  it('says sync searches by sender when the profile has no scope', () => {
    renderNote({ mail_filter_kind: 'label', mail_filter: '' });
    expect(screen.getByText(/Sync searches by company and job-board senders\./)).toBeInTheDocument();
  });

  it('names the label', () => {
    renderNote({ mail_filter_kind: 'label', mail_filter: 'Jobs/Frontend' });
    expect(screen.getByText('Jobs/Frontend').parentElement).toHaveTextContent('Sync searches Gmail label Jobs/Frontend.');
  });

  it('shows the custom search', () => {
    renderNote({ mail_filter_kind: 'query', mail_filter: 'to:you+frontend@example.com' });
    expect(screen.getByText('to:you+frontend@example.com').parentElement).toHaveTextContent(
      'Sync searches Gmail for to:you+frontend@example.com.',
    );
  });

  it('links to the profile page to change it', () => {
    renderNote({ mail_filter_kind: 'label', mail_filter: '' });
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/profiles/platform-roles/profile');
  });
});
