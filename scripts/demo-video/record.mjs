// Records the README demo video (SOW-0048): docs/video/demo.mp4 and docs/video/demo-poster.png.
// Run with `npm run demo:video`, which builds the app and installs playwright-core under .tmp/demo-video
// (never a project dependency). Runs under tsx so it can reuse the mock sandbox's helpers.
// Everything shown is invented: a fresh data folder, the mock agent in --demo mode, an invented CV.
// Needs a network connection: the app checks the mock job links on example.com.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockAgentCommand } from '../sandbox-mock/seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'job-applications-tracker') throw new Error(`Refusing to run: ${root} is not the job-applications-tracker checkout`);

const work = join(root, '.tmp', 'demo-video');
const dataDir = join(work, 'data');
const framesDir = join(work, 'frames');
const cvFile = join(work, 'sam-placeholder-cv.pdf');
const outDir = join(root, 'docs', 'video');
const VIEWPORT = { width: 1440, height: 900 };
// How long the opening still of the Journey graph shows before the walkthrough (SOW-0050).
const INTRO_SECONDS = 2;
// Each mock task takes this long, so the progress screens are visible but short.
const AGENT_DELAY_MS = 4000;

const require = createRequire(join(work, 'noop.js'));
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  throw new Error('playwright-core is missing. Run "npm run demo:video", which installs it under .tmp/demo-video.');
}

// The data folder and frames are deleted on every run; a symbolic link could point the delete elsewhere.
for (const dir of [join(root, '.tmp'), work, dataDir, framesDir]) {
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error(`Refusing to delete under ${dir}: it is a symbolic link`);
}
rmSync(dataDir, { recursive: true, force: true });
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(root, 'dist', 'ui', 'index.html'))) throw new Error('The app is not built. Run "npm run demo:video".');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Installs the headless Chromium this playwright-core expects, if missing. PLAYWRIGHT_SKIP_BROWSER_GC keeps
// the install from deleting browsers other Playwright copies on this machine still use (SOW-0048).
if (!process.env.DEMO_CHROMIUM_PATH) {
  const r = spawnSync(process.execPath, [join(dirname(require.resolve('playwright-core/package.json')), 'cli.js'), 'install', 'chromium-headless-shell'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: '1' },
  });
  if (r.status !== 0) throw new Error('Could not install the headless Chromium for playwright-core');
}

// --- The app ---------------------------------------------------------------------------------------------

function startApp() {
  const child = spawn(process.execPath, [join(root, 'bin', 'jobtrack.js'), '--data-dir', dataDir, '--no-open', '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // No update notice in the recording, whatever npm has published since (SOW-0053).
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
  return new Promise((resolveStart, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`The app did not start within 30 s: ${out}`));
    }, 30_000);
    const onData = (chunk) => {
      out += chunk;
      const m = /running at (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolveStart({ child, url: m[1] });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The app exited early (${code}): ${out}`));
    });
  });
}

async function stopApp(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await exited;
}

async function api(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Host: new URL(base).host, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// --- The CV ----------------------------------------------------------------------------------------------

// The seed's invented CV as a one-page PDF, so the upload looks like a real user's file.
async function writeCvPdf(browser) {
  const md = readFileSync(join(root, 'scripts', 'sandbox-mock', 'cv.md'), 'utf8');
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = md
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${esc(line.slice(2))}</h1>`;
      if (line.startsWith('## ')) return `<h2>${esc(line.slice(3))}</h2>`;
      if (line.startsWith('- ')) return `<li>${esc(line.slice(2))}</li>`;
      return line.trim() ? `<p>${esc(line)}</p>` : '';
    })
    .join('\n');
  const page = await browser.newPage();
  await page.setContent(
    `<style>body{font:11pt/1.5 Helvetica,Arial,sans-serif;margin:48px;color:#111}h1{font-size:20pt;margin:0 0 4px}` +
      `h2{font-size:12pt;margin:20px 0 6px;text-transform:uppercase;letter-spacing:.05em}li{margin:2px 0 2px 18px}p{margin:4px 0}</style>${html}`,
  );
  await page.pdf({ path: cvFile, format: 'A4' });
  await page.close();
}

