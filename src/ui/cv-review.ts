import { joinSeniority, splitSeniority } from '../server/domain/seniority.js';
import type { CvProfileDraft } from '../server/domain/types.js';
import type { ProfileInput } from './api/client.js';

// Which suggestions of a CV analysis the review panel offers for an existing profile (SOW-0024).
// Pure, so the rules are tested without rendering.

// Only these fields can be suggested; name, excluded companies and notes never are (decision 17).
export type ReviewField = 'target_roles' | 'locations' | 'remote' | 'seniority' | 'keywords';
type ListField = 'target_roles' | 'locations' | 'keywords';

// Replace CV compares every field; Add CV (a profile without a CV) fills only empty ones (decision 20).
export type ReviewMode = 'replace' | 'add';

// 'add' keeps the current list and appends the suggested items it lacks (decision 36).
export type ReviewChoice = 'keep' | 'use' | 'add';

export type ReviewRow =
  | {
      field: ListField;
      kind: 'list';
      current: string[];
      suggested: string[];
      choices: ReviewChoice[];
      initial: ReviewChoice;
    }
  | {
      field: 'remote' | 'seniority';
      kind: 'text';
      current: string;
      suggested: string;
      choices: ReviewChoice[];
      initial: ReviewChoice;
    };

const LIST_FIELDS: ListField[] = ['target_roles', 'locations', 'keywords'];
const ORDER: ReviewField[] = ['target_roles', 'locations', 'remote', 'seniority', 'keywords'];

const key = (item: string) => item.trim().toLowerCase();
const normalSeniority = (value: string) => joinSeniority(splitSeniority(value));

// The same items in any order or case are no change (decision 32).
function sameItems(a: string[], b: string[]): boolean {
  const left = new Set(a.map(key));
  const right = new Set(b.map(key));
  return left.size === right.size && [...left].every((item) => right.has(item));
}

// Current items first, in their order, then the suggested ones not there yet.
export function addItems(current: string[], suggested: string[]): string[] {
  const seen = new Set(current.map(key));
  const out = [...current];
  for (const item of suggested) {
    if (seen.has(key(item))) continue;
    seen.add(key(item));
    out.push(item);
  }
  return out;
}

function isEmpty(field: ReviewField, value: ProfileInput[ReviewField]): boolean {
  if (field === 'remote') return value === 'any';
  return Array.isArray(value) ? value.length === 0 : value.trim() === '';
}

function differs(
  field: ReviewField,
  current: ProfileInput[ReviewField],
  suggested: ProfileInput[ReviewField],
): boolean {
  if (Array.isArray(current) && Array.isArray(suggested)) return !sameItems(current, suggested);
  if (field === 'seniority')
    return key(normalSeniority(current as string)) !== key(normalSeniority(suggested as string));
  return current !== suggested;
}

// One row per field the review offers, in form order. A suggestion the CV gives no basis for (an empty
// list, empty seniority, remote "any") is never offered (decision 31). Keep current is pre-selected on
// Replace CV, Use suggested on Add CV, where the field is empty (decision 38).
export function reviewRows(form: ProfileInput, draft: CvProfileDraft, mode: ReviewMode): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const initial: ReviewChoice = mode === 'replace' ? 'keep' : 'use';
  for (const field of ORDER) {
    const current = form[field];
    const suggested = field === 'seniority' ? normalSeniority(draft.seniority) : draft[field];
    if (isEmpty(field, suggested)) continue;
    if (mode === 'add' ? !isEmpty(field, current) : !differs(field, current, suggested)) continue;
    if (LIST_FIELDS.includes(field as ListField)) {
      const list = current as string[];
      const extra = addItems(list, suggested as string[]).length > list.length;
      // "Add the new items" only when it would add something and keep something.
      const choices: ReviewChoice[] = extra && list.length > 0 ? ['keep', 'use', 'add'] : ['keep', 'use'];
      rows.push({
        field: field as ListField,
        kind: 'list',
        current: list,
        suggested: suggested as string[],
        choices,
        initial,
      });
    } else {
      rows.push({
        field: field as 'remote' | 'seniority',
        kind: 'text',
        current: current as string,
        suggested: suggested as string,
        choices: ['keep', 'use'],
        initial,
      });
    }
  }
  return rows;
}

// The form values after Apply: every field without a row, and every row left on Keep current, is the
// form's own value, so unsaved edits survive (decision 33).
export function applyChoices(
  form: ProfileInput,
  rows: ReviewRow[],
  choices: Partial<Record<ReviewField, ReviewChoice>>,
): ProfileInput {
  const next: ProfileInput = { ...form };
  for (const row of rows) {
    const choice = choices[row.field] ?? row.initial;
    if (choice === 'keep') continue;
    if (row.kind === 'list') {
      next[row.field] = choice === 'add' ? addItems(row.current, row.suggested) : row.suggested;
    } else if (row.field === 'remote') {
      next.remote = row.suggested as ProfileInput['remote'];
    } else {
      next.seniority = row.suggested;
    }
  }
  return next;
}
