#!/usr/bin/env node
// Stand-in agent for the mock sandbox (SOW-0028): never searches the web or reads mail.
// Usage: node mock-agent.mjs [--delay-ms <n>] [--demo] <prompt-file>
// --demo (SOW-0048) prints realistic invented text instead of "Mock …", for the demo video.
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
const demoAt = args.indexOf('--demo');
const demo = demoAt !== -1;
if (demo) args.splice(demoAt, 1);
const promptFile = args[0];
if (!promptFile || !Number.isFinite(delayMs) || delayMs < 0) {
  process.stderr.write('Usage: mock-agent.mjs [--delay-ms <n>] [--demo] <prompt-file>\n');
  process.exit(2);
}

const prompt = readFileSync(promptFile, 'utf8');
const say = (line) => process.stdout.write(`${line}\n`);
// Spread over the delay so the Run page shows progress and the cancel control can be tried.
async function work(steps, demoSteps) {
  for (const step of demo ? demoSteps : steps) {
    say(demo ? step : `mock agent: ${step}`);
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
    description_excerpt: demo
      ? `${company} is hiring a ${title} to build web interfaces with React and TypeScript.`
      : `Mock posting: ${title} at ${company}, building web interfaces with React and TypeScript.`,
    match_reason: demo ? 'The title and the React and TypeScript stack match the profile.' : 'Mock result: the title and stack match the profile.',
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
    description_excerpt: demo ? 'A frontend role whose posting has closed.' : 'Mock posting that is already closed.',
    match_reason: demo ? 'The title matches the profile.' : 'Mock result: shows how dead links are counted.',
    checks: { location: 'pass', remote: 'pass', seniority: 'unknown' },
  });
  // A real agent sometimes returns a listed known link anyway; repeating the newest one lets a sandbox
  // search find a known job again (SOW-0041). The app keeps the stored job's own fields.
  const knownSection = /^## Known urls\n([\s\S]*?)^## /m.exec(prompt)?.[1] ?? '';
  const known = /^(https?:\/\/\S+)$/m.exec(knownSection)?.[1];
  if (known) {
    jobs.push({
      company: 'Known Posting',
      title: 'Engineer',
      location: 'Remote',
      remote: 'remote',
      url: known,
      source_site: 'example.com',
      posted_at: null,
      salary: null,
      description_excerpt: demo ? 'A posting an earlier search also found.' : 'Mock posting found again by a later search.',
      match_reason: demo ? 'A link the profile already has.' : 'Mock result: a link the profile already has.',
      checks: { location: 'unknown', remote: 'unknown', seniority: 'unknown' },
    });
  }
  const notes = demo
    ? 'Searched Greenhouse, Lever and company career pages; four openings match the profile.'
    : 'Mock agent: canned results, no web search was made.';
  return { jobs, notes };
}

function replySnippet(status, app, what) {
  if (!demo) return `Mock email: ${app.company} ${what}.`;
  if (status === 'interview') return `Hi Sam, thank you for applying for the ${app.role} role. We would like to invite you to a technical interview next week.`;
  if (status === 'rejected') return `Hi Sam, thank you for your interest in the ${app.role} role. We have decided to move forward with other candidates.`;
  return `Hi Sam, thank you for your application for the ${app.role} role.`;
}

