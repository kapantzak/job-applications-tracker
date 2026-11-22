// A table view saved in browser localStorage as its URL query string (SOW-0054). Reading goes through
// `parseView`, so a stale or hand-edited value loses whatever no longer applies.
import { type ColumnDef, parseView, type ViewState, viewQuery } from './table-view.js';

// Storage can be missing or throw (private windows, blocked site data); the view then lasts only the visit.
export function readStoredView<Row>(key: string, columns: ColumnDef<Row>[]): URLSearchParams {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? viewQuery(parseView(new URLSearchParams(raw), columns), columns) : new URLSearchParams();
  } catch {
    return new URLSearchParams();
  }
}

export function storeView<Row>(key: string, state: ViewState, columns: ColumnDef<Row>[]): void {
  try {
    const query = viewQuery(state, columns).toString();
    if (query) window.localStorage.setItem(key, query);
    else window.localStorage.removeItem(key);
  } catch {
    // Not saved; see readStoredView.
  }
}

// A list opened as a one-time view shows its URL without saving it until the user changes the view
// (a Dashboard tile, decision 8B).
export interface OneTimeViewState {
  oneTimeView: true;
}

export const ONE_TIME_VIEW: OneTimeViewState = { oneTimeView: true };

export const isOneTimeView = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as Partial<OneTimeViewState>).oneTimeView === true;
