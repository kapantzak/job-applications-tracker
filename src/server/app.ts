import { join, resolve, sep } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import type { AgentAdapter } from './agents/index.js';
import { createCvAnalysisRouter } from './api/cv-analysis.js';
import { onError } from './api/errors.js';
import { createRequestGuard } from './api/guard.js';
import { createProfilesRouter } from './api/profiles.js';
import { createRunLogsRouter } from './api/runs.js';
import { createSettingsRouter } from './api/settings.js';
import { createSetupRouter } from './api/setup.js';
import type { CvService } from './cv/service.js';
import type { createApplicationsRepo } from './db/applications-repo.js';
import type { Db } from './db/connection.js';
import type { createJobsRepo } from './db/jobs-repo.js';
import type { ProfilesRepo } from './db/profiles-repo.js';
import type { ApplicationProposalsRepo } from './db/application-proposals-repo.js';
import type { createProposalsRepo } from './db/proposals-repo.js';
import type { RunsRepo } from './db/runs-repo.js';
import type { createSettingsRepo } from './db/settings-repo.js';
import type { AgentTaskKind, Settings } from './domain/types.js';
import type { LogStore } from './runs/log-store.js';
import type { RunQueue } from './runs/queue.js';
import type { SyncScheduler } from './runs/scheduler.js';
import type { createApplicationProposalService } from './services/application-proposals.js';
import type { createProposalService } from './services/proposals.js';
import type { UpdateChecker } from './update-check.js';

export interface AppDeps {
  db: Db;
  dataDir: string;
  runsDir: string;
  profilesRepo: ProfilesRepo;
  settingsRepo: ReturnType<typeof createSettingsRepo>;
  jobsRepo: ReturnType<typeof createJobsRepo>;
  applicationsRepo: ReturnType<typeof createApplicationsRepo>;
  proposalsRepo: ReturnType<typeof createProposalsRepo>;
  runsRepo: RunsRepo;
  proposalService: ReturnType<typeof createProposalService>;
  applicationProposalsRepo: ApplicationProposalsRepo;
  applicationProposalService: ReturnType<typeof createApplicationProposalService>;
  queue: RunQueue;
  logStore: LogStore;
  scheduler: SyncScheduler;
  updateChecker: Pick<UpdateChecker, 'refresh' | 'status'>;
  cvService: CvService;
  adapterFactory: (settings: Settings, kind: AgentTaskKind) => AgentAdapter;
  uiDir: string | null;
  // How often the SSE endpoint re-checks run status; tests shorten it.
  ssePollMs?: number;
  // Hostnames accepted in addition to the loopback defaults for Host and Origin checks.
  allowedHosts?: string[];
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

// Defence in depth: serveStatic already rejects dot segments, but %2F-encoded ones only via its '%' check.
function staysInside(root: string, requestPath: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;
  const target = resolve(root, `.${decoded}`);
  return target === root || target.startsWith(root + sep);
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(onError);
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  // Registered before the routers so it runs first for every /api request.
  app.use('/api/*', createRequestGuard(deps.allowedHosts));

  app.route('/api', createSetupRouter(deps));
  app.route('/api/settings', createSettingsRouter(deps));
  // Jobs, applications, proposals and runs live under their profile (SOW-0014).
  app.route('/api/profiles', createProfilesRouter(deps));
  app.route('/api/runs', createRunLogsRouter(deps));
  app.route(
    '/api/cv-analysis',
    createCvAnalysisRouter(deps, () => null),
  );

  if (deps.uiDir !== null) {
    const root = resolve(deps.uiDir);
    app.use('*', async (c, next) => {
      if (isApiPath(c.req.path)) return c.json({ error: 'Not found' }, 404);
      if (!staysInside(root, c.req.path)) return c.json({ error: 'Not found' }, 404);
      await next();
    });
    // Without Cache-Control browsers cache index.html heuristically and keep the old
    // bundle after an upgrade. Vite content-hashes everything under assets/, so only
    // those files may be cached for good; the rest revalidate on every load.
    // @hono/node-server calls onFound after building the response: a header set there is
    // lost with the standard Response and kept only by an internal detail of node-server's
    // own Response. So onFound only records the file and this middleware sets the header.
    const assetsDir = join(root, 'assets') + sep;
    const servedFiles = new WeakMap<Context, string>();
    const recordFile = (path: string, c: Context): void => {
      servedFiles.set(c, resolve(path));
    };
    app.use('*', async (c, next) => {
      await next();
      const file = servedFiles.get(c);
      if (file !== undefined) c.header('Cache-Control', file.startsWith(assetsDir) ? IMMUTABLE : 'no-cache');
    });
    // serveStatic joins root with the request path, so an absolute root works as is.
    app.use('*', serveStatic({ root, onFound: recordFile }));
    // SPA fallback: client-side routes resolve to the app shell.
    app.get('*', serveStatic({ path: join(root, 'index.html'), onFound: recordFile }));
  }

  return app;
}