function syncMail() {
  // Lines rendered by src/server/mail/agent-source.ts: "- id: <id> | company: <c> | role: <r> | ...".
  const apps = [...prompt.matchAll(/^- id: (\S+) \| company: (.*?) \| role: (.*?) \|/gm)].map((m) => ({
    id: m[1],
    company: m[2],
    role: m[3],
  }));
  // Rendered by src/server/mail/agent-source.ts. A profile without a Gmail scope asks for a null count;
  // a scope containing "nomatch" (the seeded Scope Miss profile) matches no mail, so nothing changes.
  const scopeSection = /^## Mailbox scope\n([\s\S]*?)^## /m.exec(prompt)?.[1] ?? '';
  const scoped = !scopeSection.includes('No scope is set.');
  const missed = scoped && /nomatch/i.test(scopeSection);
  const today = new Date().toISOString().slice(0, 10);
  // Real mail carries a time; a bare day would show as midnight UTC in local time.
  const sent = (minutesAgo) => (demo ? new Date(Date.now() - minutesAgo * 60_000).toISOString() : today);
  const findings = apps.map((app, i) => {
    const [status, confidence, what] = (!missed && REPLY_PLAN[i]) || ['no_change', 0.5, 'has no update'];
    return {
      application_id: app.id,
      proposed_status: status,
      confidence,
      reason: demo ? `A reply from ${app.company} ${what}.` : `Mock result: a reply from ${app.company} ${what}.`,
      evidence: {
        // New ids every run, so they are never in the reviewed list.
        message_id: `mock-msg-${randomUUID().slice(0, 12)}`,
        date: sent(40 + i * 15),
        from: `recruiting@${app.company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example.com`,
        subject: `Your application for ${app.role}`,
        snippet: replySnippet(status, app, what),
      },
    };
  });
  // Applications the mail shows but the prompt does not list (SOW-0045); none when the scope matches nothing.
  // Open applications and the "Already tracked" lines ("- company: <c> | role: <r>") are never reported again.
  const trackedSection = /^## Already tracked\n([\s\S]*?)^## /m.exec(prompt)?.[1] ?? '';
  const tracked = [...trackedSection.matchAll(/^- company: (.*?) \| role: /gm)].map((m) => m[1]);
  const listed = new Set([...apps.map((a) => a.company), ...tracked].map((c) => c.toLowerCase()));
  const newApplications = missed
    ? []
    : FRESH
        .filter(([company]) => !listed.has(company.toLowerCase()))
        .map(([company, role, status, what, demoSnippet], i) => ({
          company,
          role,
          status,
          applied_at: today,
          sender_domain: '',
          confidence: 0.8,
          reason: demo ? `An email from ${company} ${what}.` : `Mock result: an email from ${company} ${what}.`,
          evidence: {
            message_id: `mock-msg-${randomUUID().slice(0, 12)}`,
            date: sent(95 + i * 30),
            from: 'no-reply@ats.example.com',
            subject: `${company}: ${role}`,
            snippet: demo ? demoSnippet : `Mock email: ${company} ${what}.`,
          },
        }));
  return {
    mail_access: true,
    findings,
    new_applications: newApplications,
    notes: demo ? 'Searched mail from the companies you applied to and from job-board senders.' : 'Mock agent: no mailbox was read.',
    // One email per reply and per new application; at least one, so a scope that matches mail never reads
    // as a miss just because the profile has nothing open (the seeded Backend Engineering).
    scope_message_count: scoped ? (missed ? 0 : Math.max(1, findings.length + newApplications.length)) : null,
  };
}

// A scoped sync (SOW-0051) lists the scope's threads, then reads them in batches. Thread and message ids are
// stable, so a second sync finds every thread unchanged and reads nothing, like a real mailbox with no new mail.
const REPLY_PLAN = [
  ['interview', 0.92, 'invites you to a technical interview'],
  ['rejected', 0.71, 'says they will not move forward'],
];
const FRESH = [
  ['Contoso Pharma', 'Frontend Engineer', 'applied', 'confirms that your application was received',
    'Thank you for applying to Contoso Pharma. We have received your application for Frontend Engineer.'],
  ['Fabrikam Games', 'UI Developer', 'screening', 'asks for a short intro call',
    'Hi Sam, thanks for applying for UI Developer. Do you have 20 minutes for a short intro call this week?'],
];
const SCOPED_THREADS = ['mock-thread-reply-1', 'mock-thread-reply-2', 'mock-thread-new-1', 'mock-thread-new-2', 'mock-thread-alert-1'];

function listThreads() {
  // Rendered by src/server/mail/agent-source.ts: the query on its own line under "## Search query".
  const query = /^## Search query\n\n(.*)$/m.exec(prompt)?.[1] ?? '';
  // A scope containing "nomatch" (the seeded Scope Miss profile) matches no mail.
  const threads = /nomatch/i.test(query) ? [] : SCOPED_THREADS;
  return {
    mail_access: true,
    windows: [{ after: '', before: '', thread_count: threads.length }],
    threads: threads.map((id) => ({ thread_id: id, last_message_id: id.replace('mock-thread-', 'mock-msg-') })),
    notes: demo ? 'Listed the threads in the label.' : 'Mock agent: no mailbox was searched.',
  };
}