// --- On-page captions, pointer and cards -------------------------------------------------------------------

// Injected into every document; nothing here changes the app, it only draws on top of it.
const OVERLAY = () => {
  const css = `
    #demo-caption{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);max-width:960px;z-index:2147483646;
      background:rgba(15,23,42,.92);color:#fff;font:600 22px/1.4 'Manrope Variable',system-ui,sans-serif;padding:14px 26px;
      border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;transition:opacity .35s;pointer-events:none;text-align:center}
    #demo-caption.on{opacity:1}
    #demo-pointer{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;z-index:2147483647;
      background:rgba(37,99,235,.28);border:2px solid rgba(37,99,235,.95);pointer-events:none;transition:transform .15s}
    #demo-pointer.down{transform:scale(.7)}
    .demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(37,99,235,.7);
      z-index:2147483647;pointer-events:none;animation:demo-ripple .5s ease-out forwards}
    @keyframes demo-ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
    #demo-card{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:18px;background:rgba(255,255,255,.97);font-family:'Manrope Variable',system-ui,sans-serif;color:#0f172a;opacity:0;
      transition:opacity .4s;pointer-events:none;text-align:center}
    #demo-card.on{opacity:1}
    #demo-card h1{font-size:46px;font-weight:700;margin:0}
    #demo-card p{font-size:22px;margin:0;color:#475569}
    #demo-card code{font:600 24px ui-monospace,Menlo,monospace;background:#0f172a;color:#fff;padding:14px 26px;border-radius:12px}
    #demo-card .play{width:96px;height:96px;border-radius:50%;background:#0f172a;display:flex;align-items:center;justify-content:center}
    #demo-card .play:after{content:'';margin-left:8px;border-style:solid;border-width:20px 0 20px 34px;border-color:transparent transparent transparent #fff}`;
  const add = () => {
    if (document.getElementById('demo-caption')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    for (const id of ['demo-caption', 'demo-pointer', 'demo-card']) {
      const el = document.createElement('div');
      el.id = id;
      document.body.append(el);
    }
    const pointer = document.getElementById('demo-pointer');
    pointer.style.transform = 'translate(720px,450px)';
    document.addEventListener('mousemove', (e) => {
      pointer.style.left = `${e.clientX}px`;
      pointer.style.top = `${e.clientY}px`;
      pointer.style.transform = '';
    }, true);
    document.addEventListener('mousedown', (e) => {
      pointer.classList.add('down');
      const ripple = document.createElement('div');
      ripple.className = 'demo-ripple';
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      document.body.append(ripple);
      setTimeout(() => ripple.remove(), 600);
    }, true);
    document.addEventListener('mouseup', () => pointer.classList.remove('down'), true);
  };
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add);
};

function director(page) {
  let x = VIEWPORT.width / 2;
  let y = VIEWPORT.height / 2;
  const self = {
    async caption(text, holdMs = 3200) {
      await page.evaluate((t) => {
        const el = document.getElementById('demo-caption');
        // Clearing keeps the old text while it fades, so no empty bar flashes.
        if (t) el.textContent = t;
        el.classList.toggle('on', Boolean(t));
      }, text);
      if (text) await sleep(holdMs);
    },
    async card(html) {
      await page.evaluate((h) => {
        const el = document.getElementById('demo-card');
        el.innerHTML = h;
        el.classList.toggle('on', Boolean(h));
        document.getElementById('demo-pointer').style.display = h ? 'none' : '';
      }, html);
      await sleep(450);
    },
    // Glides the pointer so viewers can follow it; Playwright's own moves are instant.
    async moveTo(tx, ty) {
      const steps = Math.max(12, Math.round(Math.hypot(tx - x, ty - y) / 22));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        await page.mouse.move(x + (tx - x) * e, y + (ty - y) * e);
        await sleep(14);
      }
      x = tx;
      y = ty;
    },
    async point(locator) {
      await locator.scrollIntoViewIfNeeded();
      let box = await locator.boundingBox();
      // Keep the target clear of the caption bar at the bottom of the screen.
      if (box && box.y + box.height > VIEWPORT.height - 150) {
        await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await sleep(700);
        box = await locator.boundingBox();
      }
      if (!box) throw new Error('Element has no box');
      await self.moveTo(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(250);
    },
    async click(locator) {
      await self.point(locator);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
      await sleep(500);
    },
    async scroll(dy, steps = 20) {
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, dy / steps);
        await sleep(25);
      }
      await sleep(400);
    },
  };
  return self;
}

