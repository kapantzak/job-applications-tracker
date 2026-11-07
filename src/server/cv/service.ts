import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAdapter } from '../agents/index.js';
import type { Db } from '../db/connection.js';
import type { CvAnalysesRepo } from '../db/cv-analyses-repo.js';
import { ProfileNotFoundError, type ProfileInput, type ProfilesRepo, type StoredCv } from '../db/profiles-repo.js';
import type { createSettingsRepo } from '../db/settings-repo.js';
import { SENIORITY_LEVELS } from '../domain/seniority.js';
import {
  CV_FILE_TYPES,
  type AgentTaskKind,
  type CvAnalysis,
  type CvFileType,
  type Profile,
  type Settings,
} from '../domain/types.js';
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
// A replacing CV waits under this suffix in the profile folder until the database points at it (SOW-0024).
const NEW_SUFFIX = '.new';

// Who an analysis is for: a profile id, or null for a profile that does not exist yet (decision 30).
export type CvOwner = string | null;
const ownerKey = (owner: CvOwner) => owner ?? '';

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

// CV analyses outside the run queue (SOW-0023, decision 3): one per profile plus one for a new profile
// (SOW-0024, decision 30), each with its own agent, side by side (decision 37). Rows and files survive
// restarts (A2); an agent never does, so a restart leaves the analysis interrupted (decision 26).
export function createCvService(deps: CvServiceDeps) {
  const { db, dataDir, cvAnalysesRepo, profilesRepo, settingsRepo, adapterFactory } = deps;
  const timeoutMs = deps.timeoutMs ?? CV_ANALYSIS_TIMEOUT_MS;
  const stopTimeoutMs = deps.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const analysesRoot = join(dataDir, 'cv-analyses');
  const profilesRoot = join(dataDir, 'profiles');
  // Running agents by analysis id.
  const active = new Map<string, ActiveAnalysis>();
  // Owners with an upload still extracting text, so two uploads at once cannot both pass the "none yet"
  // check.
  const starting = new Set<string>();
  // Set by shutdown: an upload still extracting text, or a late retry, must not spawn an agent the
  // process would leave behind.
  let stopped = false;

  const analysisDir = (id: string) => join(analysesRoot, safeId(id));
  const profileDir = (id: string) => join(profilesRoot, safeId(id));

  function requireNoAnalysis(owner: CvOwner): void {
    if (starting.has(ownerKey(owner)) || cvAnalysesRepo.current(owner)) {
      throw new CvAnalysisStateError(
        owner === null
          ? 'A CV analysis already exists. Discard it before uploading another CV.'
          : 'This profile already has a CV analysis. Discard it before uploading another CV.',
      );
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
    active.set(id, entry);
    entry.settled = analyse(entry, text).finally(() => {
      if (active.get(id) === entry) active.delete(id);
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
      // The prompt file holds the CV text; it is never kept (decision 12). Never throws: nothing awaits a
      // running analysis, so a rejection here would end the process; a folder left behind (Windows keeps
      // a dead agent's working folder busy for a moment) goes with its analysis or at start-up.
      removeQuietly(workDir);
    }
    if (entry.ignoreResult) return;
    try {
      cvAnalysesRepo.update(entry.id, { ...outcome, finished_at: new Date().toISOString() });
    } catch (err) {
      console.error(`cv analysis ${entry.id}: failed to record the result: ${messageOf(err)}`);
    }
  }

  function current(owner: CvOwner = null): CvAnalysis | null {
    return cvAnalysesRepo.current(owner);
  }

  async function start(bytes: Uint8Array, fileName: string, owner: CvOwner = null): Promise<CvAnalysis> {
    requireRunning();
    requireNoAnalysis(owner);
    const key = ownerKey(owner);
    starting.add(key);
    try {
      const type = detectCvType(bytes, fileName);
      const text = await extractCvText(bytes, type);
      requireRunning();
      // The profile may have been deleted while the text was read.
      if (owner !== null && !profilesRepo.get(owner)) throw new ProfileNotFoundError(owner);
      const analysis = cvAnalysesRepo.create({ file_name: fileName, file_type: type, profile_id: owner });
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
      starting.delete(key);
    }
  }

  // Analyse again after a failure or a restart, from the kept text (decision 26).
  function retry(owner: CvOwner = null): CvAnalysis {
    requireRunning();
    const analysis = cvAnalysesRepo.current(owner);
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
  async function discard(owner: CvOwner = null): Promise<boolean> {
    const analysis = cvAnalysesRepo.current(owner);
    if (!analysis) return false;
    const entry = halt(analysis.id);
    if (entry) await entry.settled;
    cvAnalysesRepo.remove(analysis.id);
    rmSync(analysisDir(analysis.id), { recursive: true, force: true });
    return true;
  }

  // Stops an analysis's agent, if one runs, so its late result is never written.
  function halt(analysisId: string): ActiveAnalysis | null {
    const entry = active.get(analysisId) ?? null;
    if (entry) {
      entry.ignoreResult = true;
      entry.controller.abort();
    }
    return entry;
  }

  // Create profile from a ready analysis: the files move to the profile's folder first and move back
  // if the database write fails, so a profile row never points at missing files.
  function createProfile(input: ProfileInput, analysisId: string, profileId: string): Profile {
    const analysis = cvAnalysesRepo.get(analysisId);
    if (!analysis) throw new CvAnalysisStateError('This CV analysis no longer exists.');
    if (analysis.profile_id !== null) {
      throw new CvAnalysisStateError('This CV analysis suggests changes to an existing profile.');
    }
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

  // Save of an applied review (SOW-0024, decisions 16 and 19): the new CV replaces the old one only
  // here. The old files stay untouched until the database points at the new ones: the new files wait
  // beside them as `*.new`, one transaction writes the profile, its CV columns and deletes the
  // analysis, and only then are the `*.new` files renamed over the old ones.
  function applyToProfile(input: ProfileInput, analysisId: string, profileId: string): Profile {
    const analysis = cvAnalysesRepo.get(analysisId);
    // Another profile's analysis reads as missing, as other profile-owned ids do.
    if (!analysis || analysis.profile_id !== profileId) {
      throw new CvAnalysisStateError('This CV analysis no longer exists.');
    }
    if (analysis.status !== 'succeeded') throw new CvAnalysisStateError('This CV analysis has not finished.');
    const from = analysisDir(analysis.id);
    const to = profileDir(profileId);
    const names = [originalName(analysis.file_type), TEXT_NAME];
    if (!names.every((name) => existsSync(join(from, name)))) {
      throw new CvAnalysisStateError('The CV of this analysis is missing. Discard it and upload the CV again.');
    }
    // `*.new` files here belong to an earlier Save whose renames failed; staging over them would lose
    // that CV, so they are put in place first.
    const stored = profilesRepo.storedCv(profileId);
    if (stored && pendingFiles(profileId).length > 0) finishSwap(profileId, stored.file_type);
    if (pendingFiles(profileId).length > 0) {
      throw new CvAnalysisStateError("The profile's current CV could not be put in place. Restart the app and try again.");
    }
    const moved: string[] = [];
    const moveBack = () => {
      for (const name of moved) renameSync(join(to, name + NEW_SUFFIX), join(from, name));
    };
    const cv: StoredCv = {
      file_name: analysis.file_name,
      file_type: analysis.file_type,
      added_at: new Date().toISOString(),
    };
    let profile: Profile;
    try {
      mkdirSync(to, { recursive: true });
      for (const name of names) {
        renameSync(join(from, name), join(to, name + NEW_SUFFIX));
        moved.push(name);
      }
      profile = db.transaction(() => {
        profilesRepo.update(profileId, input);
        const updated = profilesRepo.setCv(profileId, cv);
        cvAnalysesRepo.remove(analysis.id);
        return updated;
      })();
    } catch (err) {
      try {
        moveBack();
      } catch (backErr) {
        // `*.new` files in a profile folder must mean "committed or being committed"; leftovers would
        // later be taken for a committed CV. The upload is lost and its analysis reports missing files.
        console.error(`cv: could not return the uploaded CV of profile ${profileId}: ${messageOf(backErr)}`);
        for (const name of moved) removeQuietly(join(to, name + NEW_SUFFIX));
      }
      throw err;
    }
    finishSwap(profileId, analysis.file_type);
    removeQuietly(from);
    return profile;
  }

  // Puts the committed `*.new` files in place and deletes an old CV of another type. A failure is
  // logged and finished by the next start-up; the database already names the new CV.
  function finishSwap(profileId: string, type: CvFileType): void {
    const dir = profileDir(profileId);
    try {
      for (const name of [originalName(type), TEXT_NAME]) {
        if (existsSync(join(dir, name + NEW_SUFFIX))) renameSync(join(dir, name + NEW_SUFFIX), join(dir, name));
      }
      for (const other of CV_FILE_TYPES) {
        if (other !== type) {
          rmSync(join(dir, originalName(other)), { force: true });
          rmSync(join(dir, originalName(other) + NEW_SUFFIX), { force: true });
        }
      }
    } catch (err) {
      console.error(`cv: could not put the new CV of profile ${profileId} in place: ${messageOf(err)}`);
    }
  }

  const pendingFiles = (profileId: string): string[] => {
    try {
      return readdirSync(profileDir(profileId)).filter((name) => name.endsWith(NEW_SUFFIX));
    } catch {
      return [];
    }
  };

  // After a crash during Save: `*.new` files whose analysis still exists (and lacks its files) were never
  // committed and go back to it; otherwise the commit happened and the swap is finished, which also
  // deletes an old CV of another type that a crash right after the renames left behind. Returns false
  // when an unsaved CV could not be returned, so the start-up sweep keeps its folder.
  function recoverSwap(profileId: string): boolean {
    const dir = profileDir(profileId);
    const pending = pendingFiles(profileId);
    const analysis = cvAnalysesRepo.current(profileId);
    const staged = analysis ? [originalName(analysis.file_type), TEXT_NAME].map((n) => n + NEW_SUFFIX) : [];
    if (
      pending.length > 0 &&
      pending.every((name) => staged.includes(name)) &&
      analysis?.status === 'succeeded' &&
      !existsSync(join(analysisDir(analysis.id), originalName(analysis.file_type)))
    ) {
      try {
        mkdirSync(analysisDir(analysis.id), { recursive: true });
        for (const name of pending) {
          renameSync(join(dir, name), join(analysisDir(analysis.id), name.slice(0, -NEW_SUFFIX.length)));
        }
      } catch (err) {
        console.error(`cv: could not return an unsaved CV of profile ${profileId}: ${messageOf(err)}`);
        return false;
      }
    }
    const stored = profilesRepo.storedCv(profileId);
    if (stored) finishSwap(profileId, stored.file_type);
    else for (const name of pendingFiles(profileId)) removeQuietly(join(dir, name));
    return true;
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

  // Profile delete (SOW-0024, C3): the caller deletes the rows, including the analysis row, in one
  // transaction first; this stops the profile's agent, waits for it (Windows cannot delete a folder a
  // live process works in) and deletes each folder on its own, so one failure leaves only that folder
  // for the start-up sweep.
  async function removeProfileFiles(profileId: string, analysisId: string | null): Promise<void> {
    if (analysisId) {
      const entry = halt(analysisId);
      if (entry) await settledWithin(entry);
      removeQuietly(analysisDir(analysisId));
    }
    removeQuietly(profileDir(profileId));
  }

  async function settledWithin(...entries: ActiveAnalysis[]): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(entries.map((e) => e.settled)),
      new Promise<void>((r) => (timer = setTimeout(r, stopTimeoutMs))),
    ]);
    clearTimeout(timer);
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
    const profiles = profilesRepo.list();
    const keep = new Set(profiles.filter((p) => p.cv).map((p) => p.id));
    for (const profile of profiles) if (!recoverSwap(profile.id)) keep.add(profile.id);
    sweep(profilesRoot, keep);
  }

  // Shutdown: the agent is killed and the row stays running, so the next start marks it interrupted.
  async function stop(): Promise<void> {
    stopped = true;
    const entries = [...active.keys()].map((id) => halt(id)).filter((e): e is ActiveAnalysis => e !== null);
    if (entries.length > 0) await settledWithin(...entries);
  }

  return {
    current,
    start,
    retry,
    discard,
    createProfile,
    applyToProfile,
    profileCvPath,
    removeProfileCv,
    removeProfileFiles,
    startup,
    stop,
  };
}

export type CvService = ReturnType<typeof createCvService>;
