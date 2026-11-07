import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppDeps } from '../app.js';
import { CV_MAX_BYTES } from '../cv/extract.js';
import { requireUsableAgent } from './agent-check.js';
import { HttpError } from './errors.js';

export const CV_FILE_NAME_HEADER = 'x-file-name';
const FILE_NAME_MAX = 200;

// Raw bytes, not a form post: application/octet-stream is not a CORS-safelisted type, so a browser on
// another site must preflight it and the Origin guard stops it (SOW-0023, decision 9).
function requireOctetStream(c: Context): void {
  const type = c.req.header('content-type')?.trim().toLowerCase() ?? '';
  if (!type.startsWith('application/octet-stream')) {
    throw new HttpError(415, 'Content-Type must be application/octet-stream');
  }
}

// The name is only shown and offered on download; it never becomes a path.
function fileNameOf(c: Context): string {
  const raw = c.req.header(CV_FILE_NAME_HEADER);
  if (!raw) throw new HttpError(400, 'X-File-Name header is required');
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'X-File-Name must be URI-encoded');
  }
  // Keep the last path segment and drop control characters.
  name = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name === '') throw new HttpError(400, 'X-File-Name is empty');
  return Array.from(name).slice(-FILE_NAME_MAX).join('');
}

const tooLarge = () => {
  throw new HttpError(413, 'The file is larger than 10 MB');
};

// Global: the analysis happens before the profile exists, and only one exists at a time (decision 24).
export function createCvAnalysisRouter(deps: AppDeps): Hono {
  const router = new Hono();
  const service = deps.cvService;

  router.get('/', (c) => c.json(service.current()));

  router.post('/', bodyLimit({ maxSize: CV_MAX_BYTES, onError: tooLarge }), async (c) => {
    requireOctetStream(c);
    const fileName = fileNameOf(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) throw new HttpError(400, 'The file is empty');
    if (bytes.length > CV_MAX_BYTES) tooLarge();
    await requireUsableAgent(deps, 'analyse_cv');
    return c.json(await service.start(bytes, fileName), 202);
  });

  router.post('/retry', async (c) => {
    await requireUsableAgent(deps, 'analyse_cv');
    return c.json(service.retry(), 202);
  });

  // Cancel and Discard: stops a running agent and deletes the analysis with its files.
  router.delete('/', async (c) => {
    if (!(await service.discard())) throw new HttpError(404, 'There is no CV analysis');
    return c.body(null, 204);
  });

  return router;
}