// --- Frame capture -----------------------------------------------------------------------------------------

// A DevTools screencast is sharper than Playwright's recordVideo (pilot in SOW-0048); frames arrive only when
// the screen changes, so each one is shown until the next one's timestamp.
async function startCapture(context, page) {
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = join(framesDir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
  return {
    async stop() {
      await cdp.send('Page.stopScreencast');
      const end = Date.now() / 1000;
      if (frames.length === 0) throw new Error('No frames were captured');
      // A copy, so a frame arriving late while the opening still is prepared cannot join the list.
      return { frames: frames.slice(), end };
    },
  };
}

// The opening still goes first, so players that show the first frame before playback show the Journey graph.
function writeConcatList({ frames, end }, intro) {
  // The concat list quotes paths with '; a ' inside the path is written as '\''.
  const q = (file) => `file '${file.replace(/'/g, "'\\''")}'`;
  const lines = [q(intro.file), `duration ${intro.seconds.toFixed(3)}`];
  lines.push(...frames.flatMap((f, i) => [q(f.file), `duration ${Math.max(0.001, (frames[i + 1]?.t ?? end) - f.t).toFixed(3)}`]));
  // The concat demuxer ignores the last duration unless the last file is listed again.
  lines.push(q(frames.at(-1).file));
  const list = join(work, 'frames.txt');
  writeFileSync(list, `${lines.join('\n')}\n`);
  return list;
}

function encode(list, out) {
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=out_range=tv,format=yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709',
      '-color_trc', 'bt709', '-color_range', 'tv', '-c:v', 'libx264', '-crf', '20',
      '-preset', 'slow', '-movflags', '+faststart', '-an', out],
    { stdio: 'inherit' },
  );
  if (r.error) throw new Error(`ffmpeg could not start (${r.error.message}); install ffmpeg and try again`);
  if (r.status !== 0) throw new Error(`ffmpeg failed with exit code ${r.status}`);
}

// The encoded length, for the poster: the concat demuxer holds the last frame (the end card) once more.
function probeSeconds(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.error) throw new Error(`ffprobe could not start (${r.error.message}); install ffmpeg (it includes ffprobe) and try again`);
  const seconds = Number.parseFloat(r.stdout);
  if (r.status !== 0 || !Number.isFinite(seconds)) throw new Error(`ffprobe could not read ${file}`);
  return seconds;
}

// --- The storyboard (user-approved captions, SOW-0048 decision 15) --------------------------------------------

// --- Many applications for the Journey scene (SOW-0049) -------------------------------------------------

// User decision 3: where the 42 sent applications stopped, the demo's own two included, plus 3 saved.
const JOURNEY = {
  applied: { waiting: 12, rejected: 8, no_response: 3, withdrawn: 1 },
  screening: { waiting: 3, rejected: 6, no_response: 0, withdrawn: 1 },
  interview: { waiting: 2, rejected: 4, no_response: 0, withdrawn: 0 },
  offer: { waiting: 2, rejected: 0, no_response: 0, withdrawn: 0 },
};
const JOURNEY_FUNNEL = { applied: 42, screening: 18, interview: 8, offer: 2 };
const JOURNEY_SAVED = 3;
const STAGES = ['applied', 'screening', 'interview', 'offer'];
const ROLES = ['Senior Frontend Engineer', 'Frontend Platform Engineer', 'Senior React Developer', 'UI Engineer'];

