// Mock data for the UI sandbox (SOW-0028). Writes go through the repositories so the rows match what the
// app itself stores; repositories stamp the current time, so timestamps are backdated afterwards.
// Every company, person, address and link here is invented.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApplicationsRepo } from '../../src/server/db/applications-repo.js';
import type { Db } from '../../src/server/db/connection.js';
import { createJobsRepo, type NewJob } from '../../src/server/db/jobs-repo.js';
import { createProfilesRepo, type ProfileInput } from '../../src/server/db/profiles-repo.js';
import { createProposalsRepo } from '../../src/server/db/proposals-repo.js';
import { createRunsRepo } from '../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../src/server/db/settings-repo.js';
import type {
  ApplicationStatus,
  EffortMode,
  FitChecks,
  JobRemote,
  ProposalEvidence,
  RunKind,
  RunStatus,
  VerificationStatus,
} from '../../src/server/domain/types.js';
import {
  hasFailedWorkers,
  MAX_EFFORT_CONCURRENCY,
  MAX_EFFORT_SOURCES,
  RUN_SAVING_LOG_LINE,
  workersFailedNote,
} from '../../src/server/domain/types.js';
import { createProposalService } from '../../src/server/services/proposals.js';
import { canonicalUrl, dedupeKey } from '../../src/server/verify/canonicalize.js';

export interface SeedOptions {
  dataDir: string;
  now: Date;
  // Custom agent command saved in settings, so runs started in the sandbox never reach a real agent.
  mockAgentCommand: string;
}

export interface SeedSummary {
  profiles: { name: string; slug: string }[];
}

// Double quotes with \" and \\ escaped, as splitShellWords in src/server/agents/presets.ts reads them.
const quote = (word: string): string => `"${word.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

export function mockAgentCommand(nodePath: string, scriptPath: string, opts: { delayMs?: number } = {}): string {
  const delay = opts.delayMs === undefined ? [] : ['--delay-ms', String(opts.delayMs)];
  return [quote(nodePath), quote(scriptPath), ...delay, '{prompt_file}'].join(' ');
}

type ProfileKey = 'rich' | 'sparse' | 'empty' | 'miss' | 'rounds';

const DAY = 86_400_000;
const MINUTE = 60_000;

const CV_TEXT = `# Sam Placeholder - Frontend Engineer

Berlin, Germany - open to hybrid work

## Summary

Frontend engineer with eight years of experience building design systems and data-heavy web apps
with React and TypeScript. Cares about accessibility, testing and fast builds.

## Experience

- Senior Frontend Engineer, Example Widgets GmbH (2022 - now): led the shared component library used by six teams.
- Frontend Engineer, Sample Retail AG (2018 - 2022): rebuilt the checkout in React; cut bundle size by 40%.
- Web Developer, Demo Agency (2016 - 2018): client sites and internal tools.

## Skills

