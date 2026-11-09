#!/usr/bin/env node
// Stand-in agent for the mock sandbox (SOW-0028): never searches the web or reads mail.
// Usage: node mock-agent.mjs [--delay-ms <n>] <prompt-file>
// The app runs it as a custom agent; it picks the task from the prompt's "# Task:" heading and
// prints canned JSON. Progress lines contain no braces, so the last JSON object is the result.
// The app's health check runs "node --version" (the command's first word), not this script.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
let delayMs = 3000;
const delayAt = args.indexOf('--delay-ms');
if (delayAt !== -1) {
  delayMs = Number(args[delayAt + 1]);
  args.splice(delayAt, 2);
}
const promptFile = args[0];
if (!promptFile || !Number.isFinite(delayMs) || delayMs < 0) {
  process.stderr.write('Usage: mock-agent.mjs [--delay-ms <n>] <prompt-file>\n');
  process.exit(2);
}

const prompt = readFileSync(promptFile, 'utf8');
const say = (line) => process.stdout.write(`${line}\n`);
// Spread over the delay so the Run page shows progress and the cancel control can be tried.
async function work(steps) {
  for (const step of steps) {
    say(`mock agent: ${step}`);
    await new Promise((r) => setTimeout(r, delayMs / steps.length));
  }
}

const COMPANIES = [
  ['Acme Robotics', 'Senior Frontend Engineer', 'Berlin, Germany', 'hybrid'],
  ['Globex Analytics', 'Staff UI Engineer', 'Remote (EU)', 'remote'],
  ['Initech Cloud', 'Frontend Platform Engineer', 'Amsterdam, Netherlands', 'onsite'],
  ['Umbrella Health', 'Senior React Developer', 'Remote', 'remote'],
  ['Hooli Maps', 'Design Systems Engineer', 'Lisbon, Portugal', 'hybrid'],
  ['Vandelay Logistics', 'Senior Web Engineer', 'Remote (Europe)', 'remote'],
];

function discover() {
  const nonce = randomUUID().slice(0, 8);
  // Rotate so repeated runs and Max workers do not all return the same companies first.
  const start = Number.parseInt(nonce, 16) % COMPANIES.length;
  const picked = [0, 1, 2, 3].map((i) => COMPANIES[(start + i) % COMPANIES.length]);
  const jobs = picked.map(([company, title, location, remote], i) => ({
    company,
    title,
    location,
    remote,
    // example.com answers 200 at its root, so the app's link check marks these live when online.
    url: `https://example.com/?mock-job=${nonce}-${i + 1}`,
    source_site: 'example.com',
    posted_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString().slice(0, 10),
    salary: i % 2 === 0 ? 'EUR 85,000 - 100,000' : null,
    description_excerpt: `Mock posting: ${title} at ${company}, building web interfaces with React and TypeScript.`,
    match_reason: 'Mock result: the title and stack match the profile.',
    checks: { location: i === 2 ? 'fail' : 'pass', remote: i === 3 ? 'unknown' : 'pass', seniority: 'pass' },
  }));
  // Any other example.com path answers 404, so this one shows up as a dead link.
  jobs.push({
    company: 'Closed Corp',
    title: 'Frontend Engineer',
    location: 'Remote',
    remote: 'remote',
    url: `https://example.com/mock-closed/${nonce}`,
    source_site: 'example.com',
    posted_at: null,
    salary: null,
    description_excerpt: 'Mock posting that is already closed.',
    match_reason: 'Mock result: shows how dead links are counted.',
    checks: { location: 'pass', remote: 'pass', seniority: 'unknown' },
  });
  return { jobs, notes: 'Mock agent: canned results, no web search was made.' };
}

function syncMail() {
  // Lines rendered by src/server/mail/agent-source.ts: "- id: <id> | company: <c> | role: <r> | ...".
  const apps = [...prompt.matchAll(/^- id: (\S+) \| company: (.*?) \| role: (.*?) \|/gm)].map((m) => ({
    id: m[1],
    company: m[2],
    role: m[3],
  }));
  const plan = [
    ['interview', 0.92, 'invites you to a technical interview'],
    ['rejected', 0.71, 'says they will not move forward'],
  ];
  const today = new Date().toISOString().slice(0, 10);
  const findings = apps.map((app, i) => {
    const [status, confidence, what] = plan[i] ?? ['no_change', 0.5, 'has no update'];
    return {
      application_id: app.id,
      proposed_status: status,
      confidence,
      reason: `Mock result: a reply from ${app.company} ${what}.`,
      evidence: {
        // New ids every run, so they are never in the reviewed list.
        message_id: `mock-msg-${randomUUID().slice(0, 12)}`,
        date: today,
        from: `recruiting@${app.company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example.com`,
        subject: `Your application for ${app.role}`,
        snippet: `Mock email: ${app.company} ${what}.`,
      },
    };
  });
  return { mail_access: true, findings, notes: 'Mock agent: no mailbox was read.' };
}

function analyseCv() {
  return {
    name: 'Mock CV Profile',
    target_roles: ['Senior Frontend Engineer', 'UI Platform Engineer'],
    locations: ['Berlin, Germany'],
    remote: 'hybrid',
    seniority: ['Senior'],
    keywords: ['React', 'TypeScript', 'Design systems', 'Accessibility', 'Testing'],
    notes: 'Mock draft: the CV was not read. Eight years of frontend work on design systems and web apps.',
  };
}

const task = /^# Task: (.+)$/m.exec(prompt)?.[1] ?? '';
let result;
if (task.startsWith('discover job openings')) {
  await work(['searching mock job boards', 'opening postings', 'checking the profile must-haves']);
  result = discover();
} else if (task.startsWith('check email')) {
  await work(['searching the mock mailbox', 'reading replies']);
  result = syncMail();
} else if (task.startsWith('draft a job-search profile')) {
  await work(['reading the CV text']);
  result = analyseCv();
} else {
  process.stderr.write(`mock agent: unknown task "${task}"\n`);
  process.exit(3);
}
// One line: the Run page turns a single-line result into "Agent returned N jobs".
process.stdout.write(`${JSON.stringify(result)}\n`);
