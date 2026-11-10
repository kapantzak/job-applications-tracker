import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyLink } from '../../../src/server/verify/links.js';

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case '/ok':
        res.writeHead(200).end('ok');
        break;
      case '/r1':
        res.writeHead(301, { location: '/ok' }).end();
        break;
      case '/gone':
        res.writeHead(404).end();
        break;
      case '/blocked':
        res.writeHead(403).end();
        break;
      case '/loop':
        res.writeHead(302, { location: '/loop' }).end();
        break;
      case '/slow':
        break; // never respond
      default:
        res.writeHead(500).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('verifyLink', () => {
  it('ok for 200', async () => {
    expect(await verifyLink(`${base}/ok`)).toEqual({
      status: 'ok',
      finalUrl: `${base}/ok`,
      httpStatus: 200,
    });
  });

  it('redirected after a hop', async () => {
    const r = await verifyLink(`${base}/r1`);
    expect(r.status).toBe('redirected');
    expect(r.finalUrl.endsWith('/ok')).toBe(true);
  });

  it('dead for 404', async () => {
    expect((await verifyLink(`${base}/gone`)).status).toBe('dead');
  });

  it('unverified for 403', async () => {
    const r = await verifyLink(`${base}/blocked`);
    expect(r.status).toBe('unverified');
    expect(r.httpStatus).toBe(403);
  });

  it('unverified on timeout', async () => {
    const r = await verifyLink(`${base}/slow`, { timeoutMs: 300 });
    expect(r).toMatchObject({ status: 'unverified', httpStatus: null });
  });

  it('unverified on redirect loop', async () => {
    expect((await verifyLink(`${base}/loop`)).status).toBe('unverified');
  });

  it('dead when the port is closed', async () => {
    const tmp = http.createServer();
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', r));
    const port = (tmp.address() as AddressInfo).port;
    await new Promise((r) => tmp.close(r));
    expect((await verifyLink(`http://127.0.0.1:${port}/x`)).status).toBe('dead');
  });

  // Discovery trusts a verdict on a known job only when the site answered (SOW-0040), so a hop that
  // fails must not carry the status of the hop before it.
  it('reports no HTTP status when a redirect hop fails without an answer', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input) === 'http://jobs.acme.example/1') {
        return new Response(null, { status: 301, headers: { location: 'https://careers.acme.example/1' } });
      }
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } });
    }) as typeof fetch;
    expect(await verifyLink('http://jobs.acme.example/1', { fetchImpl })).toEqual({
      status: 'dead',
      finalUrl: 'https://careers.acme.example/1',
      httpStatus: null,
    });
  });
});

// Greenhouse answers a closed or unknown job id with a redirect to `/<board>?error=true`, which then
// serves the board with 200 (probed 2026-11-07). A local server cannot pose as greenhouse.io, so these
// tests route by URL through an injected fetch.
describe('verifyLink Greenhouse soft 404', () => {
  function fakeFetch(routes: Record<string, { status: number; location?: string }>): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      const headers = route.location ? { location: route.location } : undefined;
      return new Response(null, { status: route.status, headers });
    }) as typeof fetch;
  }

  it('dead when a Greenhouse job redirects to the board with error=true', async () => {
    const fetchImpl = fakeFetch({
      'https://job-boards.greenhouse.io/acme/jobs/123': { status: 302, location: '/acme?error=true' },
      'https://job-boards.greenhouse.io/acme?error=true': { status: 200 },
    });
    expect(await verifyLink('https://job-boards.greenhouse.io/acme/jobs/123', { fetchImpl })).toEqual({
      status: 'dead',
      finalUrl: 'https://job-boards.greenhouse.io/acme?error=true',
      httpStatus: 302,
    });
  });

  it('dead when the old Greenhouse host hops through to error=true', async () => {
    const fetchImpl = fakeFetch({
      'https://boards.greenhouse.io/acme/jobs/123': {
        status: 301,
        location: 'https://job-boards.greenhouse.io/acme/jobs/123',
      },
      'https://job-boards.greenhouse.io/acme/jobs/123': {
        status: 302,
        location: 'https://job-boards.greenhouse.io/acme?error=true',
      },
    });
    expect((await verifyLink('https://boards.greenhouse.io/acme/jobs/123', { fetchImpl })).status).toBe('dead');
  });

  it('dead without fetching when the agent returned the error=true board url itself', async () => {
    const fetchImpl = fakeFetch({});
    expect(await verifyLink('https://job-boards.greenhouse.io/acme?error=true', { fetchImpl })).toEqual({
      status: 'dead',
      finalUrl: 'https://job-boards.greenhouse.io/acme?error=true',
      httpStatus: null,
    });
  });

  it('still redirected for an ordinary Greenhouse redirect', async () => {
    const fetchImpl = fakeFetch({
      'https://boards.greenhouse.io/acme/jobs/123': {
        status: 301,
        location: 'https://job-boards.greenhouse.io/acme/jobs/123',
      },
      'https://job-boards.greenhouse.io/acme/jobs/123': { status: 200 },
    });
    expect((await verifyLink('https://boards.greenhouse.io/acme/jobs/123', { fetchImpl })).status).toBe('redirected');
  });

  it('error=true on another host keeps the normal redirect handling', async () => {
    const fetchImpl = fakeFetch({
      'https://jobs.example.com/acme/1': { status: 302, location: 'https://jobs.example.com/acme?error=true' },
      'https://jobs.example.com/acme?error=true': { status: 200 },
    });
    expect((await verifyLink('https://jobs.example.com/acme/1', { fetchImpl })).status).toBe('redirected');
  });

  it('a look-alike host is not treated as Greenhouse', async () => {
    const fetchImpl = fakeFetch({
      'https://notgreenhouse.io/acme/1': { status: 302, location: 'https://notgreenhouse.io/acme?error=true' },
      'https://notgreenhouse.io/acme?error=true': { status: 200 },
    });
    expect((await verifyLink('https://notgreenhouse.io/acme/1', { fetchImpl })).status).toBe('redirected');
  });
});