// Adds what the profile lacks for decision 3 through the app's own routes. Status changes go through the
// status route so each leaves the history row that funnel reach counts.
async function addJourneyApplications(base) {
  const profiles = await api(base, 'GET', '/api/profiles');
  if (profiles.length !== 1) throw new Error(`Expected one profile, found ${profiles.length}`);
  const scope = `/api/profiles/${profiles[0].id}`;
  const before = await api(base, 'GET', `${scope}/dashboard`);
  const plans = [];
  for (const [i, stage] of STAGES.entries()) {
    for (const [exit, want] of Object.entries(JOURNEY[stage])) {
      const missing = want - before.stopped_at[stage][exit];
      if (missing < 0) throw new Error(`The demo already has more than ${want} ${exit} at ${stage}`);
      const steps = [...STAGES.slice(1, i + 1), ...(exit === 'waiting' ? [] : [exit])];
      for (let k = 0; k < missing; k++) plans.push({ start: 'applied', steps });
    }
  }
  const saved = JOURNEY_SAVED - before.status_counts.saved;
  if (saved < 0) throw new Error(`The demo already has more than ${JOURNEY_SAVED} saved`);
  for (let k = 0; k < saved; k++) plans.push({ start: 'saved', steps: [] });

  for (const [n, plan] of plans.entries()) {
    // Plainly invented names: the card hides them, and word-based names could match real companies.
    const company = `Example Company ${String(n + 1).padStart(2, '0')}`;
    const app = await api(base, 'POST', `${scope}/applications`, { company, role: ROLES[n % ROLES.length], status: plan.start });
    for (const status of plan.steps) await api(base, 'POST', `${scope}/applications/${app.id}/status`, { status });
  }

  const after = await api(base, 'GET', `${scope}/dashboard`);
  // Spreading over the expected object fixes key order; the key count stops a missing key passing as expected.
  const same = (got, want) =>
    got != null && Object.keys(got).length === Object.keys(want).length && JSON.stringify({ ...want, ...got }) === JSON.stringify(want);
  const stoppedOk = STAGES.every((s) => same(after.stopped_at[s], JOURNEY[s]));
  if (!same(after.funnel, JOURNEY_FUNNEL) || !stoppedOk || after.status_counts.saved !== JOURNEY_SAVED) {
    throw new Error(`Journey numbers differ from decision 3: ${JSON.stringify({ funnel: after.funnel, stopped: after.stopped_at })}`);
  }
}