React, TypeScript, Vite, Testing Library, Playwright, CSS architecture, WCAG 2.2, GraphQL
`;

interface RunSpec {
  key: string;
  profile: 'rich' | 'sparse' | 'rounds';
  kind: RunKind;
  status: Exclude<RunStatus, 'queued' | 'running'>;
  daysAgo: number;
  minutes: number;
  effort?: EffortMode;
  // The user's own instructions for the search (SOW-0042); such a run used the v5 prompt.
  customPrompt?: string;
  summary?: string;
  error?: string;
  cost?: number;
  tokens?: [number, number];
}

interface JobSpec {
  key: string;
  run: string;
  company: string;
  title: string;
  location: string;
  remote: JobRemote;
  source: string;
  status: VerificationStatus;
  checks: FitChecks | null;
  salary?: string;
  excerpt: string;
  reason: string;
  postedDaysAgo?: number;
  dismissed?: boolean;
  // A later search that returned the job again (SOW-0040); its summary counts it as a duplicate.
  seenAgainIn?: string;
  // Status when first found, when that later search's check changed it (`status` is the current one).
  firstStatus?: VerificationStatus;
}

const pass: FitChecks = { location: 'pass', remote: 'pass', seniority: 'pass' };

const RUNS: RunSpec[] = [
  { key: 'r1', profile: 'rich', kind: 'discover_jobs', status: 'succeeded', daysAgo: 35, minutes: 11,
    summary: '6 new, 0 duplicates, 1 dead, 1 unverified', cost: 0.84, tokens: [182_400, 6_200] },
  { key: 'r2', profile: 'rich', kind: 'discover_jobs', status: 'succeeded', daysAgo: 20, minutes: 24, effort: 'max',
    summary: `7 new, 2 duplicates, 0 dead, 0 unverified${workersFailedNote(1, 5)}`, cost: 3.12, tokens: [702_900, 21_400] },
  { key: 'r3', profile: 'rich', kind: 'discover_jobs', status: 'failed', daysAgo: 12, minutes: 20,
    error: 'Agent run failed: Timed out after 1200000 ms', cost: 1.47, tokens: [311_000, 9_800] },
  { key: 'r4', profile: 'rich', kind: 'sync_mail', status: 'succeeded', daysAgo: 6, minutes: 3,
    summary: '2 proposals created, 0 skipped', cost: 0.21, tokens: [48_100, 1_900] },
  { key: 'r5', profile: 'rich', kind: 'discover_jobs', status: 'aborted', daysAgo: 3, minutes: 2,
    error: 'Cancelled by user', cost: 0.09, tokens: [21_700, 400] },
  { key: 'r6', profile: 'rich', kind: 'sync_mail', status: 'succeeded', daysAgo: 1, minutes: 4,
    summary: '3 proposals created, 0 skipped', cost: 0.26, tokens: [52_300, 2_300] },
  { key: 's1', profile: 'sparse', kind: 'discover_jobs', status: 'succeeded', daysAgo: 9, minutes: 8,
    summary: '2 new, 0 duplicates, 0 dead, 0 unverified', cost: 0.55, tokens: [120_800, 3_900] },
  // Search rounds (SOW-0041): each later search finds some earlier jobs again; the newest finds nothing new.
  { key: 'b1', profile: 'rounds', kind: 'discover_jobs', status: 'succeeded', daysAgo: 28, minutes: 12,
    summary: '5 new, 0 duplicates, 0 dead, 1 unverified', cost: 0.79, tokens: [171_200, 5_800] },
  { key: 'b2', profile: 'rounds', kind: 'discover_jobs', status: 'succeeded', daysAgo: 16, minutes: 26, effort: 'max',
    summary: '4 new, 3 duplicates, 0 dead, 0 unverified', cost: 3.48, tokens: [758_300, 23_100] },
  { key: 'b3', profile: 'rounds', kind: 'discover_jobs', status: 'succeeded', daysAgo: 6, minutes: 10,
    customPrompt: 'Only payments and fintech companies.\nSkip recruiting agencies.',
    summary: '2 new, 3 duplicates, 0 dead, 0 unverified', cost: 0.71, tokens: [158_900, 4_700] },
  { key: 'b4', profile: 'rounds', kind: 'discover_jobs', status: 'succeeded', daysAgo: 1, minutes: 9,
    summary: '0 new, 3 duplicates, 0 dead, 0 unverified', cost: 0.62, tokens: [139_400, 3_600] },
];

const JOBS: JobSpec[] = [
  { key: 'acme', run: 'r1', company: 'Acme Robotics', title: 'Senior Frontend Engineer', location: 'Berlin, Germany',
    remote: 'hybrid', source: 'greenhouse.io', status: 'ok', checks: pass, salary: 'EUR 85,000 - 100,000',
    excerpt: 'Own the operator dashboard for a fleet of warehouse robots. React, TypeScript, WebSockets.',
    reason: 'Senior frontend role in Berlin with hybrid work and a React stack.', postedDaysAgo: 38, seenAgainIn: 'r2' },
  { key: 'globex', run: 'r1', company: 'Globex Analytics', title: 'Staff UI Engineer', location: 'Remote (EU)',
    remote: 'remote', source: 'lever.co', status: 'ok', checks: pass,
    excerpt: 'Lead the charting and table components of an analytics product used by 2,000 companies.',
    reason: 'Staff level, remote in the EU, design-system work.', postedDaysAgo: 40, seenAgainIn: 'r2' },
  { key: 'initech', run: 'r1', company: 'Initech Cloud', title: 'Frontend Platform Engineer',
    location: 'Amsterdam, Netherlands', remote: 'onsite', source: 'ashbyhq.com', status: 'ok',
    checks: { location: 'fail', remote: 'fail', seniority: 'pass' },
    excerpt: 'Build the shared build tooling and component library for 30 product teams.',
    reason: 'Platform focus matches; location and on-site work do not.' },
  { key: 'umbrella', run: 'r1', company: 'Umbrella Health', title: 'Senior React Developer', location: 'Remote',
    remote: 'remote', source: 'example.com careers page', status: 'unverified', checks: null,
    excerpt: 'Patient-facing booking app; strong accessibility requirements.',
    reason: 'React and accessibility focus.' },
  { key: 'closed', run: 'r1', company: 'Closed Corp', title: 'Frontend Engineer', location: 'Munich, Germany',
    remote: 'hybrid', source: 'greenhouse.io', status: 'dead', checks: pass,
    excerpt: 'The posting was taken down after it was found.', reason: 'Frontend role in Germany.' },
  { key: 'hooli', run: 'r1', company: 'Hooli Maps', title: 'Design Systems Engineer', location: 'Lisbon, Portugal',
    remote: 'hybrid', source: 'lever.co', status: 'ok',
    checks: { location: 'unknown', remote: 'pass', seniority: 'unknown' },
    excerpt: 'Grow the map product design system across web and mobile web.',
    reason: 'Design systems role; the posting does not name a level.', dismissed: true },
  { key: 'vandelay', run: 'r2', company: 'Vandelay Logistics', title: 'Senior Web Engineer', location: 'Remote (Europe)',
    remote: 'remote', source: 'greenhouse.io', status: 'ok', checks: pass, salary: 'EUR 90,000',
    excerpt: 'Shipment tracking UI in React with a heavy focus on performance.',
    reason: 'Senior, remote in Europe, React.', postedDaysAgo: 22 },
  { key: 'stark', run: 'r2', company: 'Stark Energy', title: 'Lead Frontend Engineer', location: 'Berlin, Germany',
    remote: 'hybrid', source: 'ashbyhq.com', status: 'ok', checks: pass,
    excerpt: 'Lead a team of four on the energy-trading web client.', reason: 'Lead role in Berlin.', postedDaysAgo: 21 },
  { key: 'wayne', run: 'r2', company: 'Wayne Fintech', title: 'Senior Frontend Engineer, Payments',
    location: 'Frankfurt, Germany', remote: 'hybrid', source: 'example.com careers page', status: 'redirected',
    checks: { location: 'fail', remote: 'pass', seniority: 'pass' },
    excerpt: 'Checkout and payment flows for merchants.', reason: 'Payments frontend; Frankfurt is outside the profile.' },
  { key: 'soylent', run: 'r2', company: 'Soylent Foods', title: 'UI Engineer', location: 'Remote', remote: 'remote',
    source: 'lever.co', status: 'ok', checks: { location: 'pass', remote: 'pass', seniority: 'fail' },
    excerpt: 'Mid-level role on the ordering app.', reason: 'Remote React role, below the target level.' },
  { key: 'tyrell', run: 'r2', company: 'Tyrell Labs', title: 'Senior Software Engineer, Web', location: 'Berlin, Germany',
    remote: 'hybrid', source: 'greenhouse.io', status: 'ok', checks: pass, salary: 'EUR 95,000 - 115,000',
    excerpt: 'Web client for a lab-automation platform.', reason: 'Senior web role in Berlin.', postedDaysAgo: 25 },
  { key: 'cyberdyne', run: 'r2', company: 'Cyberdyne Systems', title: 'Staff Frontend Engineer', location: 'Remote (EU)',
    remote: 'remote', source: 'ashbyhq.com', status: 'ok', checks: pass,
    excerpt: 'Set the frontend architecture for a new monitoring product.', reason: 'Staff, remote, architecture work.' },
  { key: 'massive', run: 'r2', company: 'Massive Dynamic', title: 'Frontend Engineer, Accessibility',
    location: 'Hamburg, Germany', remote: 'hybrid', source: 'lever.co', status: 'ok',
    checks: { location: 'unknown', remote: 'pass', seniority: 'unknown' },
    excerpt: 'Make a public-sector portal meet WCAG 2.2 AA.', reason: 'Accessibility specialist role.' },
  { key: 'pied', run: 's1', company: 'Pied Piper Data', title: 'Data Analyst', location: 'Remote', remote: 'remote',
    source: 'greenhouse.io', status: 'ok', checks: pass,
    excerpt: 'SQL reporting for the compression product.', reason: 'Remote analyst role with SQL.' },
  { key: 'dunder', run: 's1', company: 'Dunder Paper Co', title: 'Junior Data Analyst', location: 'Athens, Greece',
    remote: 'hybrid', source: 'lever.co', status: 'ok', checks: { location: 'pass', remote: 'fail', seniority: 'fail' },
    excerpt: 'Sales dashboards in Python and SQL.', reason: 'Analyst role in Athens; hybrid and junior.' },
  // Backend Engineering: b2 found aperture, blackmesa and gringotts again; b3 aperture, oceanic and monarch;
  // b4 aperture, weyland and prestige. Only the latest sighting is stored, as the app does.
  { key: 'aperture', run: 'b1', company: 'Aperture Systems', title: 'Senior Backend Engineer', location: 'Berlin, Germany',
    remote: 'hybrid', source: 'greenhouse.io', status: 'ok', checks: pass, salary: 'EUR 88,000 - 105,000',
    excerpt: 'Event pipeline for a test-automation platform. Go, PostgreSQL, Kafka.',
    reason: 'Senior backend role in Berlin with hybrid work.', postedDaysAgo: 30, seenAgainIn: 'b4' },
  { key: 'blackmesa', run: 'b1', company: 'Black Mesa Labs', title: 'Backend Engineer, Platform', location: 'Remote (EU)',
    remote: 'remote', source: 'lever.co', status: 'redirected', firstStatus: 'ok', checks: pass,
    excerpt: 'Internal platform APIs for research teams.',
    reason: 'Platform backend work, remote in the EU.', postedDaysAgo: 31, seenAgainIn: 'b2' },
  { key: 'nakatomi', run: 'b1', company: 'Nakatomi Trading', title: 'Senior Software Engineer, Go',
    location: 'Frankfurt, Germany', remote: 'onsite', source: 'ashbyhq.com', status: 'ok',
    checks: { location: 'fail', remote: 'fail', seniority: 'pass' },
    excerpt: 'Low-latency order routing services.', reason: 'Senior Go role; Frankfurt and on-site do not fit.' },
  { key: 'oceanic', run: 'b1', company: 'Oceanic Air', title: 'Backend Engineer, Bookings', location: 'Remote',
    remote: 'remote', source: 'example.com careers page', status: 'unverified', checks: null,
    excerpt: 'Booking and seat-map services for a regional airline.', reason: 'Backend role with a booking domain.',
    seenAgainIn: 'b3' },
  { key: 'gringotts', run: 'b1', company: 'Gringotts Payments', title: 'Staff Backend Engineer', location: 'London, UK',
    remote: 'hybrid', source: 'greenhouse.io', status: 'dead', firstStatus: 'ok',
    checks: { location: 'fail', remote: 'pass', seniority: 'pass' },
    excerpt: 'Ledger services for card payments.', reason: 'Staff backend role; London is outside the profile.',
    seenAgainIn: 'b2' },
  { key: 'weyland', run: 'b2', company: 'Weyland Freight', title: 'Senior Backend Engineer', location: 'Remote (EU)',
    remote: 'remote', source: 'ashbyhq.com', status: 'ok', checks: pass, salary: 'EUR 92,000',
    excerpt: 'Route planning APIs for a freight network.', reason: 'Senior, remote in the EU.', postedDaysAgo: 18,
    seenAgainIn: 'b4' },
  { key: 'monarch', run: 'b2', company: 'Monarch Data', title: 'Data Platform Engineer', location: 'Amsterdam, Netherlands',
    remote: 'hybrid', source: 'lever.co', status: 'ok', checks: { location: 'unknown', remote: 'pass', seniority: 'unknown' },
    excerpt: 'Batch and streaming jobs for an analytics warehouse.', reason: 'Data platform work; no level is named.',
    seenAgainIn: 'b3' },
  { key: 'bluth', run: 'b2', company: 'Bluth Homes', title: 'Backend Engineer', location: 'Berlin, Germany',
    remote: 'hybrid', source: 'greenhouse.io', status: 'ok', checks: { location: 'pass', remote: 'pass', seniority: 'fail' },
    excerpt: 'Listings and offers services for a property marketplace.', reason: 'Berlin backend role below the target level.' },
  { key: 'sterling', run: 'b2', company: 'Sterling Cooper Digital', title: 'Senior API Engineer', location: 'Remote',
    remote: 'remote', source: 'example.com careers page', status: 'redirected', checks: pass,
    excerpt: 'Public APIs for an advertising platform.', reason: 'Senior API role, remote.' },
  { key: 'prestige', run: 'b3', company: 'Prestige Worldwide', title: 'Senior Backend Engineer', location: 'Remote (EU)',
    remote: 'remote', source: 'lever.co', status: 'ok', checks: pass,
    excerpt: 'Event ticketing services at peak load.', reason: 'Senior backend, remote in the EU.', postedDaysAgo: 7,
    seenAgainIn: 'b4' },
  { key: 'krusty', run: 'b3', company: 'Krusty Logistics', title: 'Backend Engineer, Fulfilment', location: 'Hamburg, Germany',
    remote: 'hybrid', source: 'ashbyhq.com', status: 'ok', checks: { location: 'fail', remote: 'pass', seniority: 'pass' },
    excerpt: 'Warehouse fulfilment services.', reason: 'Backend role; Hamburg is outside the profile.' },
];

interface AppStep {
  to: ApplicationStatus;
  daysAgo: number;
}

interface AppSpec {
  key: string;
  profile: 'rich' | 'sparse' | 'miss';
  job?: string;
  company?: string;
  role?: string;
  url?: string;
  // First status; `steps` are later changes made by the user.
  start: ApplicationStatus;
  daysAgo: number;
  steps?: AppStep[];
  notes?: string;
  domains: string[];
}

const APPS: AppSpec[] = [
  { key: 'saved', profile: 'rich', job: 'tyrell', start: 'saved', daysAgo: 18, notes: 'Ask Dana about the team first.',
    domains: ['tyrell-labs.example.com'] },
  { key: 'applied', profile: 'rich', job: 'vandelay', start: 'applied', daysAgo: 9, domains: ['vandelay.example.com'] },
  { key: 'screening', profile: 'rich', job: 'acme', start: 'applied', daysAgo: 30, steps: [{ to: 'screening', daysAgo: 24 }],
    notes: 'Recruiter call went well; take-home expected.', domains: ['acme-robotics.example.com'] },
  // The move to interview comes from an accepted proposal (see PROPOSALS).
  { key: 'interview', profile: 'rich', job: 'globex', start: 'applied', daysAgo: 33, steps: [{ to: 'screening', daysAgo: 27 }],
    domains: ['globex.example.com'] },
  { key: 'offer', profile: 'rich', job: 'stark', start: 'applied', daysAgo: 19,
    steps: [{ to: 'screening', daysAgo: 15 }, { to: 'interview', daysAgo: 11 }, { to: 'offer', daysAgo: 4 }],
    notes: 'Offer: EUR 98,000, answer due Friday.', domains: ['stark-energy.example.com'] },
  { key: 'rejected', profile: 'rich', job: 'initech', start: 'applied', daysAgo: 32, steps: [{ to: 'rejected', daysAgo: 16 }],
    domains: ['initech.example.com'] },
  { key: 'withdrawn', profile: 'rich', job: 'soylent', start: 'applied', daysAgo: 17, steps: [{ to: 'withdrawn', daysAgo: 13 }],
    notes: 'Level too junior after the first call.', domains: ['soylent.example.com'] },
  { key: 'no_response', profile: 'rich', job: 'cyberdyne', start: 'applied', daysAgo: 19,
    steps: [{ to: 'no_response', daysAgo: 5 }], domains: ['cyberdyne.example.com'] },
  // Added by hand, without a job from discovery.
  { key: 'referral', profile: 'rich', company: 'Oscorp Media', role: 'Senior Frontend Engineer (referral)',
    url: 'https://example.com/?mock-job=oscorp-referral', start: 'applied', daysAgo: 7,
    notes: 'Referred by a former colleague.', domains: ['oscorp.example.com'] },
  { key: 'analyst', profile: 'sparse', job: 'pied', start: 'applied', daysAgo: 8, domains: ['pied-piper.example.com'] },
  // Scope Miss: open applications under a label the mock agent reports as matching no mail (SOW-0033).
  { key: 'miss-hooli', profile: 'miss', company: 'Hooli Devices', role: 'QA Engineer',
    url: 'https://example.com/?mock-job=hooli-qa', start: 'applied', daysAgo: 6, domains: ['hooli.example.com'] },
  { key: 'miss-massive', profile: 'miss', company: 'Massive Dynamic', role: 'Test Automation Engineer',
    url: 'https://example.com/?mock-job=massive-qa', start: 'applied', daysAgo: 4, steps: [{ to: 'screening', daysAgo: 2 }],
    domains: ['massive-dynamic.example.com'] },
];

interface ProposalSpec {
  run: string;
  app: string;
  to: ApplicationStatus;
  confidence: number;
  reason: string;
  daysAgo: number;
  decided?: { state: 'accepted' | 'rejected'; daysAgo: number };
  subject: string;
  snippet: string;
}

const PROPOSALS: ProposalSpec[] = [
  { run: 'r4', app: 'interview', to: 'interview', confidence: 0.94, daysAgo: 6, decided: { state: 'accepted', daysAgo: 5 },
    reason: 'The recruiter proposes three slots for a technical interview.',
    subject: 'Next step: technical interview', snippet: 'We would love to invite you to a 60-minute technical interview...' },
  { run: 'r4', app: 'applied', to: 'rejected', confidence: 0.41, daysAgo: 6, decided: { state: 'rejected', daysAgo: 5 },
    reason: 'A generic newsletter that mentions "unfortunately"; probably not about this application.',
    subject: 'Our monthly engineering newsletter', snippet: 'Unfortunately we missed our release date last month...' },
  { run: 'r6', app: 'applied', to: 'screening', confidence: 0.88, daysAgo: 1,
    reason: 'The talent team asks for a 30-minute intro call.',
    subject: 'Intro call for Senior Web Engineer', snippet: 'Thanks for applying! Could you pick a time for a short intro call...' },
  { run: 'r6', app: 'screening', to: 'interview', confidence: 0.79, daysAgo: 1,
    reason: 'The take-home was received and an onsite loop is being scheduled.',
    subject: 'Take-home received - next steps', snippet: 'Thanks for the submission. We would like to schedule the final round...' },
  { run: 'r6', app: 'no_response', to: 'rejected', confidence: 0.97, daysAgo: 1,
    reason: 'A clear rejection email for the Staff Frontend Engineer role.',
    subject: 'Update on your application', snippet: 'After careful consideration we have decided not to move forward...' },
];

export function seedMockData(db: Db, opts: SeedOptions): SeedSummary {
  const nowMs = opts.now.getTime();
  const ago = (days: number, extraMs = 0): string => new Date(nowMs - days * DAY + extraMs).toISOString();

  const profilesRepo = createProfilesRepo(db);
  const runsRepo = createRunsRepo(db);
  const jobsRepo = createJobsRepo(db);
  const applicationsRepo = createApplicationsRepo(db);
  const proposalsRepo = createProposalsRepo(db);
  const proposalService = createProposalService({ db, proposalsRepo, applicationsRepo });

  const touch = (table: string, id: string, fields: Record<string, string | null>): void => {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
    // Table and column names come from this file only.
    db.prepare(`UPDATE ${table} SET ${sets} WHERE id = @id`).run({ ...fields, id });
  };
  const latestHistoryId = (appId: string): string =>
    (db.prepare('SELECT id FROM status_history WHERE application_id = ? ORDER BY rowid DESC LIMIT 1').get(appId) as {
      id: string;
    }).id;

  const seed = db.transaction((): SeedSummary => {
    createSettingsRepo(db).set({ adapter_id: 'custom', custom_command: opts.mockAgentCommand, sync_interval: 'off' });

    const profileInputs: Record<ProfileKey, [ProfileInput, number]> = {
      rich: [{
        name: 'Frontend Platform',
        target_roles: ['Senior Frontend Engineer', 'Staff Frontend Engineer', 'UI Platform Engineer'],
        locations: ['Berlin, Germany', 'Remote (EU)'],
        remote: 'hybrid',
        seniority: 'Senior, Staff',
        keywords: ['React', 'TypeScript', 'Design systems', 'Accessibility', 'Vite', 'Testing Library'],
        excluded_companies: ['Initrode'],
        notes: 'Prefers product teams with a shared component library. No agencies.',
        mail_filter_kind: 'label',
        mail_filter: 'Jobs/Frontend',
      }, 40],
      sparse: [{
        name: 'Data Analyst Roles',
        target_roles: ['Data Analyst'],
        locations: ['Athens, Greece'],
        remote: 'remote',
        seniority: 'Mid-level',
        keywords: ['SQL', 'Python'],
        excluded_companies: [],
        notes: '',
        mail_filter_kind: 'query',
        mail_filter: 'to:you+data@example.com OR label:jobs-data',
      }, 10],
      empty: [{
        name: 'Empty Search',
        target_roles: [],
        locations: [],
        remote: 'any',
        seniority: '',
        keywords: [],
        excluded_companies: [],
        notes: '',
        mail_filter_kind: 'label',
        mail_filter: '',
      }, 1],
      // The mock agent reports a scope containing "nomatch" as matching no mail (SOW-0033).
      miss: [{
        name: 'Scope Miss',
        target_roles: ['QA Engineer'],
        locations: ['Lisbon, Portugal'],
        remote: 'remote',
        seniority: 'Mid-level',
        keywords: ['Playwright', 'Cypress'],
        excluded_companies: [],
        notes: '',
        mail_filter_kind: 'label',
        mail_filter: 'NoMatch',
      }, 7],
      rounds: [{
        name: 'Backend Engineering',
        target_roles: ['Senior Backend Engineer', 'Staff Backend Engineer'],
        locations: ['Berlin, Germany', 'Remote (EU)'],
        remote: 'hybrid',
        seniority: 'Senior, Staff',
        keywords: ['Go', 'PostgreSQL', 'Kafka', 'APIs'],
        excluded_companies: [],
        notes: '',
        mail_filter_kind: 'label',
        mail_filter: 'Jobs/Backend',
      }, 30],
    };
    const profiles = {} as Record<ProfileKey, { id: string; name: string; slug: string }>;
    for (const [key, [input, daysAgo]] of Object.entries(profileInputs) as [keyof typeof profileInputs, [ProfileInput, number]][]) {
      const cv = key === 'rich' ? { file_name: 'frontend-cv.md', file_type: 'md' as const, added_at: ago(daysAgo) } : undefined;
      const p = profilesRepo.create(input, { cv });
      touch('profiles', p.id, { created_at: ago(daysAgo) });
      profiles[key] = p;
    }
    // Same layout as src/server/cv/service.ts: the original file plus its extracted text.
    const cvDir = join(opts.dataDir, 'profiles', profiles.rich.id);
    mkdirSync(cvDir, { recursive: true });
    writeFileSync(join(cvDir, 'cv.md'), CV_TEXT);
    writeFileSync(join(cvDir, 'cv-text.txt'), CV_TEXT);

    const runs: Record<string, { id: string; finishedAt: string }> = {};
    for (const spec of RUNS) {
      const run = runsRepo.create(spec.kind, profiles[spec.profile].id, {
        adapter_id: 'claude',
        prompt_version: spec.kind === 'discover_jobs' ? (spec.customPrompt ? '5' : '4') : '2',
        effort_mode: spec.effort ?? 'default',
        custom_prompt: spec.customPrompt ?? null,
      });
      const createdAt = ago(spec.daysAgo);
      const finishedAt = ago(spec.daysAgo, spec.minutes * MINUTE + 1000);
      runsRepo.update(run.id, {
        status: spec.status,
        started_at: ago(spec.daysAgo, 1000),
        finished_at: finishedAt,
        summary: spec.summary ?? null,
        error: spec.error ?? null,
        agent_model: 'sonnet',
        agent_effort: '',
        agent_model_reported: 'claude-sonnet-5-5',
        usage_cost_usd: spec.cost ?? null,
        usage_input_tokens: spec.tokens?.[0] ?? null,
        usage_output_tokens: spec.tokens?.[1] ?? null,
      });
      touch('runs', run.id, { created_at: createdAt });
      runs[spec.key] = { id: run.id, finishedAt };
    }

    const jobs: Record<string, { id: string; url: string; company: string; title: string }> = {};
    JOBS.forEach((spec, i) => {
      const n = i + 1;
      const run = runs[spec.run]!;
      // example.com answers 200 at its root and 404 elsewhere, so "Open" behaves like the stored status.
      const url = spec.status === 'dead' ? `https://example.com/mock-closed/seed-${n}` : `https://example.com/?mock-job=seed-${n}`;
      // Only a job saved after a redirect stores another link; one that redirects later keeps its own.
      const firstStatus = spec.firstStatus ?? spec.status;
      const original = firstStatus === 'redirected' ? `https://example.org/?mock-job=seed-${n}` : url;
      const canonical = canonicalUrl(url);
      const job: NewJob = {
        company: spec.company,
        title: spec.title,
        location: spec.location,
        remote: spec.remote,
        url: original,
        canonical_url: canonical,
        source_site: spec.source,
        posted_at: spec.postedDaysAgo === undefined ? null : ago(spec.postedDaysAgo).slice(0, 10),
        salary: spec.salary ?? null,
        description_excerpt: spec.excerpt,
        match_reason: spec.reason,
        fit_checks: spec.checks,
        verification_status: spec.status,
        verified_at: firstStatus === 'unverified' ? null : run.finishedAt,
        dedupe_key: dedupeKey({ canonical_url: canonical, company: spec.company, title: spec.title, location: spec.location }),
      };
      const [stored] = jobsRepo.insertMany(run.id, [job]);
      if (!stored) throw new Error(`Job ${spec.key} was not inserted`);
      const lastSeen = spec.seenAgainIn ? runs[spec.seenAgainIn]! : run;
      touch('jobs', stored.id, {
        created_at: run.finishedAt,
        last_seen_at: lastSeen.finishedAt,
        last_seen_run_id: lastSeen.id,
        ...(spec.seenAgainIn && spec.status !== 'unverified' ? { verified_at: lastSeen.finishedAt } : {}),
      });
      if (spec.dismissed) touch('jobs', stored.id, { dismissed_at: ago(30) });
      jobs[spec.key] = { id: stored.id, url: original, company: spec.company, title: spec.title };
    });

    const apps: Record<string, { id: string; company: string; role: string; domain: string }> = {};
    for (const spec of APPS) {
      const job = spec.job ? jobs[spec.job] : undefined;
      const company = job?.company ?? spec.company!;
      const role = job?.title ?? spec.role!;
      const created = ago(spec.daysAgo);
      const app = applicationsRepo.create({
        profile_id: profiles[spec.profile].id,
        job_id: job?.id ?? null,
        company,
        role,
        url: job?.url ?? spec.url ?? null,
        status: spec.start,
        applied_at: spec.start === 'saved' ? null : created,
        notes: spec.notes,
        sender_domains: spec.domains,
      });
      touch('applications', app.id, { created_at: created, status_changed_at: created });
      for (const step of spec.steps ?? []) {
        applicationsRepo.setStatus(app.id, step.to, 'user');
        const at = ago(step.daysAgo);
        touch('status_history', latestHistoryId(app.id), { changed_at: at, created_at: at });
        touch('applications', app.id, { status_changed_at: at });
      }
      apps[spec.key] = { id: app.id, company, role, domain: spec.domains[0]! };
    }

    PROPOSALS.forEach((spec, i) => {
      const app = apps[spec.app]!;
      const evidence: ProposalEvidence = {
        message_id: `msg-${String(i + 1).padStart(3, '0')}`,
        date: ago(spec.daysAgo, -3 * 3_600_000).slice(0, 10),
        from: `recruiting@${app.domain}`,
        subject: spec.subject,
        snippet: spec.snippet,
      };
      const [proposal] = proposalsRepo.createMany(runs[spec.run]!.id, [
        { application_id: app.id, proposed_status: spec.to, confidence: spec.confidence, reason: spec.reason, evidence },
      ]);
      // The app creates proposals while the run saves its results, at the end of the run.
      touch('proposals', proposal!.id, { created_at: runs[spec.run]!.finishedAt });
      if (!spec.decided) return;
      const at = ago(spec.decided.daysAgo);
      if (spec.decided.state === 'accepted') {
        proposalService.accept(proposal!.id);
        touch('status_history', latestHistoryId(app.id), { changed_at: at, created_at: at });
        touch('applications', app.id, { status_changed_at: at });
      } else {
        proposalService.reject(proposal!.id);
      }
      touch('proposals', proposal!.id, { decided_at: at });
    });

    return {
      profiles: [profiles.rich, profiles.sparse, profiles.empty, profiles.miss, profiles.rounds].map(({ name, slug }) => ({
        name,
        slug,
      })),
    };
  });

  const summary = seed();
  // Log files are written after the rows commit; a failed seed leaves no stray logs behind.
  const runsDir = join(opts.dataDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const rows = db.prepare('SELECT * FROM runs').all() as RunRow[];
  for (const run of rows) writeFileSync(join(runsDir, `${run.id}.log`), `${runLog(run).join('\n')}\n`);
  return summary;
}

