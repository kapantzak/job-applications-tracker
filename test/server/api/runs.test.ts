import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../../../src/server/domain/types.js';
import { makeHarness, SAMPLE_PROFILE, waitFor, type Harness } from './harness.js';

let h: Harness;
let release: (() => void) | null;

beforeEach(() => {
  h = makeHarness();
  release = null;
});

afterEach(async () => {
  release?.();
  await h.cleanup();
});

// Makes discover_jobs block until the returned function is called.
function blockDiscover(): void {
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.handlers.discover_jobs = async () => {
    await gate;
    return { summary: 'ok' };
  };
}

const decoder = new TextDecoder();

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  acc: { text: string },
  needle: string,
): Promise<void> {
  while (!acc.text.includes(needle)) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`stream ended before ${JSON.stringify(needle)}; got ${acc.text}`);
    acc.text += decoder.decode(value, { stream: true });
  }
}

describe('runs: enqueue', () => {
  it('POST discover without a profile is 422 and enqueues nothing', async () => {
    const res = await h.app.request('/api/runs/discover', { method: 'POST' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'Profile is not set' });
    expect(h.deps.runsRepo.list()).toEqual([]);
  });

  it('POST discover with a profile is 202 and GET /api/runs/:id shows it', async () => {
    h.deps.profileRepo.save(SAMPLE_PROFILE);
    h.deps.queue.start();
    const res = await h.app.request('/api/runs/discover', { method: 'POST' });
    expect(res.status).toBe(202);
    const run = (await res.json()) as Run;
    expect(run.kind).toBe('discover_jobs');

    const got = await h.app.request(`/api/runs/${run.id}`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as Run).id).toBe(run.id);
    await waitFor(() => h.deps.runsRepo.get(run.id)?.status === 'succeeded');
    const list = (await (await h.app.request('/api/runs')).json()) as Run[];
    expect(list.map((r) => r.id)).toEqual([run.id]);
  });

  it('POST sync is 202 with the run', async () => {
    const res = await h.app.request('/api/runs/sync', { method: 'POST' });
    expect(res.status).toBe(202);
    expect(((await res.json()) as Run).kind).toBe('sync_mail');
  });

  it('maps a "Profile is not set" error from below to 422', async () => {
    h.deps.profileRepo.save(SAMPLE_PROFILE);
    vi.spyOn(h.deps.queue, 'enqueue').mockImplementation(() => {
      throw new Error('Profile is not set');
    });
    const res = await h.app.request('/api/runs/discover', { method: 'POST' });
    expect(res.status).toBe(422);
  });
});

describe('runs: reading', () => {
  it('GET /api/runs honours limit and validates it', async () => {
    for (let i = 0; i < 3; i++) h.deps.runsRepo.create('sync_mail', { adapter_id: '', prompt_version: null });
    const two = (await (await h.app.request('/api/runs?limit=2')).json()) as Run[];
    expect(two).toHaveLength(2);
    expect((await h.app.request('/api/runs?limit=0')).status).toBe(400);
    expect((await h.app.request('/api/runs?limit=201')).status).toBe(400);
    expect((await h.app.request('/api/runs?limit=abc')).status).toBe(400);
  });

  it('unknown or malformed run ids are 404 on every run route', async () => {
    for (const id of ['no-such-run', 'bad.id']) {
      for (const suffix of ['', '/log', '/events']) {
        const res = await h.app.request(`/api/runs/${id}${suffix}`);
        expect(res.status, `${id}${suffix}`).toBe(404);
      }
    }
  });

  it('GET log returns the full text as text/plain', async () => {
    const run = h.deps.runsRepo.create('sync_mail', { adapter_id: '', prompt_version: null });
    h.deps.logStore.append(run.id, 'first line');
    h.deps.logStore.append(run.id, 'second line');
    const res = await h.app.request(`/api/runs/${run.id}/log`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('first line\nsecond line\n');
  });
});

describe('runs: events', () => {
  it('streams a line appended after the request started, then sends done', async () => {
    h.deps.profileRepo.save(SAMPLE_PROFILE);
    blockDiscover();
    h.deps.queue.start();
    const run = (await (await h.app.request('/api/runs/discover', { method: 'POST' })).json()) as Run;
    await waitFor(() => h.deps.runsRepo.get(run.id)?.status === 'running');

    const res = await h.app.request(`/api/runs/${run.id}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const acc = { text: '' };
    await readUntil(reader, acc, 'started');

    h.deps.logStore.append(run.id, 'live line from the test');
    await readUntil(reader, acc, 'event: line\ndata: live line from the test');

    release?.();
    await readUntil(reader, acc, 'event: done\ndata: succeeded');
    expect((await reader.read()).done).toBe(true);
  });

  it('replays the log and sends done at once for a finished run', async () => {
    const run = h.deps.runsRepo.create('sync_mail', { adapter_id: '', prompt_version: null });
    h.deps.logStore.append(run.id, 'old one');
    h.deps.logStore.append(run.id, 'old two');
    h.deps.runsRepo.update(run.id, { status: 'failed', error: 'boom' });
    const text = await (await h.app.request(`/api/runs/${run.id}/events`)).text();
    expect(text).toBe(
      'event: line\ndata: old one\n\nevent: line\ndata: old two\n\nevent: done\ndata: failed\n\n',
    );
  });

  it('unsubscribes when the client disconnects', async () => {
    const run = h.deps.runsRepo.create('sync_mail', { adapter_id: '', prompt_version: null });
    h.deps.runsRepo.update(run.id, { status: 'running' });
    const original = h.deps.logStore.subscribe;
    let active = 0;
    h.deps.logStore.subscribe = (id, cb) => {
      active++;
      const off = original(id, cb);
      return () => {
        active--;
        off();
      };
    };
    const res = await h.app.request(`/api/runs/${run.id}/events`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    h.deps.logStore.append(run.id, 'hello');
    await readUntil(reader, { text: '' }, 'hello');
    expect(active).toBe(1);
    await reader.cancel();
    await waitFor(() => active === 0);
  });
});

describe('runs: purge logs', () => {
  it('DELETE logs with two log files returns deleted 2 and empties the directory', async () => {
    writeFileSync(join(h.deps.runsDir, 'run-a.log'), 'a\n');
    writeFileSync(join(h.deps.runsDir, 'run-b.log'), 'b\n');
    const res = await h.app.request('/api/runs/logs', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(readdirSync(h.deps.runsDir)).toEqual([]);
  });

  it('keeps logs of queued and running runs', async () => {
    const queued = h.deps.runsRepo.create('discover_jobs', { adapter_id: '', prompt_version: null });
    const running = h.deps.runsRepo.create('sync_mail', { adapter_id: '', prompt_version: null });
    h.deps.runsRepo.update(running.id, { status: 'running' });
    const done = h.deps.runsRepo.create('sync_mail', { adapter_id: '', prompt_version: null });
    h.deps.runsRepo.update(done.id, { status: 'succeeded' });
    for (const r of [queued, running, done]) h.deps.logStore.append(r.id, 'x');
    const res = await h.app.request('/api/runs/logs', { method: 'DELETE' });
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(existsSync(join(h.deps.runsDir, `${queued.id}.log`))).toBe(true);
    expect(existsSync(join(h.deps.runsDir, `${running.id}.log`))).toBe(true);
  });
});
