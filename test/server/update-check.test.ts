import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createUpdateChecker,
  fetchLatestVersion,
  formatUpdateNotice,
  isNewerVersion,
  REGISTRY_LATEST_URL,
  type UpdateChecker,
  type UpdateCheckerDeps,
} from '../../src/server/update-check.js';

describe('isNewerVersion', () => {
  it.each([
    ['0.3.1', '0.3.0', true],
    ['0.4.0', '0.3.9', true],
    ['1.0.0', '0.99.99', true],
    ['0.10.0', '0.9.0', true],
    ['0.3.0', '0.3.0', false],
    ['0.2.9', '0.3.0', false],
    ['0.9.0', '0.10.0', false],
  ])('%s is newer than %s: %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });

  it('ignores prereleases and anything that is not plain x.y.z', () => {
    expect(isNewerVersion('0.4.0-beta.1', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.4.0', '0.3.0-beta.1')).toBe(false);
    expect(isNewerVersion('v0.4.0', '0.3.0')).toBe(false);
    expect(isNewerVersion('', '0.3.0')).toBe(false);
  });
});

describe('formatUpdateNotice', () => {
  it('names both versions, the update commands and the restart', () => {
    expect(formatUpdateNotice('0.3.0', '0.3.1')).toBe(
      'Job Applications Tracker 0.3.1 is available (you have 0.3.0). Update with ' +
        '"npm i -g job-applications-tracker@latest" or run "npx job-applications-tracker@latest", then restart the app.\n',
    );
  });
});

describe('fetchLatestVersion', () => {
  let server: http.Server;
  let base: string;
  const seen: { url?: string; accept?: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ url: req.url, accept: req.headers.accept });
      switch (req.url) {
        case '/ok':
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'x', version: '9.8.7' }));
          break;
        case '/prerelease':
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: '1.0.0-rc.1' }));
          break;
        case '/no-version':
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'x' }));
          break;
        case '/not-json':
          res.writeHead(200, { 'content-type': 'text/html' }).end('<html>');
          break;
        case '/missing':
          res.writeHead(404).end();
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

  it('returns the version from the manifest and asks for JSON', async () => {
    seen.length = 0;
    expect(await fetchLatestVersion({ url: `${base}/ok` })).toBe('9.8.7');
    expect(seen).toEqual([{ url: '/ok', accept: 'application/json' }]);
  });

  it.each(['/prerelease', '/no-version', '/not-json', '/missing', '/error'])('returns null for %s', async (path) => {
    expect(await fetchLatestVersion({ url: `${base}${path}` })).toBeNull();
  });

  it('returns null when the registry does not answer in time', async () => {
    expect(await fetchLatestVersion({ url: `${base}/slow`, timeoutMs: 100 })).toBeNull();
  });

  it('returns null when the connection fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    expect(await fetchLatestVersion({ fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(REGISTRY_LATEST_URL, expect.objectContaining({ headers: { accept: 'application/json' } }));
  });
});

