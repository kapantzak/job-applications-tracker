import type { AgentAdapter } from '../agents/types.js';
import type { createJobsRepo, NewJob } from '../db/jobs-repo.js';
import type { createProfileRepo } from '../db/profile-repo.js';
import type { createSettingsRepo } from '../db/settings-repo.js';
import type { Profile, RunKind, Settings, VerificationStatus } from '../domain/types.js';
import type { RunHandler } from '../runs/queue.js';
import { outputJsonSchema, DiscoverJobsOutput } from '../tasks/schemas.js';
import { renderPrompt } from '../tasks/prompts.js';
import { canonicalUrl, dedupeKey } from '../verify/canonicalize.js';
import { verifyLink } from '../verify/links.js';

export interface DiscoveryDeps {
  profileRepo: ReturnType<typeof createProfileRepo>;
  jobsRepo: ReturnType<typeof createJobsRepo>;
  settingsRepo: ReturnType<typeof createSettingsRepo>;
  adapterFactory: (settings: Settings, kind: RunKind) => AgentAdapter;
  verify?: typeof verifyLink;
}

const VERIFY_CONCURRENCY = 5;
const KNOWN_URLS_LIMIT = 200;

function list(items: string[]): string {
  return items.length ? items.join(', ') : '(none)';
}

function renderProfile(p: Profile): string {
  return [
    `Target roles: ${list(p.target_roles)}`,
    `Locations: ${list(p.locations)}`,
    `Remote: ${p.remote}`,
    `Seniority: ${p.seniority || '(none)'}`,
    `Keywords: ${list(p.keywords)}`,
    `Excluded companies: ${list(p.excluded_companies)}`,
    `Notes: ${p.notes || '(none)'}`,
  ].join('\n');
}

// Order-preserving map with bounded concurrency; avoids a dependency for one call site.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function createDiscoveryHandler(deps: DiscoveryDeps): RunHandler {
  const { profileRepo, jobsRepo, settingsRepo, adapterFactory } = deps;
  const verify = deps.verify ?? verifyLink;

  return async (ctx) => {
    const profile = profileRepo.get();
    if (!profile) throw new Error('Profile is not set');
    const settings = settingsRepo.getAll();

    const knownUrls = jobsRepo.recentCanonicalUrls(KNOWN_URLS_LIMIT);
    const { text, version } = renderPrompt('discover_jobs', {
      profile: renderProfile(profile),
      known_urls: knownUrls.length ? knownUrls.join('\n') : '(none)',
    });

    const adapter = adapterFactory(settings, 'discover_jobs');
    ctx.log(`Using adapter ${adapter.id}`);
    const result = await adapter.run(
      { kind: 'discover_jobs', prompt: text, outputSchema: outputJsonSchema('discover_jobs') },
      { timeoutMs: settings.run_timeout_ms, cwd: ctx.runDir, onLog: ctx.log, signal: ctx.signal },
    );
    if (!result.ok) throw new Error(`Agent run failed: ${result.error}`);

    const parsed = DiscoverJobsOutput.safeParse(result.output);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`Agent output did not match schema: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`);
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    let dead = 0;
    let unverified = 0;
    let duplicates = 0;
    const parseable: { job: (typeof parsed.data.jobs)[number]; canonical: string }[] = [];
    for (const job of parsed.data.jobs) {
      let canonical: string;
      try {
        canonical = canonicalUrl(job.url);
      } catch {
        ctx.log(`Skipping unparseable url: ${job.url}`);
        dead++;
        continue;
      }
      // Only web links are fetched and shown; anything else (javascript:, file:, ...) is unusable.
      const { protocol } = new URL(canonical);
      if (protocol !== 'http:' && protocol !== 'https:') {
        ctx.log(`Skipping unsupported url: ${job.url}`);
        dead++;
        continue;
      }
      parseable.push({ job, canonical });
    }

    const verified = await mapLimit(parseable, VERIFY_CONCURRENCY, async (entry) => ({
      ...entry,
      verdict: await verify(entry.canonical),
    }));

    const existing = jobsRepo.existingDedupeKeys();
    const seen = new Set<string>();
    const newJobs: NewJob[] = [];
    const statuses: VerificationStatus[] = [];
    const verifiedAt = new Date().toISOString();
    for (const { job, canonical, verdict } of verified) {
      const canonical_url = verdict.status === 'redirected' ? canonicalUrl(verdict.finalUrl) : canonical;
      const key = dedupeKey({ canonical_url, company: job.company, title: job.title, location: job.location });
      if (existing.has(key) || seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      statuses.push(verdict.status);
      newJobs.push({
        company: job.company,
        title: job.title,
        location: job.location,
        remote: job.remote,
        url: job.url,
        canonical_url,
        source_site: job.source_site,
        posted_at: job.posted_at,
        salary: job.salary,
        description_excerpt: job.description_excerpt,
        match_reason: job.match_reason,
        verification_status: verdict.status,
        verified_at: verifiedAt,
        dedupe_key: key,
      });
    }

    const inserted = jobsRepo.insertMany(ctx.run.id, newJobs);
    // Count outcomes only for rows actually stored.
    const storedUrls = new Set(inserted.map((j) => j.dedupe_key));
    newJobs.forEach((j, i) => {
      if (!storedUrls.has(j.dedupe_key)) return;
      if (statuses[i] === 'dead') dead++;
      else if (statuses[i] === 'unverified') unverified++;
    });

    const summary = `${inserted.length} new, ${duplicates} duplicates, ${dead} dead, ${unverified} unverified`;
    ctx.log(summary);
    return { summary, promptVersion: version, adapterId: adapter.id };
  };
}
