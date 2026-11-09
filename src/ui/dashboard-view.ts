import { useEffect, useState } from 'react';

// Which Dashboard layout to show (SOW-0037). The choice is one browser-wide preference, not per profile.
export type DashboardView = 'journey' | 'breakdown';

export const DASHBOARD_VIEW_STORAGE_KEY = 'dashboard-view';
// From this many sent applications the journey graph has enough to show to open by default.
export const JOURNEY_MIN_SENT = 10;
// The graph scales with its card; below this window width its labels shrink under about 12 px (Decision 7).
export const JOURNEY_MIN_WIDTH = 1280;

const isView = (value: unknown): value is DashboardView => value === 'journey' || value === 'breakdown';

// Storage can throw (privacy modes, blocked site data); the automatic rule applies then.
export function readStoredView(): DashboardView | null {
  try {
    const value = window.localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY);
    return isView(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeView(view: DashboardView) {
  try {
    window.localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, view);
  } catch {
    // Keep the in-memory choice for this visit.
  }
}

// The graph needs the width, so narrow windows always get the cards.
export function chooseView(stored: DashboardView | null, sent: number, narrow: boolean): DashboardView {
  if (narrow) return 'breakdown';
  if (stored) return stored;
  return sent >= JOURNEY_MIN_SENT ? 'journey' : 'breakdown';
}

// Environments without matchMedia (jsdom) count as wide, like useIsMobile counts them as desktop.
const fitsJourney = () => typeof window.matchMedia !== 'function' || window.innerWidth >= JOURNEY_MIN_WIDTH;

export function useJourneyFits(): boolean {
  const [fits, setFits] = useState(fitsJourney);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(min-width: ${JOURNEY_MIN_WIDTH}px)`);
    const onChange = () => setFits(fitsJourney());
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, []);

  return fits;
}