describe('createUpdateChecker', () => {
  let enabled: boolean;
  let fetchLatest: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
  let notices: string[];
  let checker: UpdateChecker;

  function build(overrides: Partial<UpdateCheckerDeps> = {}): UpdateChecker {
    return createUpdateChecker({
      currentVersion: '0.3.0',
      enabled: () => enabled,
      env: {},
      fetchLatest,
      onUpdateAvailable: (current, latest) => notices.push(`${current}->${latest}`),
      firstDelayMs: 10_000,
      intervalMs: 86_400_000,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    enabled = true;
    fetchLatest = vi.fn<() => Promise<string | null>>().mockResolvedValue('0.3.1');
    notices = [];
    checker = build();
  });

  afterEach(() => {
    checker.stop();
    vi.useRealTimers();
  });

  it('checks 10 s after start, then every 24 h', async () => {
    checker.start();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchLatest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('reports nothing before the first check', () => {
    checker.start();
    expect(checker.status()).toEqual({ current: '0.3.0', latest: null, available: false });
  });

  it('reports a newer version and announces it once', async () => {
    checker.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(checker.status()).toEqual({ current: '0.3.0', latest: '0.3.1', available: true });
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(notices).toEqual(['0.3.0->0.3.1']);
  });

  it('announces again when a still newer version appears', async () => {
    checker.start();
    await vi.advanceTimersByTimeAsync(10_000);
    fetchLatest.mockResolvedValue('0.4.0');
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(notices).toEqual(['0.3.0->0.3.1', '0.3.0->0.4.0']);
    expect(checker.status().latest).toBe('0.4.0');
  });

  it('reports the same or an older published version as no update, without a notice', async () => {
    fetchLatest.mockResolvedValue('0.3.0');
    checker.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(checker.status()).toEqual({ current: '0.3.0', latest: '0.3.0', available: false });
    expect(notices).toEqual([]);
  });

  it('keeps the last known version when a later check fails', async () => {
    checker.start();
    await vi.advanceTimersByTimeAsync(10_000);
    fetchLatest.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(checker.status()).toEqual({ current: '0.3.0', latest: '0.3.1', available: true });
  });

  it('never checks while the setting is off', async () => {
    enabled = false;
    checker.start();
    await vi.advanceTimersByTimeAsync(86_400_000 * 2);
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(checker.status()).toEqual({ current: '0.3.0', latest: null, available: false });
  });

  it('never checks when NO_UPDATE_NOTIFIER is set, whatever its value or the setting', async () => {
    checker = build({ env: { NO_UPDATE_NOTIFIER: '' } });
    checker.start();
    checker.refresh();
    await vi.advanceTimersByTimeAsync(86_400_000 * 2);
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(checker.status().available).toBe(false);
  });

  it('stops and forgets the result when the setting is turned off, and starts again when turned on', async () => {
    checker.start();
    await vi.advanceTimersByTimeAsync(10_000);
    enabled = false;
    checker.refresh();
    expect(checker.status()).toEqual({ current: '0.3.0', latest: null, available: false });
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    enabled = true;
    checker.refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(checker.status().available).toBe(true);
    // The terminal notice is not repeated for a version already announced.
    expect(notices).toEqual(['0.3.0->0.3.1']);
  });

  it('a refresh while checking is on does not add a second schedule', async () => {
    checker.start();
    checker.refresh();
    checker.refresh();
    await vi.advanceTimersByTimeAsync(10_000 + 86_400_000);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('drops a result that arrives after the check was stopped', async () => {
    let resolve!: (v: string | null) => void;
    fetchLatest.mockReturnValue(new Promise((r) => (resolve = r)));
    checker.start();
    await vi.advanceTimersByTimeAsync(10_000);
    enabled = false;
    checker.refresh();
    enabled = true;
    resolve('0.3.1');
    await vi.advanceTimersByTimeAsync(0);
    expect(checker.status().latest).toBeNull();
    expect(notices).toEqual([]);
  });

  it('a request still in flight from before a stop does not block the next check', async () => {
    let resolve!: (v: string | null) => void;
    fetchLatest.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    checker = build({ firstDelayMs: 0 });
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    enabled = false;
    checker.refresh();
    enabled = true;
    checker.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(checker.status().latest).toBe('0.3.1');
    resolve('0.9.9');
    await vi.advanceTimersByTimeAsync(0);
    expect(checker.status().latest).toBe('0.3.1');
  });

  it('survives a throwing notice or setting read without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      checker = build({
        onUpdateAvailable: () => {
          throw new Error('stdout closed');
        },
      });
      checker.start();
      await vi.advanceTimersByTimeAsync(10_000);
      let reads = 0;
      checker.stop();
      checker = build({
        enabled: () => {
          // start() reads the setting once; the read after the request throws.
          if (++reads > 1) throw new Error('database closed');
          return true;
        },
      });
      checker.start();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchLatest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('refresh before start and after stop does nothing', async () => {
    checker.refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchLatest).not.toHaveBeenCalled();
    checker.start();
    checker.stop();
    checker.refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchLatest).not.toHaveBeenCalled();
  });
});
