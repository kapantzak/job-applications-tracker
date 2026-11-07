import type { VerificationStatus } from '../domain/types.js';

export interface VerifyResult {
  status: VerificationStatus;
  finalUrl: string;
  httpStatus: number | null;
}

const MAX_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const DEAD_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);
// Some job boards reject non-browser agents, so present a desktop browser.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Greenhouse sends a closed or unknown job id to `/<board>?error=true`, which serves the board with 200
// (probed 2026-11-07, SOW-0016), so the status code alone would call a dead posting live.
function isGreenhouseSoft404(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const greenhouse = host === 'greenhouse.io' || host.endsWith('.greenhouse.io');
  return greenhouse && url.searchParams.get('error') === 'true';
}

function errorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

export async function verifyLink(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<VerifyResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let current = url;
  let hops = 0;
  let httpStatus: number | null = null;
  // An agent that followed the redirect itself may hand back the board url it landed on.
  try {
    if (isGreenhouseSoft404(new URL(url))) return { status: 'dead', finalUrl: url, httpStatus };
  } catch {
    // Not a URL: the fetch below reports it.
  }

  try {
    for (;;) {
      const res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*;q=0.8' },
      });
      httpStatus = res.status;
      // Free the socket; only the status matters.
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (REDIRECT_CODES.has(res.status) && location) {
        if (hops >= MAX_REDIRECTS) return { status: 'unverified', finalUrl: current, httpStatus };
        const next = new URL(location, current);
        if (isGreenhouseSoft404(next)) return { status: 'dead', finalUrl: next.toString(), httpStatus };
        current = next.toString();
        hops++;
        continue;
      }
      break;
    }
  } catch (err) {
    const code = errorCode(err);
    const status: VerificationStatus = code && DEAD_ERROR_CODES.has(code) ? 'dead' : 'unverified';
    return { status, finalUrl: current, httpStatus };
  }

  let status: VerificationStatus = 'unverified';
  if (httpStatus! >= 200 && httpStatus! < 300) status = hops === 0 ? 'ok' : 'redirected';
  else if (httpStatus === 404 || httpStatus === 410) status = 'dead';
  return { status, finalUrl: current, httpStatus };
}
