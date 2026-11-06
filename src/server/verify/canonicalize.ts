const TRACKING_EXACT = new Set(
  ['gclid', 'fbclid', 'ref', 'refId', 'trk', 'trackingId', 'src', 'source', 'mkt_tok', 'gh_src', 'lever-source'].map(
    (n) => n.toLowerCase(),
  ),
);

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || TRACKING_EXACT.has(n);
}

/** Throws the native URL error for unparseable input; callers handle it. */
export function canonicalUrl(input: string): string {
  const url = new URL(input);
  // WHATWG URL already lowercases scheme/host and drops default ports; set explicitly for clarity.
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  const kept = [...url.searchParams.entries()].filter(([k]) => !isTrackingParam(k));
  kept.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function dedupeKey(job: {
  canonical_url: string | null;
  company: string;
  title: string;
  location: string;
}): string {
  if (typeof job.canonical_url === 'string' && job.canonical_url !== '') return job.canonical_url;
  return [job.company, job.title, job.location].map(norm).join('|');
}
