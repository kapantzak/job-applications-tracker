import type { MiddlewareHandler } from 'hono';

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Strict shape (no userinfo, path or spaces) so "evil.example@127.0.0.1" cannot pass as loopback.
const HOST_HEADER = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/;

export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const match = HOST_HEADER.exec(hostHeader.trim().toLowerCase());
  return match ? match[1] : null;
}

function originHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    // Includes the literal "null" origin sent by sandboxed frames and file: pages.
    return null;
  }
}

// Host check defeats DNS rebinding; Origin check stops other sites from issuing writes.
export function createRequestGuard(extraHosts: readonly string[] = []): MiddlewareHandler {
  const allowed = new Set([...DEFAULT_ALLOWED_HOSTS, ...extraHosts].map((h) => h.toLowerCase()));
  return async (c, next) => {
    const host = hostnameOf(c.req.header('host'));
    if (!host || !allowed.has(host)) return c.json({ error: 'Forbidden host' }, 403);
    const origin = c.req.header('origin');
    // No Origin means a non-browser client; browsers always send it on non-GET fetches.
    if (origin !== undefined && STATE_CHANGING.has(c.req.method)) {
      const originHost = originHostname(origin);
      if (!originHost || !allowed.has(originHost)) return c.json({ error: 'Forbidden origin' }, 403);
    }
    await next();
  };
}
