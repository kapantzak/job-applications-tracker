import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  cancelRun,
  dismissJob,
  getModelCatalogs,
  getRunLog,
  listJobs,
  putProfile,
  subscribeRunEvents,
} from '../../src/ui/api/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('listJobs calls GET /api/jobs and returns the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 'j1' }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(listJobs()).resolves.toEqual([{ id: 'j1' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/jobs');
    expect(init.method).toBe('GET');
    expect(init.headers).toBeUndefined();
  });

  it('putProfile throws ApiError with the server error on 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'target_roles required' }, 400));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const err = await putProfile({ target_roles: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: 'target_roles required' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/profile');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ target_roles: [] }));
  });

  it('getModelCatalogs calls GET /api/setup/models', async () => {
    const body = { claude: { source: 'static', models: [], efforts: [] }, codex: { source: 'unavailable', models: [], efforts: [] } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await getModelCatalogs()).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/setup/models');
    expect(init.method).toBe('GET');
  });

  it('cancelRun posts to the run cancel route and returns the run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'r 1', status: 'aborted' }, 202));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await cancelRun('r 1')).toEqual({ id: 'r 1', status: 'aborted' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/runs/r%201/cancel');
    expect(init.method).toBe('POST');
  });

  it('dismissJob returns undefined on 204 without parsing a body', async () => {
    const res = new Response(null, { status: 204 });
    const json = vi.spyOn(res, 'json');
    globalThis.fetch = vi.fn().mockResolvedValue(res) as unknown as typeof fetch;

    await expect(dismissJob('j1')).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('throws ApiError when a 2xx body is not JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 200 })) as unknown as typeof fetch;
    await expect(listJobs()).rejects.toMatchObject({ status: 200, message: 'Invalid JSON response' });
  });

  it('getRunLog returns text and maps errors to ApiError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('a\nb\n', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Run not found' }, 404));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getRunLog('r1')).resolves.toBe('a\nb\n');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/runs/r1/log');
    await expect(getRunLog('r2')).rejects.toMatchObject({ status: 404, message: 'Run not found' });
  });
});

describe('subscribeRunEvents', () => {
  type Listener = (event: { data: string }) => void;

  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    listeners = new Map<string, Listener[]>();
    close = vi.fn();
    constructor(public url: string) {
      FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, fn: Listener): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    emit(type: string, data = ''): void {
      for (const fn of this.listeners.get(type) ?? []) fn({ data });
    }
  }

  it('forwards lines, closes once on done and does not reconnect after error', () => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    const onLine = vi.fn();
    const onDone = vi.fn();

    subscribeRunEvents('r1', onLine, onDone);
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0] as FakeEventSource;
    expect(source.url).toBe('/api/runs/r1/events');

    source.emit('line', 'hello');
    source.emit('done', 'succeeded');
    expect(onLine).toHaveBeenCalledWith('hello');
    expect(onDone).toHaveBeenCalledWith('succeeded');
    expect(source.close).toHaveBeenCalledTimes(1);

    source.emit('error');
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
