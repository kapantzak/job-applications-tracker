import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { FunnelStage, QuietApplication, StageStops } from '../../src/server/domain/dashboard.js';
import { AttentionCard } from '../../src/ui/components/dashboard/AttentionCard.js';
import { JOURNEY_MIN_WIDTH_PX, JourneyCard } from '../../src/ui/components/dashboard/JourneyCard.js';
import { InProfile } from './profile-shell.js';

const href = (p: string) => '/profiles/platform-roles' + p;

function renderCard(card: ReactNode) {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles']}>{card}</MemoryRouter>
    </InProfile>,
  );
}

function quiet(n: number, status: QuietApplication['status'], days: number, company = 'Acme'): QuietApplication {
  return { id: `app-${n}`, company, role: `Role ${n}`, status, since: '2026-10-01T00:00:00.000Z', days };
}

afterEach(cleanup);

describe('AttentionCard', () => {
  it('attention lists proposals and quiet applications', () => {
    renderCard(
      <AttentionCard
        pendingProposals={3}
        newApplications={2}
        quiet={[quiet(1, 'applied', 21), quiet(2, 'interview', 15, 'Globex')]}
        href={href}
      />,
    );
    expect(screen.getByRole('link', { name: '3 status proposals waiting' })).toHaveAttribute(
      'href',
      '/profiles/platform-roles/review',
    );
    expect(screen.getByRole('link', { name: '2 new applications found' })).toHaveAttribute(
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
    renderCard(<AttentionCard pendingProposals={1} newApplications={1} quiet={[]} href={href} />);
    expect(screen.getByRole('link', { name: '1 status proposal waiting' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1 new application found' })).toBeInTheDocument();
    cleanup();
    renderCard(<AttentionCard pendingProposals={0} newApplications={0} quiet={[quiet(1, 'screening', 20)]} href={href} />);
    expect(screen.queryByText(/status proposals? waiting/)).not.toBeInTheDocument();
    expect(screen.queryByText(/new applications? found/)).not.toBeInTheDocument();
    expect(screen.getByText('Screening, no change in 20 days')).toBeInTheDocument();
  });

  it('shows five, then the rest on request', async () => {
    const user = userEvent.setup();
    const seven = Array.from({ length: 7 }, (_, i) => quiet(i + 1, 'applied', 30 - i));
    renderCard(<AttentionCard pendingProposals={0} newApplications={0} quiet={seven} href={href} />);
    const list = () => screen.getByRole('list', { name: 'Needs attention' });
    expect(within(list()).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('link', { name: 'Acme · Role 6' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Acme · Role 7' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it('says the proposal counts are unknown instead of nothing to do, and keeps the quiet list (SOW-0054)', () => {
    renderCard(<AttentionCard pendingProposals={null} newApplications={null} quiet={[quiet(1, 'screening', 20)]} href={href} />);
    const list = screen.getByRole('list', { name: 'Needs attention' });
    expect(within(list).getByText('Waiting proposals could not be loaded.')).toBeInTheDocument();
    expect(within(list).queryByText(/waiting$|found$/)).not.toBeInTheDocument();
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('Nothing needs you right now.')).not.toBeInTheDocument();
  });

  it('nothing to do', () => {
    renderCard(<AttentionCard pendingProposals={0} newApplications={0} quiet={[]} href={href} />);
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

  // Narrow windows scroll the card instead of shrinking the labels (SOW-0052 Decision 1).
  it('keeps a minimum drawing width inside a sideways-scrolling area', () => {
    renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={0} />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveStyle({ minWidth: `${JOURNEY_MIN_WIDTH_PX}px` });
    expect(JOURNEY_MIN_WIDTH_PX).toBe(910);
    expect(svg.closest('[data-slot="card-content"]')).toHaveClass('overflow-x-auto');
  });

  // Safari gives a scroll area without focusable content no keyboard access (SOW-0052 Decision 6).
  it('makes the scroll area a labelled region that the keyboard can reach', async () => {
    const user = userEvent.setup();
    renderCard(<JourneyCard funnel={FUNNEL} stoppedAt={STOPPED} saved={0} />);
    const region = screen.getByRole('region', { name: 'Journey graph' });
    expect(region).toContainElement(screen.getByRole('img'));
    await user.tab();
    expect(region).toHaveFocus();
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
