// Rules for applications a Gmail sync proposes (SOW-0045). Agent output is untrusted, so names, domains
// and dates are cleaned here before anything is stored.
import { ATS_DOMAINS } from './ats-domains.js';

export function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

// Company and role compared without case or extra blanks (decision 6: exact match otherwise).
export function matchKey(company: string, role: string): string {
  return `${cleanName(company).toLowerCase()}\u0000${cleanName(role).toLowerCase()}`;
}

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

// Recruiters write from personal addresses too; a free-mail domain says nothing about the employer, and as a
// sender domain it would widen an unscoped search to everyone on that service (S4).
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
  'gmx.de', 'mail.com', 'zoho.com', 'yandex.com',
]);

// The employer's own mail domain, or null for ATS and job-board hosts, which say nothing about the employer.
export function cleanSenderDomain(value: string): string | null {
  let host = value.trim().toLowerCase().replace(/^@/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!DOMAIN.test(host)) return null;
  if (ATS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  if (FREE_MAIL.has(host)) return null;
  return host;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// A typed day is stored as local midnight, like the Add application form (src/ui/format.ts dayToIso);
// the server runs on the user's machine, so its zone is the user's.
function fromDay(value: string): string | null {
  const m = DAY.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.toISOString();
}

function fromTimestamp(value: string): string | null {
  if (DAY.test(value.trim())) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const parse = (value: string): string | null => fromDay(value) ?? fromTimestamp(value);

// A mail date as epoch milliseconds (a bare day is local midnight), or null when it is not a date.
export function mailTime(value: string): number | null {
  const iso = parse(value);
  return iso === null ? null : Date.parse(iso);
}

// Never in the future (S7): an agent date past now is a misread.
const notAfter = (iso: string, now: Date): string => (Date.parse(iso) > now.getTime() ? now.toISOString() : iso);

export function toAppliedAt(appliedAt: string, evidenceDate: string, now: Date): string {
  return notAfter(parse(appliedAt) ?? parse(evidenceDate) ?? now.toISOString(), now);
}

// When an accepted application last changed: the latest email's date, kept between its applied date and now,
// so an old interview does not look fresh on the Dashboard (decision 16A).
export function toChangedAt(evidenceDate: string, appliedAt: string, now: Date): string {
  const date = parse(evidenceDate);
  if (!date) return now.toISOString();
  return Date.parse(date) < Date.parse(appliedAt) ? appliedAt : notAfter(date, now);
}

// Gmail's after: operator takes YYYY/MM/DD.
export function gmailDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}
