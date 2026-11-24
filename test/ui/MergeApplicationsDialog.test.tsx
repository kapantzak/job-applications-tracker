import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MergeApplicationsDialog } from '../../src/ui/components/MergeApplicationsDialog.js';
import type { Application } from '../../src/server/domain/types.js';

afterEach(cleanup);

const app = (id: string, role: string): Application => ({
  id,
  profile_id: 'pf1',
  job_id: null,
  company: 'Acme',
  role,
  url: null,
  status: 'applied',
  applied_at: null,
  status_changed_at: '2026-11-01T09:00:00',
  notes: null,
  sender_domains: [],
  created_at: '2026-11-01T09:00:00',
});

describe('MergeApplicationsDialog', () => {
  // The page clears its selection on success while the dialog is still closing.
  it('keeps the applications it opened with while it stays open', () => {
    const props = { profileId: 'pf1', open: true, onOpenChange: () => {}, onMerged: () => {} };
    const { rerender } = render(<MergeApplicationsDialog {...props} applications={[app('a1', 'Dev'), app('a2', 'Engineer')]} />);
    expect(screen.getByRole('dialog', { name: 'Merge 2 applications' })).toBeInTheDocument();
    rerender(<MergeApplicationsDialog {...props} applications={[]} />);
    expect(screen.getByRole('dialog', { name: 'Merge 2 applications' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });
});
