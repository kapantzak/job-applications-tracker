import type { Context, ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { CvFileError } from '../cv/extract.js';
import { CvAnalysisStateError } from '../cv/service.js';
import { ProfileNotFoundError } from '../db/profiles-repo.js';
import { ProposalNotPendingError } from '../services/proposals.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function formatZodError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.map(String).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, formatZodError(result.error));
  return result.data;
}

export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  // Requiring JSON rules out form posts, which browsers send cross-site without a preflight.
  const type = c.req.header('content-type')?.trim().toLowerCase() ?? '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  return parseWith(schema, body);
}

export const onError: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  }
  if (err instanceof ProposalNotPendingError) return c.json({ error: err.message }, 409);
  if (err instanceof CvAnalysisStateError) return c.json({ error: err.message }, 409);
  if (err instanceof CvFileError) return c.json({ error: err.message }, err.status);
  if (err instanceof ProfileNotFoundError) return c.json({ error: 'Profile not found' }, 404);
  if (err instanceof z.ZodError) return c.json({ error: formatZodError(err) }, 400);
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
};