async function storyboard(page, d, base) {
  const card = (sel) => page.locator('[data-slot="card"]').filter({ hasText: sel });

  // 1. Empty start screen.
  await page.getByText('Start from your CV').first().waitFor();
  await sleep(600);
  await d.caption('Find jobs and track applications. Runs on your machine.', 3600);

  // 2. Upload the CV.
  await d.caption('Start from your CV: PDF, Word or text.', 600);
  await d.point(page.getByText('Start from your CV').first());
  await page.locator('input[type="file"]').setInputFiles(cvFile);
  await sleep(1800);
  await d.click(page.getByRole('button', { name: 'Analyse CV' }));

  // 3. The agent drafts a profile.
  await d.caption('Your own agent CLI drafts a profile from it.', 500);
  const review = page.getByRole('button', { name: 'Review and create' });
  await review.waitFor({ timeout: 60_000 });
  await sleep(1000);

  // 4. Review and create.
  await d.click(review);
  await page.getByRole('button', { name: 'Create profile' }).waitFor();
  await d.caption('Check the draft. Nothing is saved until you create it.', 1200);
  await d.scroll(520);
  await sleep(1200);
  // The button sits at the bottom of the form, under the caption bar.
  await d.caption('', 0);
  await sleep(400);
  await d.click(page.getByRole('button', { name: 'Create profile' }));

  // 5. Find jobs.
  await page.getByTestId('count-in-progress').waitFor();
  await sleep(900);
  await d.click(page.getByRole('button', { name: 'Find jobs', exact: true }));
  await d.caption('Your agent searches the web. Follow along in plain words.', 500);
  const viewJobs = page.getByRole('link', { name: 'View jobs' });
  await viewJobs.waitFor({ timeout: 90_000 });
  await sleep(1600);

  // 6. Jobs list.
  await d.click(viewJobs);
  await page.getByRole('table').waitFor();
  if ((await page.getByText('Verified', { exact: true }).count()) === 0) {
    throw new Error('No job link was verified. The recording needs a network connection (the mock links are on example.com).');
  }
  await d.caption('The app checks every link. Fit shows location, remote and seniority.', 600);
  await d.point(page.getByText('Verified', { exact: true }).first());
  await sleep(1300);
  await d.point(page.getByRole('columnheader', { name: /Fit/ }));
  await sleep(1300);

  // 7. Mark applied.
  await d.caption('Applied? Mark it and the app tracks it.', 500);
  await d.click(page.getByRole('button', { name: 'Mark applied' }).first());
  // Reaching the button scrolls the table sideways; bring the company names back into view.
  await page.getByRole('table').evaluate((table) => {
    for (let el = table.parentElement; el; el = el.parentElement) {
      if (el.scrollLeft > 0) el.scrollTo({ left: 0, behavior: 'smooth' });
    }
  });
  await sleep(1800);

  // 8. Gmail sync.
  await d.caption('', 0);
  await d.click(page.getByRole('link', { name: 'Applications', exact: true }));
  await page.getByRole('table').waitFor();
  await sleep(700);
  await d.click(page.getByRole('button', { name: 'Sync from Gmail', exact: true }));
  await d.caption('Your agent reads replies about your applications.', 500);
  const reviewLink = page.getByRole('link', { name: 'Review proposals' });
  await reviewLink.waitFor({ timeout: 90_000 });
  await sleep(1500);

  // 9. Review.
  await d.click(reviewLink);
  await page.getByRole('heading', { name: 'New applications' }).waitFor();
  await d.caption('Every proposal shows the email as evidence. Nothing changes until you accept.', 1400);
  const contoso = card('Contoso Pharma');
  await d.point(contoso.locator('blockquote'));
  await sleep(1400);
  await d.click(contoso.getByRole('button', { name: 'Accept' }));
  await sleep(1200);
  const interview = card('technical interview');
  await d.point(interview.locator('blockquote'));
  await sleep(1200);
  await d.click(interview.getByRole('button', { name: 'Accept' }));
  await sleep(1400);

  // 10. Dashboard and end card.
  await d.caption('', 0);
  await d.click(page.getByRole('link', { name: 'Dashboard', exact: true }));
  await page.getByTestId('count-in-progress').waitFor();
  await sleep(600);
  await d.caption('See where every application stands.', 3400);
  await d.caption('', 0);

  // 11. Weeks later: the Journey graph (SOW-0049). The data is added and the app navigated while the card
  // covers the screen; DOM clicks keep the drawn pointer still, and in-app navigation keeps the overlay.
  await d.card('<h1>A few weeks later: 42 applications sent.</h1>');
  const shown = Date.now();
  await addJourneyApplications(base);
  const nav = (name) => page.getByRole('link', { name, exact: true }).evaluate((a) => a.click());
  await nav('Applications');
  await page.getByRole('table').waitFor();
  await nav('Dashboard');
  const graph = page.locator('svg[role="img"]').filter({ has: page.locator('g[data-stage="offer"]') });
  await graph.waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await graph.boundingBox();
  if (!box || box.y + box.height > VIEWPORT.height - 150) {
    // Start at the tiles, so the filter toolbar above them is fully out of view rather than cut through
    // (SOW-0054, decision 13A); centre the graph only if it still does not fit.
    await page.evaluate(() => {
      const tile = document.querySelector('[data-testid="count-in-progress"]')?.closest('[data-slot="card"]');
      if (tile) window.scrollTo(0, tile.getBoundingClientRect().top + window.scrollY - 24);
    });
    const moved = await graph.boundingBox();
    if (!moved || moved.y < 0 || moved.y + moved.height > VIEWPORT.height - 150) {
      await graph.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    }
  }
  await sleep(Math.max(0, 3000 - (Date.now() - shown)));
  await d.card('');
  await sleep(400);
  await d.caption('Journey follows every application from Applied to Offer.', 3600);
  await d.caption('Branches show where applications stopped: waiting, rejected or no response.', 400);
  const ribbon = page.locator('g[data-stage="applied"] g[data-exit="rejected"] path').first();
  // The ribbon is curved, so its box centre can miss it; hover the covered point nearest that centre.
  const spot = await ribbon.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let best = null;
    for (let fx = 0.05; fx < 1; fx += 0.05) {
      for (let fy = 0.05; fy < 1; fy += 0.05) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y) !== el) continue;
        const dist = Math.hypot(fx - 0.5, fy - 0.5);
        if (!best || dist < best.dist) best = { x, y, dist };
      }
    }
    return best;
  });
  if (!spot) throw new Error('The Applied rejected ribbon has no visible point to hover');
  await d.moveTo(spot.x, spot.y);
  await page.getByRole('tooltip').filter({ hasText: 'rejected after' }).first().waitFor();
  await sleep(3200);
  await d.caption('', 0);
  await d.card('<h1>Job Applications Tracker</h1><p>Install and run it with one command:</p><code>npx job-applications-tracker</code>');
  await sleep(3500);
}

