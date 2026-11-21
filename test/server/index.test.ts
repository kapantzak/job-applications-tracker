import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configFilePath, writeConfig } from '../../src/server/config/paths.js';
import { APP_VERSION, startApp } from '../../src/server/index.js';

type Started = Awaited<ReturnType<typeof startApp>>;

// These tests replace the whole environment; keep the update check off there as everywhere else.
const NO_UPDATES = { NO_UPDATE_NOTIFIER: '1' };

describe('startApp', () => {
  const dirs: string[] = [];
  const apps: Started[] = [];
  const blockers: net.Server[] = [];

  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'jobtrack-index-'));
    dirs.push(d);
    return d;
  }
  async function start(opts: Parameters<typeof startApp>[0]): Promise<Started> {
    const app = await startApp(opts);
    apps.push(app);
    return app;
  }

  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
    for (const b of blockers.splice(0)) await new Promise((res) => b.close(res));
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('serves health, creates data files, and closes idempotently', async () => {
    const dir = tmp();
    const app = await start({ dataDir: dir, port: 0, uiDir: null });
    const res = await fetch(`${app.url}/api/health`);
    expect(res.ok).toBe(true);
    expect(((await res.json()) as { dataDir: string }).dataDir).toBe(dir);
    expect(existsSync(join(dir, 'data.db'))).toBe(true);
    expect(existsSync(join(dir, 'runs'))).toBe(true);
    await app.close();
    await app.close();
  });

  it('binds to loopback', async () => {
    const app = await start({ dataDir: tmp(), port: 0, uiDir: null });
    expect(app.url.startsWith('http://127.0.0.1:')).toBe(true);
    expect(app.url).toBe(`http://127.0.0.1:${app.port}`);
    expect(app.dataDir).toBeTruthy();
  });

  it('falls back to the next port when the requested one is taken', async () => {
    const blocker = net.createServer();
    blockers.push(blocker);
    await new Promise<void>((res) => blocker.listen(0, '127.0.0.1', res));
    const p = (blocker.address() as net.AddressInfo).port;
    const app = await start({ dataDir: tmp(), port: p, uiDir: null });
    expect(app.port).toBe(p + 1);
  });

  it('serves index.html from an explicit uiDir', async () => {
    const ui = tmp();
    writeFileSync(join(ui, 'index.html'), '<h1>shell</h1>');
    const app = await start({ dataDir: tmp(), port: 0, uiDir: ui });
    const res = await fetch(`${app.url}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>shell</h1>');
  });

  it('returns 404 at / when uiDir is null', async () => {
    const app = await start({ dataDir: tmp(), port: 0, uiDir: null });
    expect((await fetch(`${app.url}/`)).status).toBe(404);
  });

  it('uses the folder from the config file when no flag or env is set', async () => {
    const home = tmp();
    const chosen = join(home, 'chosen');
    mkdirSync(chosen);
    writeConfig({ dataDir: chosen }, home);
    const app = await start({ port: 0, uiDir: null, env: NO_UPDATES, home });
    expect(app.dataDir).toBe(chosen);
    expect(existsSync(join(chosen, 'data.db'))).toBe(true);
  });

  it('refuses to start when the folder from the config file is missing, and creates nothing', async () => {
    const home = tmp();
    const gone = join(home, 'gone');
    writeConfig({ dataDir: gone }, home);
    await expect(startApp({ port: 0, uiDir: null, env: NO_UPDATES, home })).rejects.toThrow(
      `The data directory ${gone} (set in ${configFilePath(home)}) does not exist.`,
    );
    expect(existsSync(gone)).toBe(false);
  });

  it('still creates a missing folder named by the flag', async () => {
    const dir = join(tmp(), 'new', 'data');
    const app = await start({ dataDir: dir, port: 0, uiDir: null, env: NO_UPDATES });
    expect(app.dataDir).toBe(dir);
    expect(existsSync(join(dir, 'data.db'))).toBe(true);
  });

  describe('update check', () => {
    let registry: http.Server;
    let registryUrl: string;
    let hits: number;

    beforeEach(async () => {
      hits = 0;
      registry = http.createServer((_req, res) => {
        hits++;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: '999.0.0' }));
      });
      await new Promise<void>((r) => registry.listen(0, '127.0.0.1', r));
      registryUrl = `http://127.0.0.1:${(registry.address() as net.AddressInfo).port}/latest`;
    });

    afterEach(async () => {
      registry.closeAllConnections();
      await new Promise((r) => registry.close(r));
    });

    async function readUpdate(app: Started): Promise<unknown> {
      return (await fetch(`${app.url}/api/update`)).json();
    }

    it('reports a newer version and calls onUpdateAvailable once', async () => {
      const notices: string[] = [];
      const app = await start({
        dataDir: tmp(),
        port: 0,
        uiDir: null,
        env: {},
        updateCheck: { registryUrl, firstDelayMs: 0 },
        onUpdateAvailable: (current, latest) => notices.push(`${current}->${latest}`),
      });
      await waitFor(() => notices.length === 1);
      expect(notices).toEqual([`${APP_VERSION}->999.0.0`]);
      expect(await readUpdate(app)).toEqual({ current: APP_VERSION, latest: '999.0.0', available: true });
    });

    it('stops checking and reports nothing once the setting is turned off', async () => {
      const app = await start({ dataDir: tmp(), port: 0, uiDir: null, env: {}, updateCheck: { registryUrl, firstDelayMs: 0 } });
      await waitFor(() => hits === 1);
      await waitFor(async () => ((await readUpdate(app)) as { available: boolean }).available);
      const res = await fetch(`${app.url}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update_check: false }),
      });
      expect(res.status).toBe(200);
      expect(await readUpdate(app)).toEqual({ current: APP_VERSION, latest: null, available: false });
    });

    it('never asks the registry when NO_UPDATE_NOTIFIER is set', async () => {
      const notices: string[] = [];
      const app = await start({
        dataDir: tmp(),
        port: 0,
        uiDir: null,
        env: NO_UPDATES,
        updateCheck: { registryUrl, firstDelayMs: 0 },
        onUpdateAvailable: (current, latest) => notices.push(`${current}->${latest}`),
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(hits).toBe(0);
      expect(notices).toEqual([]);
      expect(await readUpdate(app)).toEqual({ current: APP_VERSION, latest: null, available: false });
    });
  });
});

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}
