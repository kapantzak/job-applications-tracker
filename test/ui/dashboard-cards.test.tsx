import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApplicationStatus } from '../../src/server/domain/types.js';
import type { QuietApplication } from '../../src/server/domain/dashboard.js';
import { AttentionCard } from '../../src/ui/components/dashboard/AttentionCard.js';
import { FunnelCard } from '../../src/ui/components/dashboard/FunnelCard.js';
import { StatusBarCard } from '../../src/ui/components/dashboard/StatusBarCard.js';
import { InProfile } from './profile-shell.js';

const href = (p: string) => '/profiles/platform-roles' + p;

function renderCard(card: ReactNode) {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles']}>{card}</MemoryRouter>
    </InProfile>,
  );
}

function counts(partial: Partial<Record<ApplicationStatus, number>>): Record<ApplicationStatus, number> {
  return {
    saved: 0,
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
    no_response: 0,
    ...partial,
  };
}

const FULL = counts({
  saved: 4,
  applied: 12,
  screening: 3,
  interview: 2,
  offer: 1,
  rejected: 6,
  withdrawn: 1,
  no_response: 5,
});

function quiet(n: number, status: QuietApplication['status'], days: number, company = 'Acme'): QuietApplication {
  return { id: `app-${n}`, company, role: `Role ${n}`, status, since: '2026-10-01T00:00:00.000Z', days };
}

afterEach(cleanup);

