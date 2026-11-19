// Development entry for `npm run dev:server` (tsx watch). Not bundled: tsup builds only index.ts.
// It keeps its data in the checkout's .tmp/dev-server so a dev server never opens the user's real data, and
// listens on 4173 because the Vite dev server proxies /api there.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from './index.js';

const DEV_PORT = 4173;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await startApp({ port: DEV_PORT, dataDir: join(root, '.tmp', 'dev-server') });
// startApp moves to the next free port; then `npm run dev:ui` would reach whatever holds 4173, often the
// user's own jobtrack with their real data, so stop instead.
if (app.port !== DEV_PORT) {
  await app.close();
  process.stderr.write(`Port ${DEV_PORT} is taken (is jobtrack running?). Stop it, then run npm run dev:server again.\n`);
  process.exit(1);
}
process.stdout.write(`Dev server running at ${app.url}\nData directory: ${app.dataDir}\n`);

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    // Close the database cleanly so tsx watch restarts never leave a half-written WAL behind.
    await app.close();
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
