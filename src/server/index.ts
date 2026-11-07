import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { createAdapter } from './agents/index.js';
import { createApp, type AppDeps } from './app.js';
import { createCvService } from './cv/service.js';
import { createApplicationsRepo } from './db/applications-repo.js';
import { createCvAnalysesRepo } from './db/cv-analyses-repo.js';
import { migrate, openDatabase } from './db/connection.js';
import { createJobsRepo } from './db/jobs-repo.js';
import { createProfilesRepo } from './db/profiles-repo.js';
import { createProposalsRepo } from './db/proposals-repo.js';
import { createRunsRepo } from './db/runs-repo.js';
import { createSettingsRepo } from './db/settings-repo.js';
import { ensureDataDir, resolveDataDir } from './config/paths.js';
import { createAgentMailSource } from './mail/agent-source.js';
import { createLogStore } from './runs/log-store.js';
import { createRunQueue } from './runs/queue.js';
import { createSyncScheduler } from './runs/scheduler.js';
import { createDiscoveryHandler } from './services/discovery.js';
import { createMailSyncHandler } from './services/mail-sync.js';
import { createProposalService } from './services/proposals.js';

export { APP_VERSION } from './version.js';

const PACKAGE_NAME = 'job-applications-tracker';
const HOST = '127.0.0.1';
const PORT_ATTEMPTS = 10;

export interface StartAppOptions {
  dataDir?: string;
  port?: number;
  host?: '127.0.0.1';
  // undefined = auto-detect; null = serve no UI.
  uiDir?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface RunningApp {
  url: string;
  port: number;
  dataDir: string;
  close(): Promise<void>;
}

function findPackageRoot(from: string): string | null {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === PACKAGE_NAME) return dir;
      } catch {
        // Unreadable package.json: keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Only the built bundle is served; src/ui/index.html is an unbuilt Vite entry and must not be picked up.
function defaultUiDir(): string | null {
  const root = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  if (!root) return null;
  const dir = join(root, 'dist', 'ui');
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

function listenOnce(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

async function listenWithFallback(server: Server, port: number): Promise<number> {
  // Port 0 asks the OS for any free port, so there is nothing to retry.
  if (port === 0) {
    await listenOnce(server, 0);
  } else {
    for (let attempt = 0; ; attempt++) {
      try {
        await listenOnce(server, port + attempt);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
        if (attempt === PORT_ATTEMPTS - 1) {
          throw new Error(`No free port in range ${port}..${port + PORT_ATTEMPTS - 1}`);
        }
      }
    }
  }
  return (server.address() as AddressInfo).port;
}

export async function startApp(opts: StartAppOptions = {}): Promise<RunningApp> {
  const dataDir = resolveDataDir({ flag: opts.dataDir, env: opts.env ?? process.env });
  const { dbFile, runsDir } = ensureDataDir(dataDir);
  const db = openDatabase(dbFile);
  migrate(db);

  const profilesRepo = createProfilesRepo(db);
  const settingsRepo = createSettingsRepo(db);
  const jobsRepo = createJobsRepo(db);
  const applicationsRepo = createApplicationsRepo(db);
  const proposalsRepo = createProposalsRepo(db);
  const runsRepo = createRunsRepo(db);
  const proposalService = createProposalService({ db, proposalsRepo, applicationsRepo });

  const adapterFactory = createAdapter;
  const discovery = createDiscoveryHandler({ profilesRepo, jobsRepo, settingsRepo, adapterFactory });
  const sync = createMailSyncHandler({
    applicationsRepo,
    proposalsRepo,
    settingsRepo,
    mailSourceFactory: (settings) => createAgentMailSource(createAdapter(settings, 'sync_mail')),
  });

  const logStore = createLogStore(runsDir);
  const queue = createRunQueue({
    runsRepo,
    logStore,
    runsDir,
    handlers: { discover_jobs: discovery, sync_mail: sync },
  });
  const cvService = createCvService({
    db,
    dataDir,
    cvAnalysesRepo: createCvAnalysesRepo(db),
    profilesRepo,
    settingsRepo,
    adapterFactory,
  });
  // Before the server listens: an analysis left running by the last process is shown as interrupted.
  cvService.startup();
  const scheduler = createSyncScheduler({
    settingsRepo,
    queue,
    // Profiles without open applications have nothing to check; skip them instead of queueing a no-op.
    syncProfileIds: () => applicationsRepo.profileIdsWithOpen(),
  });

  const deps: AppDeps = {
    db,
    dataDir,
    runsDir,
    profilesRepo,
    settingsRepo,
    jobsRepo,
    applicationsRepo,
    proposalsRepo,
    runsRepo,
    proposalService,
    queue,
    logStore,
    scheduler,
    cvService,
    adapterFactory,
    uiDir: opts.uiDir === undefined ? defaultUiDir() : opts.uiDir,
  };
  const app = createApp(deps);

  queue.start();
  scheduler.start();

  const server = createServer(getRequestListener(app.fetch));
  let port: number;
  try {
    port = await listenWithFallback(server, opts.port ?? settingsRepo.getAll().port);
  } catch (err) {
    // Do not leak the background loops or the db handle when binding fails.
    scheduler.stop();
    await queue.stop();
    await cvService.stop();
    db.close();
    throw err;
  }

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      scheduler.stop();
      await queue.stop();
      await cvService.stop();
      // Ends open SSE streams, which would otherwise keep server.close pending.
      server.closeAllConnections();
      await new Promise<void>((res) => server.close(() => res()));
      db.close();
    })();
    return closing;
  };

  return { url: `http://${HOST}:${port}`, port, dataDir, close };
}
