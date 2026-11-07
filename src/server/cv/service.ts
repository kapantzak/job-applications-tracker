import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAdapter } from '../agents/index.js';
import type { Db } from '../db/connection.js';
import type { CvAnalysesRepo } from '../db/cv-analyses-repo.js';
import type { ProfileInput, ProfilesRepo, StoredCv } from '../db/profiles-repo.js';
import type { createSettingsRepo } from '../db/settings-repo.js';
import { SENIORITY_LEVELS } from '../domain/seniority.js';
import type { AgentTaskKind, CvAnalysis, CvFileType, Profile, Settings } from '../domain/types.js';
import { renderPrompt } from '../tasks/prompts.js';
import { AnalyseCvOutput, outputJsonSchema } from '../tasks/schemas.js';
import { toProfileDraft } from './draft.js';
import { detectCvType, extractCvText, promptCvText } from './extract.js';

// Fixed timeout, no setting (SOW-0023, decision 7).
export const CV_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;
// Ids become directory names; anything else is never used as a path.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// The same names under an analysis folder and under a profile folder. The text has its own name
// because a .txt CV would otherwise share it.
const originalName = (type: CvFileType) => `cv.${type}`;
const TEXT_NAME = 'cv-text.txt';
const WORK_DIR = 'work';

// The request is valid but the analysis is in the wrong state for it; the API answers 409.
export class CvAnalysisStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CvAnalysisStateError';
  }
}

export interface CvServiceDeps {
  db: Db;
  dataDir: string;
  cvAnalysesRepo: CvAnalysesRepo;
  profilesRepo: ProfilesRepo;
  settingsRepo: ReturnType<typeof createSettingsRepo>;
  adapterFactory: (settings: Settings, kind: AgentTaskKind) => AgentAdapter;
  // Test seams.
  timeoutMs?: number;
  stopTimeoutMs?: number;
}

interface ActiveAnalysis {
  id: string;
  controller: AbortController;
  // Set by Discard and shutdown so a late result is never written.
  ignoreResult: boolean;
  settled: Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
}

