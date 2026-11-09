import type {
  Application,
  ApplicationStatus,
  CvAnalysis,
  EffortMode,
  Job,
  JobListItem,
  ModelCatalog,
  Profile,
  ProfileListItem,
  Proposal,
  Run,
  RunStatus,
  Settings,
  StatusHistoryEntry,
} from '../../server/domain/types.js';
import type { DashboardSummary } from '../../server/domain/dashboard.js';

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

export interface ModelCatalogs {
  claude: ModelCatalog;
  codex: ModelCatalog;
}

export type ProfileInput = Omit<Profile, 'id' | 'slug' | 'created_at' | 'cv'>;

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

const enc = encodeURIComponent;

// Jobs, applications, proposals and runs live under their profile (SOW-0014).
const scoped = (profileId: string, path: string) => `/api/profiles/${enc(profileId)}${path}`;

// The log endpoint returns plain text, so it bypasses the JSON helper.
export async function getRunLog(profileId: string, id: string): Promise<string> {
  const res = await fetch(scoped(profileId, `/runs/${enc(id)}/log`));
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res.text();
}

export const getHealth = (): Promise<Health> => request('GET', '/api/health');
export const getAdapters = (): Promise<AdapterStatus[]> => request('GET', '/api/setup/adapters');
export const getModelCatalogs = (): Promise<ModelCatalogs> => request('GET', '/api/setup/models');

export const listProfiles = (): Promise<ProfileListItem[]> => request('GET', '/api/profiles');
// `cvAnalysisId` keeps the reviewed CV with the new profile (SOW-0023).
export const createProfile = (profile: ProfileInput, cvAnalysisId?: string): Promise<Profile> =>
  request('POST', '/api/profiles', cvAnalysisId ? { ...profile, cv_analysis_id: cvAnalysisId } : profile);
export const getProfile = (profileId: string): Promise<Profile> => request('GET', scoped(profileId, ''));
export const getProfileBySlug = (slug: string): Promise<Profile> =>
  request('GET', `/api/profiles/by-slug/${enc(slug)}`);
// `cvAnalysisId` saves the profile's applied CV analysis and replaces its CV (SOW-0024).
export const updateProfile = (profileId: string, profile: ProfileInput, cvAnalysisId?: string): Promise<Profile> =>
  request('PUT', scoped(profileId, ''), cvAnalysisId ? { ...profile, cv_analysis_id: cvAnalysisId } : profile);
export const getDashboard = (profileId: string): Promise<DashboardSummary> =>
  request('GET', scoped(profileId, '/dashboard'));

// Removes the profile with its jobs, applications, proposals, runs and run logs.
export const deleteProfile = (profileId: string): Promise<void> => request('DELETE', scoped(profileId, ''));
export const removeProfileCv = (profileId: string): Promise<Profile> => request('DELETE', scoped(profileId, '/cv'));
// A plain link: the browser downloads the file under its original name.
export const profileCvUrl = (profileId: string): string => scoped(profileId, '/cv');

// Without a profile id: the analysis that becomes a new profile (SOW-0023); with one: that profile's own,
// which suggests changes to it (SOW-0024). null when there is none.
const cvAnalysisPath = (profileId?: string) => (profileId ? scoped(profileId, '/cv-analysis') : '/api/cv-analysis');
export const getCvAnalysis = (profileId?: string): Promise<CvAnalysis | null> =>
  request('GET', cvAnalysisPath(profileId));
export const retryCvAnalysis = (profileId?: string): Promise<CvAnalysis> =>
  request('POST', `${cvAnalysisPath(profileId)}/retry`);
// Cancel and Discard: the server stops the agent and deletes the analysis with its files.
export const discardCvAnalysis = (profileId?: string): Promise<void> => request('DELETE', cvAnalysisPath(profileId));

// The file goes as raw bytes, not JSON or a form post; the server reads its type from the content.
export async function uploadCv(file: File, profileId?: string): Promise<CvAnalysis> {
  const res = await fetch(cvAnalysisPath(profileId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as CvAnalysis;
}

export const getSettings = (): Promise<Settings> => request('GET', '/api/settings');
export const patchSettings = (patch: Partial<Settings>): Promise<Settings> =>
  request('PATCH', '/api/settings', patch);

export function listJobs(profileId: string, filters: JobFilters = {}): Promise<JobListItem[]> {
  const params = new URLSearchParams();
  if (filters.includeDead) params.set('includeDead', '1');
  if (filters.includeDismissed) params.set('includeDismissed', '1');
  const qs = params.toString();
  return request('GET', scoped(profileId, qs ? `/jobs?${qs}` : '/jobs'));
}
export const dismissJob = (profileId: string, id: string): Promise<void> =>
  request('POST', scoped(profileId, `/jobs/${enc(id)}/dismiss`));
export const saveJob = (profileId: string, id: string): Promise<Application> =>
  request('POST', scoped(profileId, `/jobs/${enc(id)}/save`));
export const markApplied = (profileId: string, id: string): Promise<Application> =>
  request('POST', scoped(profileId, `/jobs/${enc(id)}/applied`));

export const listApplications = (profileId: string): Promise<Application[]> =>
  request('GET', scoped(profileId, '/applications'));
export const createApplication = (profileId: string, input: NewApplicationInput): Promise<Application> =>
  request('POST', scoped(profileId, '/applications'), input);
export const getApplication = (profileId: string, id: string): Promise<ApplicationDetail> =>
  request('GET', scoped(profileId, `/applications/${enc(id)}`));
export const patchApplication = (profileId: string, id: string, patch: ApplicationPatchInput): Promise<Application> =>
  request('PATCH', scoped(profileId, `/applications/${enc(id)}`), patch);
export const setApplicationStatus = (profileId: string, id: string, status: ApplicationStatus): Promise<Application> =>
  request('POST', scoped(profileId, `/applications/${enc(id)}/status`), { status });

export const listProposals = (profileId: string): Promise<ProposalWithApplication[]> =>
  request('GET', scoped(profileId, '/proposals'));
export const acceptProposal = (
  profileId: string,
  id: string,
): Promise<{ proposal: Proposal; application: Application }> =>
  request('POST', scoped(profileId, `/proposals/${enc(id)}/accept`));
export const rejectProposal = (profileId: string, id: string): Promise<{ proposal: Proposal }> =>
  request('POST', scoped(profileId, `/proposals/${enc(id)}/reject`));

export const listRuns = (profileId: string, limit?: number): Promise<Run[]> =>
  request('GET', scoped(profileId, limit === undefined ? '/runs' : `/runs?limit=${limit}`));
export const getRun = (profileId: string, id: string): Promise<Run> =>
  request('GET', scoped(profileId, `/runs/${enc(id)}`));
export const startDiscovery = (profileId: string, mode: EffortMode = 'default'): Promise<Run> =>
  request('POST', scoped(profileId, '/runs/discover'), { mode });
// 202 with the run: already `aborted` for a queued run, still `running` while the agent is stopped.
export const cancelRun = (profileId: string, id: string): Promise<Run> =>
  request('POST', scoped(profileId, `/runs/${enc(id)}/cancel`));
export const startSync = (profileId: string): Promise<Run> => request('POST', scoped(profileId, '/runs/sync'));
export const purgeRunLogs = (): Promise<{ deleted: number }> => request('DELETE', '/api/runs/logs');

export function subscribeRunEvents(
  profileId: string,
  id: string,
  onLine: (line: string) => void,
  onDone: (status: RunStatus | 'unknown') => void,
): () => void {
  const source = new EventSource(scoped(profileId, `/runs/${enc(id)}/events`));
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
