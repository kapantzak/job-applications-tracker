import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Run } from '../../../src/server/domain/types.js';
import { makeHarness, SAMPLE_PROFILE, waitFor, type Harness } from './harness.js';

const OTHER_PROFILE = { ...SAMPLE_PROFILE, name: 'Data roles' };

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
  it('POST discover and sync for an unknown profile are 404 and enqueue nothing', async () => {
    for (const kind of ['discover', 'sync']) {
      const res = await h.app.request(`/api/profiles/no-such-profile/runs/${kind}`, { method: 'POST' });
      expect(res.status, kind).toBe(404);
      expect(await res.json()).toEqual({ error: 'Profile not found' });
    }
    expect(h.deps.runsRepo.list(h.profile.id)).toEqual([]);
    expect(h.factoryCalls).toEqual([]);
  });

  it.each(['discover', 'sync'])(
    'POST %s is 404 and enqueues nothing when the profile is deleted during the agent check',
    async (kind) => {
      const factory = h.deps.adapterFactory;
      h.deps.adapterFactory = (settings, runKind) => {
        const adapter = factory(settings, runKind);
        return {
          ...adapter,
          async check() {
            h.deps.profilesRepo.remove(h.profile.id);
            return adapter.check();
          },
        };
      };
      const res = await h.app.request(`${h.base}/runs/${kind}`, { method: 'POST' });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Profile not found' });
      expect(h.deps.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
    },
  );

  it('records the profile on the run and keeps one active run per profile and kind', async () => {
    const other = h.deps.profilesRepo.create(OTHER_PROFILE);
    const first = (await (await h.app.request(`${h.base}/runs/discover`, { method: 'POST' })).json()) as Run;
    const again = (await (await h.app.request(`${h.base}/runs/discover`, { method: 'POST' })).json()) as Run;
    const otherRes = await h.app.request(`/api/profiles/${other.id}/runs/discover`, { method: 'POST' });
    expect(otherRes.status).toBe(202);
    const otherRun = (await otherRes.json()) as Run;
    expect(first.profile_id).toBe(h.profile.id);
    expect(again.id).toBe(first.id);
    expect(otherRun.profile_id).toBe(other.id);
    expect(otherRun.id).not.toBe(first.id);
    expect(h.deps.runsRepo.list(h.profile.id).map((r) => r.id)).toEqual([first.id]);
    expect(h.deps.runsRepo.list(other.id).map((r) => r.id)).toEqual([otherRun.id]);
  });

  it('POST discover with a profile is 202 and GET /api/runs/:id shows it', async () => {
    h.deps.queue.start();
    const res = await h.app.request(`${h.base}/runs/discover`, { method: 'POST' });
    expect(res.status).toBe(202);
    const run = (await res.json()) as Run;
    expect(run.kind).toBe('discover_jobs');

    const got = await h.app.request(`${h.base}/runs/${run.id}`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as Run).id).toBe(run.id);
    await waitFor(() => h.deps.runsRepo.get(run.id)?.status === 'succeeded');
    const list = (await (await h.app.request(`${h.base}/runs`)).json()) as Run[];
    expect(list.map((r) => r.id)).toEqual([run.id]);
  });

  it('POST sync is 202 with the run', async () => {
    const res = await h.app.request(`${h.base}/runs/sync`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(((await res.json()) as Run).kind).toBe('sync_mail');
  });

  it('checks the adapter for the run kind before enqueueing', async () => {
    h.deps.settingsRepo.set({ adapter_id: 'codex' });
    expect((await h.app.request(`${h.base}/runs/discover`, { method: 'POST' })).status).toBe(202);
    expect((await h.app.request(`${h.base}/runs/sync`, { method: 'POST' })).status).toBe(202);
    expect(h.factoryCalls.map((c) => [c.settings.adapter_id, c.kind])).toEqual([
      ['codex', 'discover_jobs'],
      ['codex', 'sync_mail'],
    ]);
  });

  it('POST discover and sync with an adapter that is not installed are 422 and enqueue nothing', async () => {
    h.healthFor.claude = { id: 'claude', installed: false, message: 'Not found on PATH' };
    for (const path of [`${h.base}/runs/discover`, `${h.base}/runs/sync`]) {
      const res = await h.app.request(path, { method: 'POST' });
      expect(res.status, path).toBe(422);
      expect(await res.json()).toEqual({ error: 'Agent "claude" is not installed: Not found on PATH' });
    }
    expect(h.deps.runsRepo.list(h.profile.id)).toEqual([]);
  });

  it('POST discover and sync with an invalid agent command are 422 and enqueue nothing', async () => {
    h.deps.adapterFactory = () => {
      throw new Error('Custom command is empty');
    };
    for (const path of [`${h.base}/runs/discover`, `${h.base}/runs/sync`]) {
      const res = await h.app.request(path, { method: 'POST' });
      expect(res.status, path).toBe(422);
      expect(await res.json()).toEqual({ error: 'Agent command is invalid: Custom command is empty' });
    }
    expect(h.deps.runsRepo.list(h.profile.id)).toEqual([]);
  });
});

