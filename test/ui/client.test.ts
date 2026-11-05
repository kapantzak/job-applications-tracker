import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, listJobs, putProfile } from '../../src/ui/api/client.js';

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
});