function readThreads() {
  const section = (name) => new RegExp(`^## ${name}\\n\\n([\\s\\S]*?)\\n\\n## `, 'm').exec(prompt)?.[1] ?? '';
  const ids = [...section('Threads').matchAll(/^- (\S+)$/gm)].map((m) => m[1]);
  // Lines rendered by src/server/mail/agent-source.ts: "- id: <id> | company: <c> | role: <r> | ...".
  const apps = [...section('Open applications').matchAll(/^- id: (\S+) \| company: (.*?) \| role: (.*?) \|/gm)].map((m) => ({
    id: m[1],
    company: m[2],
    role: m[3],
  }));
  const today = new Date().toISOString().slice(0, 10);
  const threads = [];
  const notApplications = [];
  for (const id of ids) {
    const reply = /^mock-thread-reply-(\d+)$/.exec(id);
    const fresh = /^mock-thread-new-(\d+)$/.exec(id);
    const n = Number((reply ?? fresh)?.[1]) - 1;
    const app = reply ? apps[n] : undefined;
    if (reply && app) {
      const [status, confidence, what] = REPLY_PLAN[n] ?? ['applied', 0.5, 'has no update'];
      threads.push({
        thread_id: id, application_id: app.id, company: app.company, role: app.role, status, first_date: today,
        sender_domain: '', confidence,
        reason: demo ? `A reply from ${app.company} ${what}.` : `Mock result: a reply from ${app.company} ${what}.`,
        evidence: {
          message_id: id.replace('mock-thread-', 'mock-msg-'), date: today,
          from: `recruiting@${app.company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example.com`,
          subject: `Your application for ${app.role}`, snippet: replySnippet(status, app, what),
        },
      });
    } else if (fresh && FRESH[n]) {
      const [company, role, status, what, demoSnippet] = FRESH[n];
      threads.push({
        thread_id: id, application_id: '', company, role, status, first_date: today, sender_domain: '', confidence: 0.8,
        reason: demo ? `An email from ${company} ${what}.` : `Mock result: an email from ${company} ${what}.`,
        evidence: {
          message_id: id.replace('mock-thread-', 'mock-msg-'), date: today, from: 'no-reply@ats.example.com',
          subject: `${company}: ${role}`, snippet: demo ? demoSnippet : `Mock email: ${company} ${what}.`,
        },
      });
    } else {
      // A reply with no open application to match, a job alert, or an id this mock does not know.
      notApplications.push(id);
    }
  }
  return { mail_access: true, threads, not_applications: notApplications, notes: demo ? 'Read the threads.' : 'Mock agent: no mail was read.' };
}

function analyseCv() {
  if (demo) {
    return {
      name: 'Frontend Roles',
      target_roles: ['Senior Frontend Engineer', 'UI Platform Engineer'],
      locations: ['Berlin, Germany'],
      remote: 'hybrid',
      seniority: ['Senior'],
      keywords: ['React', 'TypeScript', 'Design systems', 'Accessibility', 'Testing'],
      notes:
        'Frontend engineer with eight years of experience building design systems and data-heavy web apps with React and TypeScript. Cares about accessibility and testing.',
    };
  }
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
  await work(
    ['searching mock job boards', 'opening postings', 'checking the profile must-haves'],
    [
      'Searching Greenhouse and Lever boards for Senior Frontend Engineer roles',
      'Opening postings on company career pages',
      'Checking location, remote work and seniority against the profile',
    ],
  );
  result = discover();
} else if (task.startsWith('check email')) {
  await work(
    ['searching the mock mailbox', 'reading replies'],
    ['Searching your mail for replies from the companies you applied to', 'Reading the replies'],
  );
  result = syncMail();
} else if (task.startsWith('list Gmail threads')) {
  await work(['listing the mock mailbox'], ['Listing the threads in your label']);
  result = listThreads();
} else if (task.startsWith('read Gmail threads')) {
  await work(['reading mock threads'], ['Reading the threads']);
  result = readThreads();
} else if (task.startsWith('draft a job-search profile')) {
  await work(['reading the CV text'], ['Reading the CV']);
  result = analyseCv();
} else {
  process.stderr.write(`mock agent: unknown task "${task}"\n`);
  process.exit(3);
}
// One line: the Run page turns a single-line result into "Agent returned N jobs".
process.stdout.write(`${JSON.stringify(result)}\n`);
