// Recreates .tmp/sandbox-mock with mock data (SOW-0028); `npm run sandbox:mock` then starts the app on it.
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDataDir } from '../../src/server/config/paths.js';
import { migrate, openDatabase } from '../../src/server/db/connection.js';
import { mockAgentCommand, seedMockData } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string };
if (pkg.name !== 'job-applications-tracker') {
  throw new Error(`Refusing to run: ${root} is not the job-applications-tracker checkout`);
}

// The folder is deleted on every start; a symbolic link at either level could point the delete elsewhere.
const tmpDir = join(root, '.tmp');
const dataDir = join(tmpDir, 'sandbox-mock');
for (const dir of [tmpDir, dataDir]) {
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
    throw new Error(`Refusing to delete ${dataDir}: ${dir} is a symbolic link`);
  }
}
rmSync(dataDir, { recursive: true, force: true });

const { dbFile } = ensureDataDir(dataDir);
const db = openDatabase(dbFile);
try {
  migrate(db);
  const summary = seedMockData(db, {
    dataDir,
    now: new Date(),
    mockAgentCommand: mockAgentCommand(process.execPath, join(here, 'mock-agent.mjs')),
  });
  process.stdout.write(`Mock data written to ${dataDir}\n`);
  for (const p of summary.profiles) process.stdout.write(`  profile "${p.name}" (/profiles/${p.slug})\n`);
  process.stdout.write('Agent: mock agent (no web search, no Gmail)\n');
} finally {
  db.close();
}
