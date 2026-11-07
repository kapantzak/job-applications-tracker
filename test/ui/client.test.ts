import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  cancelRun,
  dismissJob,
  getModelCatalogs,
  getRunLog,
  listJobs,
  startDiscovery,
  createProfile,
  deleteProfile,
  discardCvAnalysis,
  getCvAnalysis,
  retryCvAnalysis,
  updateProfile,
  uploadCv,
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

const PROFILE_INPUT = {
  name: 'Platform roles',
  target_roles: ['Engineer'],
  locations: [],
  remote: 'any' as const,
  seniority: '',
  keywords: [],
  excluded_companies: [],
  notes: '',
};

describe('api client', () => {
  it("listJobs calls GET on the profile's jobs and returns the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 'j1' }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(listJobs('p 1', { includeDead: true })).resolves.toEqual([{ id: 'j1' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/profiles/p%201/jobs?includeDead=1');
    expect(init.method).toBe('GET');
    expect(init.headers).toBeUndefined();
  });

  it('updateProfile PUTs JSON to the profile and throws ApiError with the server error on 409', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'A profile named "X" already exists' }, 409));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const err = await updateProfile('p1', PROFILE_INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'A profile named "X" already exists' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/profiles/p1');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify(PROFILE_INPUT));
  });

  it('createProfile POSTs to /api/profiles and deleteProfile DELETEs the profile', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'p1', ...PROFILE_INPUT }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await createProfile(PROFILE_INPUT)).toMatchObject({ id: 'p1' });
    await expect(deleteProfile('p1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit).method])).toEqual([
      ['/api/profiles', 'POST'],
      ['/api/profiles/p1', 'DELETE'],
    ]);
  });

  it('sends the CV analysis calls to the new-profile routes, or to the profile with an id (SOW-0024)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(null));
    await getCvAnalysis();
    await getCvAnalysis('p 1');
    await retryCvAnalysis('p 1');
    await discardCvAnalysis('p 1');
    await uploadCv(new File(['x'], 'CV é.pdf'), 'p 1');
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/cv-analysis', 'GET'],
      ['/api/profiles/p%201/cv-analysis', 'GET'],
      ['/api/profiles/p%201/cv-analysis/retry', 'POST'],
      ['/api/profiles/p%201/cv-analysis', 'DELETE'],
      ['/api/profiles/p%201/cv-analysis', 'POST'],
    ]);
    expect(fetchMock.mock.calls[4]![1]!.headers).toEqual({
      'Content-Type': 'application/octet-stream',
      'X-File-Name': 'CV%20%C3%A9.pdf',
    });
  });

  it('updateProfile sends the applied CV analysis with the fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ id: 'p1' }));
    await updateProfile('p1', PROFILE_INPUT, 'cva1');
    expect(fetchMock.mock.calls[0]![1]!.body).toBe(JSON.stringify({ ...PROFILE_INPUT, cv_analysis_id: 'cva1' }));
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
    expect(await cancelRun('p1', 'r 1')).toEqual({ id: 'r 1', status: 'aborted' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/profiles/p1/runs/r%201/cancel');
    expect(init.method).toBe('POST');
  });

  it('startDiscovery posts the effort mode as JSON, default when not given', async () => {
    // spyOn, so restoreAllMocks puts the real fetch back.
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ id: 'r1', effort_mode: 'max' }, 202));
    expect(await startDiscovery('p1', 'max')).toEqual({ id: 'r1', effort_mode: 'max' });
    await startDiscovery('p1');
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual(['/api/profiles/p1/runs/discover', '/api/profiles/p1/runs/discover']);
    expect(calls.map(([, init]) => [init.method, init.body])).toEqual([
      ['POST', JSON.stringify({ mode: 'max' })],
      ['POST', JSON.stringify({ mode: 'default' })],
    ]);
    expect(calls[0]![1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('dismissJob returns undefined on 204 without parsing a body', async () => {
    const res = new Response(null, { status: 204 });
    const json = vi.spyOn(res, 'json');
    globalThis.fetch = vi.fn().mockResolvedValue(res) as unknown as typeof fetch;

    await expect(dismissJob('p1', 'j1')).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('throws ApiError when a 2xx body is not JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 200 })) as unknown as typeof fetch;
    await expect(listJobs('p1')).rejects.toMatchObject({ status: 200, message: 'Invalid JSON response' });
  });

  it('getRunLog returns text and maps errors to ApiError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('a\nb\n', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Run not found' }, 404));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getRunLog('p1', 'r1')).resolves.toBe('a\nb\n');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/profiles/p1/runs/r1/log');
    await expect(getRunLog('p1', 'r2')).rejects.toMatchObject({ status: 404, message: 'Run not found' });
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

    subscribeRunEvents('p1', 'r1', onLine, onDone);
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0] as FakeEventSource;
    expect(source.url).toBe('/api/profiles/p1/runs/r1/events');

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