// Plain app lines plus Claude Code stream-json events, as a real run with the claude preset logs them.
interface RunRow {
  id: string;
  kind: RunKind;
  status: RunStatus;
  effort_mode: EffortMode;
  summary: string | null;
  error: string | null;
  usage_cost_usd: number | null;
  started_at: string;
  finished_at: string;
}

// The failed worker of a Max run whose summary has the "1 of 5 workers failed" note.
const FAILED_WORKER = 4;

function runLog(run: RunRow): string[] {
  const ev = (e: unknown): string => JSON.stringify(e);
  const tool = (name: string, input: Record<string, string>): string =>
    ev({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_mock', name, input }] } });
  const lines = [`Run ${run.id} (${run.kind}) started`, 'Using adapter claude', 'Model: sonnet, effort: agent default'];
  const durationMs = Date.parse(run.finished_at) - Date.parse(run.started_at);
  // Each agent process ends with its own result event, as Claude Code writes it.
  const result = (prefix: string, costUsd: number): string =>
    `${prefix}${ev({ type: 'result', subtype: 'success', is_error: false, duration_ms: durationMs, total_cost_usd: costUsd })}`;
  const agent = (prefix: string, kind: RunKind): string[] => {
    const body =
      kind === 'discover_jobs'
        ? [
            tool('WebSearch', { query: 'senior frontend engineer react berlin' }),
            tool('WebFetch', { url: 'https://example.com/?mock-job=seed-1' }),
            ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'Found several matching postings.' }] } }),
          ]
        : [
            tool('mcp__claude_ai_Gmail__search_threads', { query: 'from:(example.com) newer_than:30d' }),
            tool('mcp__claude_ai_Gmail__get_thread', { threadId: 'thread-001' }),
          ];
    return [ev({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' }), ...body].map((l) => `${prefix}${l}`);
  };

  const succeeded = run.status === 'succeeded';
  const cost = run.usage_cost_usd ?? 0;
  if (run.effort_mode === 'max') {
    lines.push(`Max effort: ${MAX_EFFORT_SOURCES.length} workers, up to ${MAX_EFFORT_CONCURRENCY} at a time`);
    const failedWorker = hasFailedWorkers(run.summary) ? FAILED_WORKER : null;
    const share = cost / (MAX_EFFORT_SOURCES.length - (failedWorker ? 1 : 0));
    MAX_EFFORT_SOURCES.forEach((name, i) => {
      const n = i + 1;
      lines.push(`Worker ${n} (${name}) started`, ...agent(`[worker ${n}] `, run.kind));
      if (succeeded && n !== failedWorker) lines.push(result(`[worker ${n}] `, share));
    });
    if (failedWorker) {
      const failed = MAX_EFFORT_SOURCES[failedWorker - 1];
      lines.push(`Worker ${failedWorker} (${failed}) failed: Agent run failed: Exited with code 1`);
    }
  } else {
    lines.push(...agent('', run.kind));
    if (succeeded) lines.push(result('', cost));
  }

  if (succeeded) {
    lines.push(
      RUN_SAVING_LOG_LINE,
      run.summary ?? '',
      `Run ${run.id} succeeded: ${run.summary ?? ''}`,
    );
  } else {
    lines.push(`Run ${run.id} ${run.status}: ${run.error ?? ''}`);
  }
  return lines;
}