describe('runs: reading', () => {
  it('GET /api/runs honours limit and validates it', async () => {
    for (let i = 0; i < 3; i++) h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: '', prompt_version: null });
    const two = (await (await h.app.request(`${h.base}/runs?limit=2`)).json()) as Run[];
    expect(two).toHaveLength(2);
    expect((await h.app.request(`${h.base}/runs?limit=0`)).status).toBe(400);
    expect((await h.app.request(`${h.base}/runs?limit=201`)).status).toBe(400);
    expect((await h.app.request(`${h.base}/runs?limit=abc`)).status).toBe(400);
  });

  it("another profile's run is 404 on every run route", async () => {
    const other = h.deps.profilesRepo.create(OTHER_PROFILE);
    const run = h.deps.runsRepo.create('sync_mail', other.id, { adapter_id: '', prompt_version: null });
    h.deps.logStore.append(run.id, 'belongs to the other profile');
    for (const suffix of ['', '/log', '/events']) {
      const res = await h.app.request(`${h.base}/runs/${run.id}${suffix}`);
      expect(res.status, suffix).toBe(404);
    }
    const cancel = await h.app.request(`${h.base}/runs/${run.id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(404);
    expect(h.deps.runsRepo.get(run.id)?.status).toBe('queued');
  });

  it('unknown or malformed run ids are 404 on every run route', async () => {
    for (const id of ['no-such-run', 'bad.id']) {
      for (const suffix of ['', '/log', '/events']) {
        const res = await h.app.request(`${h.base}/runs/${id}${suffix}`);
        expect(res.status, `${id}${suffix}`).toBe(404);
      }
      const cancel = await h.app.request(`${h.base}/runs/${id}/cancel`, { method: 'POST' });
      expect(cancel.status, `${id}/cancel`).toBe(404);
      expect(await cancel.json()).toEqual({ error: 'Run not found' });
    }
  });

  describe('cancel', () => {
    const cancel = (id: string) => h.app.request(`${h.base}/runs/${id}/cancel`, { method: 'POST' });

    it('cancels a queued run at once and returns it', async () => {
      // The queue is not started, so the run stays queued.
      const run = h.deps.queue.enqueue('sync_mail', h.profile.id);
      const res = await cancel(run.id);
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ id: run.id, status: 'aborted', error: 'Cancelled by user' });
      expect(h.deps.runsRepo.get(run.id)?.status).toBe('aborted');
    });

    it('stops a running run and records it as cancelled', async () => {
      let entered = false;
      h.handlers.discover_jobs = ({ signal }) => {
        entered = true;
        return new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('Aborted'))));
      };
      h.deps.queue.start();
      const run = h.deps.queue.enqueue('discover_jobs', h.profile.id);
      await waitFor(() => entered);
      const res = await cancel(run.id);
      expect(res.status).toBe(202);
      expect(((await res.json()) as { id: string }).id).toBe(run.id);
      await waitFor(() => h.deps.runsRepo.get(run.id)?.status === 'aborted');
      expect(h.deps.runsRepo.get(run.id)?.error).toBe('Cancelled by user');
    });

    it('refuses with 409 once the run is saving its results', async () => {
      let saving = false;
      let release: () => void = () => {};
      h.handlers.discover_jobs = async ({ beginSaving }) => {
        beginSaving();
        saving = true;
        await new Promise<void>((r) => (release = r));
        return { summary: 'saved' };
      };
      h.deps.queue.start();
      const run = h.deps.queue.enqueue('discover_jobs', h.profile.id);
      await waitFor(() => saving);
      const res = await cancel(run.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'This run is saving its results and can no longer be cancelled' });
      release();
      await waitFor(() => h.deps.runsRepo.get(run.id)?.status === 'succeeded');
    });

    it('refuses with 409 for a finished run', async () => {
      const run = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: '', prompt_version: null });
      h.deps.runsRepo.update(run.id, { status: 'failed', error: 'x' });
      const res = await cancel(run.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'This run has already finished' });
      expect(h.deps.runsRepo.get(run.id)?.error).toBe('x');
    });

    it('rejects a cancel from a foreign origin', async () => {
      const run = h.deps.queue.enqueue('sync_mail', h.profile.id);
      const res = await h.app.request(`${h.base}/runs/${run.id}/cancel`, {
        method: 'POST',
        headers: { origin: 'http://evil.example.com' },
      });
      expect(res.status).toBe(403);
      expect(h.deps.runsRepo.get(run.id)?.status).toBe('queued');
    });

    it('rejects a cancel with a foreign Host', async () => {
      const run = h.deps.queue.enqueue('sync_mail', h.profile.id);
      const res = await h.app.request(`${h.base}/runs/${run.id}/cancel`, {
        method: 'POST',
        headers: { host: 'evil.example.com' },
      });
      expect(res.status).toBe(403);
      expect(h.deps.runsRepo.get(run.id)?.status).toBe('queued');
    });
  });

  it('GET log returns the full text as text/plain', async () => {
    const run = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: '', prompt_version: null });
    h.deps.logStore.append(run.id, 'first line');
    h.deps.logStore.append(run.id, 'second line');
    const res = await h.app.request(`${h.base}/runs/${run.id}/log`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('first line\nsecond line\n');
  });
});

describe('runs: events', () => {
  it('streams a line appended after the request started, then sends done', async () => {
    blockDiscover();
    h.deps.queue.start();
    const run = (await (await h.app.request(`${h.base}/runs/discover`, { method: 'POST' })).json()) as Run;
    await waitFor(() => h.deps.runsRepo.get(run.id)?.status === 'running');

    const res = await h.app.request(`${h.base}/runs/${run.id}/events`);
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
    const run = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: '', prompt_version: null });
    h.deps.logStore.append(run.id, 'old one');
    h.deps.logStore.append(run.id, 'old two');
    h.deps.runsRepo.update(run.id, { status: 'failed', error: 'boom' });
    const text = await (await h.app.request(`${h.base}/runs/${run.id}/events`)).text();
    expect(text).toBe(
      'event: line\ndata: old one\n\nevent: line\ndata: old two\n\nevent: done\ndata: failed\n\n',
    );
  });

  it('unsubscribes when the client disconnects', async () => {
    const run = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: '', prompt_version: null });
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
    const res = await h.app.request(`${h.base}/runs/${run.id}/events`);
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

  it('keeps logs of queued and running runs of every profile', async () => {
    const other = h.deps.profilesRepo.create(OTHER_PROFILE);
    const queued = h.deps.runsRepo.create('discover_jobs', other.id, { adapter_id: '', prompt_version: null });
    const running = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: '', prompt_version: null });
    h.deps.runsRepo.update(running.id, { status: 'running' });
    const done = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: '', prompt_version: null });
    h.deps.runsRepo.update(done.id, { status: 'succeeded' });
    for (const r of [queued, running, done]) h.deps.logStore.append(r.id, 'x');
    const res = await h.app.request('/api/runs/logs', { method: 'DELETE' });
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(existsSync(join(h.deps.runsDir, `${queued.id}.log`))).toBe(true);
    expect(existsSync(join(h.deps.runsDir, `${running.id}.log`))).toBe(true);
  });
});
