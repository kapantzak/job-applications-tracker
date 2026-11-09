// A profile's Gmail scope for mail sync (SOW-0031). Pure functions with no Node imports, so the UI shares them.

// `label`: a Gmail label name the app turns into a search; `query`: a Gmail search used as typed.
export const MAIL_FILTER_KINDS = ['label', 'query'] as const;
export type MailFilterKind = (typeof MAIL_FILTER_KINDS)[number];

export const MAIL_FILTER_MAX = 300;

// The value goes into the sync prompt on one line; a line break there would end it early.
const CONTROL_OR_LINE_BREAK = /[\p{Cc}\p{Zl}\p{Zp}]/u;
// Search syntax typed into the label box (SOW-0032, decision 1).
const LABEL_OPERATOR = /^label\s*:/i;
// Brackets may parse as Gmail grouping, and invisible format characters make a name match nothing;
// neither was probed against Gmail, so labels refuse them (SOW-0032, decision 4).
const BRACKET_OR_HIDDEN = /[(){}\p{Cf}]/u;

export function normalizeMailFilter(value: string): string {
  return value.trim();
}

// The reason a value is refused, or null. Empty is allowed and means no scope.
export function mailFilterError(kind: MailFilterKind, value: string): string | null {
  if (Array.from(value).length > MAIL_FILTER_MAX) return `Use at most ${MAIL_FILTER_MAX} characters.`;
  if (CONTROL_OR_LINE_BREAK.test(value)) return 'Use a single line without control characters.';
  if (kind !== 'label') return null;
  // Before the character rules, so a pasted search such as label:"Board Prep" gets the mode hint.
  if (LABEL_OPERATOR.test(value)) {
    return 'Type only the label name, without label:. For a full search, choose Custom Gmail search.';
  }
  if (value.includes('"')) return 'A label name cannot contain double quotes.';
  if (BRACKET_OR_HIDDEN.test(value)) return 'Use Custom Gmail search for labels with brackets or hidden characters.';
  return null;
}

// The Gmail search for a scope, or null when there is none. Labels use Gmail's hyphen form: probed
// against the Gmail connector, it matched nested, spaced and non-Latin names, while quoting a name
// that contains " - " matched nothing.
export function mailScopeQuery(kind: MailFilterKind, value: string): string | null {
  const v = normalizeMailFilter(value);
  if (v === '') return null;
  return kind === 'label' ? `label:${v.replace(/[\s/]/g, '-')}` : v;
}
