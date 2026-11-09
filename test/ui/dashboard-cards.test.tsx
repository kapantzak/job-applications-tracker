import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApplicationStatus } from '../../src/server/domain/types.js';
import type { FunnelStage, QuietApplication, StageStops } from '../../src/server/domain/dashboard.js';
import { AttentionCard } from '../../src/ui/components/dashboard/AttentionCard.js';
import { FunnelCard } from '../../src/ui/components/dashboard/FunnelCard.js';
import { JourneyCard } from '../../src/ui/components/dashboard/JourneyCard.js';
import { StatusBarCard } from '../../src/ui/components/dashboard/StatusBarCard.js';
import { InProfile } from './profile-shell.js';

const href = (p: string) => '/profiles/platform-roles' + p;
const NONE = { applied: 0, screening: 0, interview: 0, offer: 0 };

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
    renderCard(<FunnelCard funnel={{ applied: 30, screening: 14, interview: 6, offer: 1 }} rejectedAt={NONE} />);
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
    const { container } = renderCard(<FunnelCard funnel={{ applied: 0, screening: 0, interview: 0, offer: 0 }} rejectedAt={NONE} />);
    for (const row of rows()) {
      expect(within(row).queryByText(/%$/)).not.toBeInTheDocument();
    }
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('funnel hides % after an empty step', () => {
    renderCard(<FunnelCard funnel={{ applied: 3, screening: 0, interview: 0, offer: 0 }} rejectedAt={NONE} />);
    expect(rows()[1]).toHaveTextContent('0%');
    expect(rows()[2].textContent).toBe('Interview0');
  });

  it('row tooltip names the step above', async () => {
    const user = userEvent.setup();
    renderCard(<FunnelCard funnel={{ applied: 30, screening: 14, interview: 6, offer: 1 }} rejectedAt={NONE} />);
    await user.hover(within(rows()[2]).getByTestId('funnel-track'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('6 of 14 that reached screening');
  });

  it('shows no rejection parts or line without rejections', () => {
    renderCard(<FunnelCard funnel={{ applied: 30, screening: 14, interview: 6, offer: 1 }} rejectedAt={NONE} />);
    expect(screen.queryAllByTestId('funnel-rejected')).toHaveLength(0);
    expect(screen.queryByText(/^Rejected after/)).not.toBeInTheDocument();
  });

  it('marks rejections inside each step and lists them as text', () => {
    renderCard(
      <FunnelCard
        funnel={{ applied: 20, screening: 10, interview: 4, offer: 1 }}
        rejectedAt={{ applied: 5, screening: 2, interview: 0, offer: 1 }}
      />,
    );
    // Widths are shares of the Applied count; the blue part is what was not rejected at that step.
    const reached = (i: number) => within(rows()[i]).getByTestId('funnel-reached') as HTMLElement;
    const rejected = (i: number) => within(rows()[i]).queryByTestId('funnel-rejected') as HTMLElement | null;
    expect(reached(0).style.width).toBe('75%');
    expect(rejected(0)?.style.width).toBe('25%');
    expect(reached(1).style.width).toBe('40%');
    expect(rejected(1)?.style.width).toBe('10%');
    expect(rejected(2)).toBeNull();
    expect(reached(2).style.width).toBe('20%');
    expect(reached(3).style.width).toBe('0%');
    expect(rejected(3)?.style.width).toBe('5%');
    // Row counts and shares are unchanged by rejections.
    expect(within(rows()[1]).getByText('10')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/^Rejected after/)).toHaveTextContent('Rejected after: applying 5 · screening 2 · the offer 1');
  });

  it('row tooltip adds the rejections at that step', async () => {
    const user = userEvent.setup();
    renderCard(
      <FunnelCard
        funnel={{ applied: 20, screening: 10, interview: 4, offer: 1 }}
        rejectedAt={{ applied: 5, screening: 2, interview: 0, offer: 0 }}
      />,
    );
    await user.hover(within(rows()[0]).getByTestId('funnel-track'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('20 applications sent; 5 rejected after applying');
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
    // Long unbroken names must wrap instead of widening the page.
    expect(screen.getByRole('link', { name: 'Acme · Role 1' })).toHaveClass('wrap-anywhere');
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

describe('JourneyCard', () => {
  const stops = (waiting = 0, rejected = 0, no_response = 0, withdrawn = 0): StageStops => ({
    waiting,
    rejected,
    no_response,
    withdrawn,
  });
  // 30 sent: 11 reached screening, 5 the interview, 1 an offer; the rest stopped along the way.
  const FUNNEL = { applied: 30, screening: 11, interview: 5, offer: 1 };
  const STOPPED: Record<FunnelStage, StageStops> = {
    applied: stops(12, 3, 4, 0),
    screening: stops(3, 2, 0, 1),
    interview: stops(2, 1, 1, 0),
    offer: stops(1),
  };
  const ONLY_APPLIED = { applied: 3, screening: 0, interview: 0, offer: 0 };
  const ONLY_APPLIED_STOPS = { applied: stops(3), screening: stops(), interview: stops(), offer: stops() };

  const stage = (container: HTMLElement, s: FunnelStage) => container.querySelector(`[data-stage="${s}"]`)!;
  const part = (container: HTMLElement, s: FunnelStage, name: string) =>
    stage(container, s).querySelector(`[data-part="${name}"]`);
  const exitLabels = (container: HTMLElement, s: FunnelStage) =>
    [...stage(container, s).querySelectorAll('[data-exit] text')].map((t) => t.textContent);

  it('titles the card and counts sent and saved applications', () => {
    renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={4} />);
    expect(screen.getByRole('heading', { name: "Your applications' journey" })).toBeInTheDocument();
    expect(screen.getByText('30 sent · 4 saved, not applied yet')).toBeInTheDocument();
    cleanup();
    renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={1} />);
    expect(screen.getByText('30 sent · 1 saved, not applied yet')).toBeInTheDocument();
    cleanup();
    renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={0} />);
    expect(screen.getByText('30 sent')).toBeInTheDocument();
  });

  it('heads each stage with its name, count and share of the stage before', () => {
    const { container } = renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={0} />);
    const expected = [
      ['applied', 'Applied', '30'],
      ['screening', 'Screening', '11 · 37%'],
      ['interview', 'Interview', '5 · 45%'],
      ['offer', 'Offer', '1 · 20%'],
    ] as const;
    for (const [key, name, count] of expected) {
      expect(part(container, key, 'name')).toHaveTextContent(name);
      expect(part(container, key, 'count')?.textContent).toBe(count);
    }
  });

  it('branches off each non-zero way of stopping, in a fixed order', () => {
    const { container } = renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={0} />);
    expect(exitLabels(container, 'applied')).toEqual(['12 waiting', '3 rejected', '4 no response']);
    expect(exitLabels(container, 'screening')).toEqual(['3 waiting', '2 rejected', '1 withdrawn']);
    expect(exitLabels(container, 'interview')).toEqual(['2 waiting', '1 rejected', '1 no response']);
    expect(stage(container, 'applied').querySelector('[data-exit="withdrawn"]')).toBeNull();
    // Each exit is a ribbon ending in a cap next to its label.
    const rejected = stage(container, 'applied').querySelector('[data-exit="rejected"]')!;
    expect(rejected.querySelector('path')).not.toBeNull();
    expect(rejected.querySelector('rect')).not.toBeNull();
  });

  it('calls holding an offer an offer, in bold', () => {
    const { container } = renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={0} />);
    expect(exitLabels(container, 'offer')).toEqual(['1 offer']);
    expect(stage(container, 'offer').querySelector('[data-exit="waiting"] text')).toHaveAttribute('font-weight', '700');
    cleanup();
    const two = { applied: 30, screening: 11, interview: 5, offer: 2 };
    const { container: c2 } = renderCard(
      <JourneyCard
        funnel={two}
        stoppedAt={{ ...STOPPED, interview: stops(1, 1, 1, 0), offer: stops(2) }}
        saved={0}
      />,
    );
    expect(exitLabels(c2, 'offer')).toEqual(['2 offers']);
  });

  it('keeps Offer-stage labels clear of the right edge', () => {
    const { container } = renderCard(
      <JourneyCard
        funnel={{ applied: 300, screening: 120, interview: 60, offer: 40 }}
        stoppedAt={{ applied: stops(180), screening: stops(60), interview: stops(20), offer: stops(10, 10, 10, 10) }}
        saved={0}
      />,
    );
    const labels = [...stage(container, 'offer').querySelectorAll('[data-exit] text')];
    expect(labels.map((t) => t.textContent)).toContain('10 no response');
    // 120 units hold "1000 no response" at font size 12.
    for (const t of labels) expect(Number(t.getAttribute('x'))).toBeLessThanOrEqual(940 - 120);
    // Proportional digits: Manrope's tabular "1" stands apart from its neighbours (Decision 8).
    expect(screen.getByRole('img').getAttribute('style') ?? '').not.toContain('tabular');
  });

  it('describes every stage and its exits in the image label', () => {
    renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={4} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      '30 sent. Applied 30: 12 waiting, 3 rejected, 4 no response. ' +
        'Screening 11: 3 waiting, 2 rejected, 1 withdrawn. ' +
        'Interview 5: 2 waiting, 1 rejected, 1 no response. Offer 1: 1 offer.',
    );
  });

  it('scales bars to the Applied count, with a visible minimum', () => {
    const { container } = renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={0} />);
    const height = (s: FunnelStage) => Number(part(container, s, 'node')?.getAttribute('height'));
    expect(height('applied')).toBe(200);
    expect(height('screening')).toBeCloseTo((11 / 30) * 200);
    cleanup();
    const { container: c2 } = renderCard(
      <JourneyCard
        funnel={{ applied: 100, screening: 1, interview: 0, offer: 0 }}
        stoppedAt={{ applied: stops(99), screening: stops(1), interview: stops(), offer: stops() }}
        saved={0}
      />,
    );
    expect(Number(part(c2, 'screening', 'node')?.getAttribute('height'))).toBe(3);
  });

  it('draws only headers after an empty stage, without NaN', () => {
    const { container } = renderCard(<JourneyCard funnel={ONLY_APPLIED} stoppedAt={ONLY_APPLIED_STOPS} saved={0} />);
    expect(part(container, 'applied', 'node')).not.toBeNull();
    expect(part(container, 'applied', 'moved')).toBeNull();
    expect(part(container, 'screening', 'count')?.textContent).toBe('0 · 0%');
    // The stage before is empty, so a share would mean nothing.
    expect(part(container, 'interview', 'count')?.textContent).toBe('0');
    for (const s of ['screening', 'interview', 'offer'] as const) {
      expect(part(container, s, 'name')).not.toBeNull();
      expect(part(container, s, 'node')).toBeNull();
    }
    expect(exitLabels(container, 'applied')).toEqual(['3 waiting']);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '3 sent. Applied 3: 3 waiting.');
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).not.toContain('Infinity');
  });

  it('fits the drawing height to its content', () => {
    const { container } = renderCard(<JourneyCard funnel={ONLY_APPLIED} stoppedAt={ONLY_APPLIED_STOPS} saved={0} />);
    const [, , width, height] = screen.getByRole('img').getAttribute('viewBox')!.split(' ').map(Number);
    expect(width).toBe(940);
    // One exit below a 200-unit bar: well under the height a four-exit stage needs.
    const lowest = Math.max(
      ...[...container.querySelectorAll('rect')].map((r) => Number(r.getAttribute('y')) + Number(r.getAttribute('height'))),
    );
    expect(height).toBeGreaterThanOrEqual(lowest);
    expect(height - lowest).toBeLessThan(40);
  });

  it.each([
    ['the trunk', (c: HTMLElement) => part(c, 'applied', 'moved')!, '11 moved on to screening'],
    ['an exit', (c: HTMLElement) => stage(c, 'applied').querySelector('[data-exit="rejected"] path')!, '3 rejected after applying'],
    ['a node', (c: HTMLElement) => part(c, 'applied', 'node')!, '30 reached applied'],
    ['the offer', (c: HTMLElement) => stage(c, 'offer').querySelector('[data-exit="waiting"] path')!, '1 with an offer'],
  ])('shows a hover-only tooltip on %s', async (_, target, tip) => {
    const user = userEvent.setup();
    const { container } = renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={0} />);
    await user.hover(target(container));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(tip);
    expect(container.querySelectorAll('svg [tabindex]')).toHaveLength(0);
  });
});