describe('StatusBarCard', () => {
  it('status bar title and legend', () => {
    renderCard(<StatusBarCard total={34} counts={FULL} href={href} />);
    expect(screen.getByRole('heading', { name: 'Where your 34 applications stand' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Statuses' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Saved 4',
      'Applied 12',
      'Screening 3',
      'Interview 2',
      'Offer 1',
      'Rejected 6',
      'Withdrawn 1',
      'No response 5',
    ]);
    expect(screen.getByRole('link', { name: 'Applied 12' })).toHaveAttribute(
      'href',
      '/profiles/platform-roles/applications?status=applied',
    );
  });

  it('singular title and zero entries', () => {
    renderCard(<StatusBarCard total={1} counts={counts({ applied: 1 })} href={href} />);
    expect(screen.getByRole('heading', { name: 'Where your 1 application stands' })).toBeInTheDocument();
    expect(screen.getByText('Offer').closest('li')).toHaveTextContent('Offer 0');
    expect(screen.queryByRole('link', { name: 'Offer 0' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('bar image label lists non-zero statuses', () => {
    renderCard(<StatusBarCard total={34} counts={FULL} href={href} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Saved: 4, Applied: 12, Screening: 3, Interview: 2, Offer: 1, Rejected: 6, Withdrawn: 1, No response: 5',
    );
  });

  it('one status fills the bar', () => {
    const { container } = renderCard(<StatusBarCard total={3} counts={counts({ applied: 3 })} href={href} />);
    const segments = container.querySelectorAll('[data-status]');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveAttribute('data-status', 'applied');
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Applied: 3');
    expect(segments[0]).toHaveClass('rounded-l', 'rounded-r');
  });

  it('segment widths follow the counts', () => {
    const { container } = renderCard(<StatusBarCard total={34} counts={FULL} href={href} />);
    const segment = (s: string) => container.querySelector<HTMLElement>(`[data-status="${s}"]`)!;
    expect(segment('applied').style.flexGrow).toBe('12');
    expect(segment('rejected').style.flexGrow).toBe('6');
    expect(segment('saved')).toHaveClass('rounded-l');
    expect(segment('saved')).not.toHaveClass('rounded-r');
    expect(segment('no_response')).toHaveClass('rounded-r');
    // Hover-only tooltips (SOW-0034 Decision 7): the legend links are the keyboard path.
    expect(container.querySelectorAll('[data-status][tabindex]')).toHaveLength(0);
  });

  it('segment tooltip', async () => {
    const user = userEvent.setup();
    const { container } = renderCard(<StatusBarCard total={34} counts={FULL} href={href} />);
    await user.hover(container.querySelector('[data-status="applied"]')!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Applied: 12 (35%)');
  });
});

describe('FunnelCard', () => {
  const rows = () => within(screen.getByRole('list', { name: 'Funnel steps' })).getAllByRole('listitem');

  it('funnel rows', () => {
    renderCard(<FunnelCard funnel={{ applied: 30, screening: 14, interview: 6, offer: 1 }} />);
    expect(screen.getByRole('heading', { name: 'How far applications get' })).toBeInTheDocument();
    const expected = [
      ['Applied', '30', null],
      ['Screening', '14', '47%'],
      ['Interview', '6', '43%'],
      ['Offer', '1', '17%'],
    ] as const;
    expect(rows()).toHaveLength(4);
    expected.forEach(([label, count, share], i) => {
      const row = within(rows()[i]);
      expect(row.getByText(label)).toBeInTheDocument();
      expect(row.getByText(count)).toBeInTheDocument();
      if (share) expect(row.getByText(share)).toBeInTheDocument();
      else expect(row.queryByText(/%$/)).not.toBeInTheDocument();
    });
    expect(screen.getByText('% = share of the step above')).toBeInTheDocument();
  });

  it('funnel with all zero counts', () => {
    const { container } = renderCard(<FunnelCard funnel={{ applied: 0, screening: 0, interview: 0, offer: 0 }} />);
    for (const row of rows()) {
      expect(within(row).queryByText(/%$/)).not.toBeInTheDocument();
    }
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('funnel hides % after an empty step', () => {
    renderCard(<FunnelCard funnel={{ applied: 3, screening: 0, interview: 0, offer: 0 }} />);
    expect(rows()[1]).toHaveTextContent('0%');
    expect(rows()[2].textContent).toBe('Interview0');
  });

  it('row tooltip names the step above', async () => {
    const user = userEvent.setup();
    renderCard(<FunnelCard funnel={{ applied: 30, screening: 14, interview: 6, offer: 1 }} />);
    await user.hover(within(rows()[2]).getByTestId('funnel-track'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('6 of 14 that reached screening');
  });
});

describe('AttentionCard', () => {
  it('attention lists proposals and quiet applications', () => {
    renderCard(
      <AttentionCard
        pendingProposals={3}
        quiet={[quiet(1, 'applied', 21), quiet(2, 'interview', 15, 'Globex')]}
        href={href}
      />,
    );
    expect(screen.getByRole('link', { name: '3 status proposals waiting' })).toHaveAttribute(
      'href',
      '/profiles/platform-roles/review',
    );
    expect(screen.getByRole('link', { name: 'Acme · Role 1' })).toHaveAttribute(
      'href',
      '/profiles/platform-roles/applications/app-1',
    );
    expect(screen.getByRole('link', { name: 'Globex · Role 2' })).toHaveAttribute(
      'href',
      '/profiles/platform-roles/applications/app-2',
    );
    expect(screen.getByText('Applied 21 days ago, no reply')).toBeInTheDocument();
    expect(screen.getByText('Interview, no change in 15 days')).toBeInTheDocument();
  });

  it('one proposal is singular, none hides the line', () => {
    renderCard(<AttentionCard pendingProposals={1} quiet={[]} href={href} />);
    expect(screen.getByRole('link', { name: '1 status proposal waiting' })).toBeInTheDocument();
    cleanup();
    renderCard(<AttentionCard pendingProposals={0} quiet={[quiet(1, 'screening', 20)]} href={href} />);
    expect(screen.queryByText(/status proposals? waiting/)).not.toBeInTheDocument();
    expect(screen.getByText('Screening, no change in 20 days')).toBeInTheDocument();
  });

  it('shows five, then the rest on request', async () => {
    const user = userEvent.setup();
    const seven = Array.from({ length: 7 }, (_, i) => quiet(i + 1, 'applied', 30 - i));
    renderCard(<AttentionCard pendingProposals={0} quiet={seven} href={href} />);
    const list = () => screen.getByRole('list', { name: 'Needs attention' });
    expect(within(list()).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('link', { name: 'Acme · Role 6' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Acme · Role 7' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it('nothing to do', () => {
    renderCard(<AttentionCard pendingProposals={0} quiet={[]} href={href} />);
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
