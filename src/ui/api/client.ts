import type {
  Application,
  ApplicationStatus,
  Job,
  JobListItem,
  Profile,
  Proposal,
  Run,
  RunStatus,
  Settings,
  StatusHistoryEntry,
} from '../../server/domain/types.js';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface Health {
  ok: boolean;
  version: string;
  dataDir: string;
}

export interface AdapterStatus {
  id: 'claude' | 'codex' | 'custom';
  installed: boolean;
  version?: string;
  authenticated?: boolean;
  authMessage?: string;
  message?: string;
  gmail_guide: boolean;
}

export type ProfileInput = Omit<Profile, 'created_at'>;

export interface NewApplicationInput {
  company: string;
  role: string;
  url?: string | null;
  status?: ApplicationStatus;
  applied_at?: string | null;
  notes?: string;
  sender_domains?: string[];
}

export interface ApplicationPatchInput {
  company?: string;
  role?: string;
  url?: string | null;
  notes?: string | null;
  sender_domains?: string[];
  applied_at?: string | null;
}

export type ApplicationDetail = Application & { history: StatusHistoryEntry[] };
export type ProposalWithApplication = Proposal & { application: Application | null };

export interface JobFilters {
  includeDead?: boolean;
  includeDismissed?: boolean;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error !== '') return body.error;
  } catch {
    // Non-JSON error body; fall through to the status text.
  }
  return res.statusText || `HTTP ${res.status}`;
}

// Single place that talks to fetch: the server rejects JSON writes without a JSON Content-Type.
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, 'Invalid JSON response');
  }
}

// The log endpoint returns plain text, so it bypasses the JSON helper.
export async function getRunLog(id: string): Promise<string> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}/log`);
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res.text();
}

const enc = encodeURIComponent;

export const getHealth = (): Promise<Health> => request('GET', '/api/health');
export const getAdapters = (): Promise<AdapterStatus[]> => request('GET', '/api/setup/adapters');

export const getProfile = (): Promise<Profile | null> => request('GET', '/api/profile');
export const putProfile = (profile: Partial<ProfileInput>): Promise<Profile> =>
  request('PUT', '/api/profile', profile);

export const getSettings = (): Promise<Settings> => request('GET', '/api/settings');
export const patchSettings = (patch: Partial<Settings>): Promise<Settings> =>
  request('PATCH', '/api/settings', patch);

export function listJobs(filters: JobFilters = {}): Promise<JobListItem[]> {
  const params = new URLSearchParams();
  if (filters.includeDead) params.set('includeDead', '1');
  if (filters.includeDismissed) params.set('includeDismissed', '1');
  const qs = params.toString();
  return request('GET', qs ? `/api/jobs?${qs}` : '/api/jobs');
}
export const dismissJob = (id: string): Promise<void> => request('POST', `/api/jobs/${enc(id)}/dismiss`);
export const saveJob = (id: string): Promise<Application> => request('POST', `/api/jobs/${enc(id)}/save`);
export const markApplied = (id: string): Promise<Application> =>
  request('POST', `/api/jobs/${enc(id)}/applied`);

export const listApplications = (open = false): Promise<Application[]> =>
  request('GET', open ? '/api/applications?open=1' : '/api/applications');
export const createApplication = (input: NewApplicationInput): Promise<Application> =>
  request('POST', '/api/applications', input);
export const getApplication = (id: string): Promise<ApplicationDetail> =>
  request('GET', `/api/applications/${enc(id)}`);
export const patchApplication = (id: string, patch: ApplicationPatchInput): Promise<Application> =>
  request('PATCH', `/api/applications/${enc(id)}`, patch);
export const setApplicationStatus = (id: string, status: ApplicationStatus): Promise<Application> =>
  request('POST', `/api/applications/${enc(id)}/status`, { status });

export const listProposals = (): Promise<ProposalWithApplication[]> => request('GET', '/api/proposals');
export const acceptProposal = (id: string): Promise<{ proposal: Proposal; application: Application }> =>
  request('POST', `/api/proposals/${enc(id)}/accept`);
export const rejectProposal = (id: string): Promise<{ proposal: Proposal }> =>
  request('POST', `/api/proposals/${enc(id)}/reject`);

export const listRuns = (limit?: number): Promise<Run[]> =>
  request('GET', limit === undefined ? '/api/runs' : `/api/runs?limit=${limit}`);
export const getRun = (id: string): Promise<Run> => request('GET', `/api/runs/${enc(id)}`);
export const startDiscovery = (): Promise<Run> => request('POST', '/api/runs/discover');
export const startSync = (): Promise<Run> => request('POST', '/api/runs/sync');
export const purgeRunLogs = (): Promise<{ deleted: number }> => request('DELETE', '/api/runs/logs');

export function subscribeRunEvents(
  id: string,
  onLine: (line: string) => void,
  onDone: (status: RunStatus | 'unknown') => void,
): () => void {
  const source = new EventSource(`/api/runs/${enc(id)}/events`);
  let finished = false;
  source.addEventListener('line', (event) => onLine((event as MessageEvent<string>).data));
  source.addEventListener('done', (event) => {
    finished = true;
    // Close first so a throwing callback cannot leave the stream open.
    source.close();
    onDone((event as MessageEvent<string>).data as RunStatus | 'unknown');
  });
  // The server ends the stream after `done`; closing here stops the browser's auto-reconnect.
  source.addEventListener('error', () => {
    if (finished) source.close();
  });
  return () => source.close();
}