// One CV analysis at a time, outside the run queue (decisions 3 and 24). Rows and files survive
// restarts (A2); an agent never does, so a restart leaves the analysis interrupted (decision 26).
export function createCvService(deps: CvServiceDeps) {
  const { db, dataDir, cvAnalysesRepo, profilesRepo, settingsRepo, adapterFactory } = deps;
  const timeoutMs = deps.timeoutMs ?? CV_ANALYSIS_TIMEOUT_MS;
  const stopTimeoutMs = deps.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const analysesRoot = join(dataDir, 'cv-analyses');
  const profilesRoot = join(dataDir, 'profiles');
  let active: ActiveAnalysis | null = null;
  // Covers the await on text extraction, so two uploads at once cannot both pass the "none yet" check.
  let starting = false;
  // Set by shutdown: an upload still extracting text, or a late retry, must not spawn an agent the
  // process would leave behind.
  let stopped = false;

  const analysisDir = (id: string) => join(analysesRoot, safeId(id));
  const profileDir = (id: string) => join(profilesRoot, safeId(id));

  function requireNoAnalysis(): void {
    if (starting || cvAnalysesRepo.current()) {
      throw new CvAnalysisStateError('A CV analysis already exists. Discard it before uploading another CV.');
    }
  }

  function requireRunning(): void {
    if (stopped) throw new CvAnalysisStateError('The app is shutting down.');
  }

  function launch(id: string, text: string): void {
    const entry: ActiveAnalysis = {
      id,
      controller: new AbortController(),
      ignoreResult: false,
      settled: Promise.resolve(),
    };
    active = entry;
    entry.settled = analyse(entry, text).finally(() => {
      if (active === entry) active = null;
    });
  }

  async function analyse(entry: ActiveAnalysis, text: string): Promise<void> {
    const workDir = join(analysisDir(entry.id), WORK_DIR);
    let outcome: Parameters<CvAnalysesRepo['update']>[1];
    try {
      const adapter = adapterFactory(settingsRepo.getAll(), 'analyse_cv');
      const prompt = renderPrompt('analyse_cv', {
        cv_text: promptCvText(text),
        seniority_levels: SENIORITY_LEVELS.join(', '),
      });
      mkdirSync(workDir, { recursive: true });
      const result = await adapter.run(
        { kind: 'analyse_cv', prompt: prompt.text, outputSchema: outputJsonSchema('analyse_cv') },
        { timeoutMs, cwd: workDir, signal: entry.controller.signal },
      );
      const parsed = result.ok ? AnalyseCvOutput.safeParse(result.output) : null;
      if (!result.ok) {
        outcome = { status: 'failed', error: `The agent could not analyse the CV: ${result.error}` };
      } else if (!parsed?.success) {
        outcome = { status: 'failed', error: "The agent's answer did not have the expected shape." };
      } else {
        outcome = { status: 'succeeded', draft: toProfileDraft(parsed.data), prompt_version: prompt.version };
      }
    } catch (err) {
      outcome = { status: 'failed', error: messageOf(err) };
    } finally {
      // The prompt file holds the CV text; it is never kept (decision 12).
      rmSync(workDir, { recursive: true, force: true });
    }
    if (entry.ignoreResult) return;
    try {
      cvAnalysesRepo.update(entry.id, { ...outcome, finished_at: new Date().toISOString() });
    } catch (err) {
      console.error(`cv analysis ${entry.id}: failed to record the result: ${messageOf(err)}`);
    }
  }

  function current(): CvAnalysis | null {
    return cvAnalysesRepo.current();
  }

  async function start(bytes: Uint8Array, fileName: string): Promise<CvAnalysis> {
    requireRunning();
    requireNoAnalysis();
    starting = true;
    try {
      const type = detectCvType(bytes, fileName);
      const text = await extractCvText(bytes, type);
      requireRunning();
      const analysis = cvAnalysesRepo.create({ file_name: fileName, file_type: type });
      try {
        const dir = analysisDir(analysis.id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, originalName(type)), bytes);
        writeFileSync(join(dir, TEXT_NAME), text);
      } catch (err) {
        cvAnalysesRepo.remove(analysis.id);
        rmSync(analysisDir(analysis.id), { recursive: true, force: true });
        throw err;
      }
      launch(analysis.id, text);
      return analysis;
    } finally {
      starting = false;
    }
  }

  // Analyse again after a failure or a restart, from the kept text (decision 26).
  function retry(): CvAnalysis {
    requireRunning();
    const analysis = cvAnalysesRepo.current();
    if (!analysis) throw new CvAnalysisStateError('There is no CV analysis to run again.');
    if (analysis.status !== 'failed' && analysis.status !== 'interrupted') {
      throw new CvAnalysisStateError('Only a failed or interrupted CV analysis can be run again.');
    }
    let text: string;
    try {
      text = readFileSync(join(analysisDir(analysis.id), TEXT_NAME), 'utf8');
    } catch {
      throw new CvAnalysisStateError('The CV of this analysis is missing. Discard it and upload the CV again.');
    }
    const restarted = cvAnalysesRepo.update(analysis.id, {
      status: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      draft: null,
    }) as CvAnalysis;
    launch(analysis.id, text);
    return restarted;
  }

  // Cancel and Discard: stops a running agent, then deletes the row and every file (decision 13).
  async function discard(): Promise<boolean> {
    const analysis = cvAnalysesRepo.current();
    if (!analysis) return false;
    const entry = active?.id === analysis.id ? active : null;
    if (entry) {
      entry.ignoreResult = true;
      entry.controller.abort();
      await entry.settled;
    }
    cvAnalysesRepo.remove(analysis.id);
    rmSync(analysisDir(analysis.id), { recursive: true, force: true });
    return true;
  }

  // Create profile from a ready analysis: the files move to the profile's folder first and move back
  // if the database write fails, so a profile row never points at missing files.
  function createProfile(input: ProfileInput, analysisId: string, profileId: string): Profile {
    const analysis = cvAnalysesRepo.get(analysisId);
    if (!analysis) throw new CvAnalysisStateError('This CV analysis no longer exists.');
    if (analysis.status !== 'succeeded') throw new CvAnalysisStateError('This CV analysis has not finished.');
    const from = analysisDir(analysis.id);
    const to = profileDir(profileId);
    const names = [originalName(analysis.file_type), TEXT_NAME];
    if (!names.every((name) => existsSync(join(from, name)))) {
      throw new CvAnalysisStateError('The CV of this analysis is missing. Discard it and upload the CV again.');
    }
    const moved: string[] = [];
    // Puts back whatever already moved, so a failure halfway never strands the upload in a folder
    // the start-up sweep would delete.
    const moveBack = () => {
      for (const name of moved) renameSync(join(to, name), join(from, name));
      rmSync(to, { recursive: true, force: true });
    };
    const cv: StoredCv = { file_name: analysis.file_name, file_type: analysis.file_type, added_at: new Date().toISOString() };
    let profile: Profile;
    try {
      mkdirSync(to, { recursive: true });
      for (const name of names) {
        renameSync(join(from, name), join(to, name));
        moved.push(name);
      }
      profile = createProfileRow(input, profileId, cv, analysis.id);
    } catch (err) {
      moveBack();
      throw err;
    }
    rmSync(from, { recursive: true, force: true });
    return profile;
  }

  function createProfileRow(input: ProfileInput, id: string, cv: StoredCv, analysisId: string): Profile {
    // One transaction: the profile appears and the analysis disappears together.
    return db.transaction(() => {
      const profile = profilesRepo.create(input, { id, cv });
      cvAnalysesRepo.remove(analysisId);
      return profile;
    })();
  }

  function profileCvPath(profileId: string): { path: string; cv: StoredCv } | null {
    const cv = profilesRepo.storedCv(profileId);
    return cv ? { path: join(profileDir(profileId), originalName(cv.file_type)), cv } : null;
  }

  // Remove CV (decision 21): the row forgets it first, so a failed delete leaves only an orphan folder,
  // which the start-up sweep removes.
  function removeProfileCv(profileId: string): Profile {
    const profile = profilesRepo.setCv(profileId, null);
    rmSync(profileDir(profileId), { recursive: true, force: true });
    return profile;
  }

  function removeProfileFiles(profileId: string): void {
    rmSync(profileDir(profileId), { recursive: true, force: true });
  }

  // Clean-up must never keep the app from starting: a folder it cannot remove is logged and left.
  function removeQuietly(path: string): void {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (err) {
      console.error(`cv: could not remove a leftover folder: ${messageOf(err)}`);
    }
  }

  // Folders without a row are leftovers of a crash or a failed delete.
  function sweep(root: string, keep: Set<string>): void {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`cv: could not read ${root}: ${messageOf(err)}`);
      }
      return;
    }
    for (const name of names) {
      if (!SAFE_ID.test(name) || keep.has(name)) continue;
      removeQuietly(join(root, name));
    }
  }

  function startup(): void {
    stopped = false;
    cvAnalysesRepo.markInterrupted();
    const analyses = new Set(cvAnalysesRepo.ids());
    sweep(analysesRoot, analyses);
    for (const id of analyses) removeQuietly(join(analysesRoot, id, WORK_DIR));
    sweep(profilesRoot, new Set(profilesRepo.list().filter((p) => p.cv).map((p) => p.id)));
  }

  // Shutdown: the agent is killed and the row stays running, so the next start marks it interrupted.
  async function stop(): Promise<void> {
    stopped = true;
    const entry = active;
    if (!entry) return;
    entry.ignoreResult = true;
    entry.controller.abort();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([entry.settled, new Promise<void>((r) => (timer = setTimeout(r, stopTimeoutMs)))]);
    clearTimeout(timer);
  }

  return {
    current,
    start,
    retry,
    discard,
    createProfile,
    profileCvPath,
    removeProfileCv,
    removeProfileFiles,
    startup,
    stop,
  };
}

export type CvService = ReturnType<typeof createCvService>;
