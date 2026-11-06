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
});