// --- Main --------------------------------------------------------------------------------------------------

const { child, url } = await startApp();
let browser;
try {
  // Point the fresh data folder at the mock agent before the browser loads, so Setup never opens.
  await api(url, 'PATCH', '/api/settings', {
    adapter_id: 'custom',
    custom_command: mockAgentCommand(process.execPath, join(root, 'scripts', 'sandbox-mock', 'mock-agent.mjs'), {
      delayMs: AGENT_DELAY_MS,
      demo: true,
    }),
  });

  browser = await chromium.launch(process.env.DEMO_CHROMIUM_PATH ? { executablePath: process.env.DEMO_CHROMIUM_PATH } : {});
  await writeCvPdf(browser);
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light', locale: 'en-GB' });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  await page.goto(url);
  // Capturing from the first-run screen keeps the app's "Loading..." shell out of the video; the fonts
  // that screen uses may only start loading once React renders it.
  await page.getByText('Start from your CV').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const capture = await startCapture(context, page);
  const d = director(page);
  await storyboard(page, d, url);
  const captured = await capture.stop();

  // The opening still: the Journey view from the last scene, with no card, caption, pointer or tooltip.
  await d.card('');
  // A single jump leaves Radix's grace area holding the tooltip open; intermediate moves let it close.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 4, { steps: 12 });
  await page.getByRole('tooltip').first().waitFor({ state: 'hidden', timeout: 5000 });
  await page.evaluate(() => {
    document.getElementById('demo-pointer').style.display = 'none';
  });
  await sleep(400);
  const intro = join(framesDir, 'intro.jpg');
  await page.screenshot({ path: intro, type: 'jpeg', quality: 95 });

  const video = join(outDir, 'demo.mp4');
  encode(writeConcatList(captured, { file: intro, seconds: INTRO_SECONDS }), video);
  const seconds = probeSeconds(video);

  // The poster is taken after capture stops, so its play button never shows in the video.
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  await page.evaluate(() => {
    document.getElementById('demo-card').style.background = 'rgba(255,255,255,.92)';
    document.getElementById('demo-pointer').style.display = 'none';
  });
  await d.card(`<div class="play"></div><h1>Job Applications Tracker</h1><p>Watch the demo · ${mins}:${secs}</p>`);
  await page.screenshot({ path: join(outDir, 'demo-poster.png') });
  await context.close();
  process.stdout.write(`Wrote ${video} (${seconds.toFixed(1)} s) and ${join(outDir, 'demo-poster.png')}\n`);
} finally {
  try {
    await browser?.close();
  } finally {
    await stopApp(child);
  }
}
