// Stand-in for an agent CLI in adapter tests. Behaviour is selected by FAKE_AGENT_MODE.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const mode = process.env.FAKE_AGENT_MODE ?? 'ok';
const output = process.env.FAKE_AGENT_OUTPUT ?? '{}';

// Sign-in status probes (`auth status` claude style, `login status` codex style) are keyed by argv and
// FAKE_AGENT_AUTH (ok | fail | hang) so they stay independent of FAKE_AGENT_MODE.
const args = process.argv.slice(2);
if (args.includes('status') && (args.includes('auth') || args.includes('login'))) {
  const auth = process.env.FAKE_AGENT_AUTH ?? 'ok';
  if (auth === 'ok') {
    process.stdout.write('Logged in\n');
    process.exit(0);
  }
  if (auth === 'fail') {
    process.stderr.write('Not logged in\n');
    process.exit(1);
  }
  setTimeout(() => {}, 60_000);
  await new Promise(() => {});
}

// Model catalog probe (`debug models`, codex style); FAKE_AGENT_MODELS is printed as is, or the probe
// fails when it is 'fail'.
if (args.includes('debug') && args.includes('models')) {
  const models = process.env.FAKE_AGENT_MODELS ?? '{"models":[]}';
  if (models === 'fail') {
    process.stderr.write('no catalog\n');
    process.exit(5);
  }
  process.stdout.write(models + '\n');
  process.exit(0);
}

// Written first so tests can find the pid even when startup is slow; lets them confirm the process is gone.
if (mode === 'hang') writeFileSync('fake-agent.pid', String(process.pid));
// Stands in for an agent that starts its own helper processes: the pid file lists the agent, then the helper.
if (mode === 'hang-tree') {
  const helper = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' });
  writeFileSync('fake-agent.pid', `${process.pid}\n${helper.pid}\n`);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

switch (mode) {
  case 'ok':
    process.stdout.write('```json\n' + output + '\n```\n');
    break;
  case 'prose':
    process.stdout.write('Here you go:\n' + output + '\n');
    break;
  case 'claude':
  case 'claude-fail': {
    // Read the prompt to the end so a stdin that is never closed makes the test hang.
    await readStdin();
    const init = { type: 'system', subtype: 'init' };
    if (process.env.FAKE_AGENT_MODEL) init.model = process.env.FAKE_AGENT_MODEL;
    if (mode === 'claude-fail') {
      process.stdout.write(JSON.stringify(init) + '\n');
      process.exit(2);
    }
    const lines = [
      init,
      { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
      { type: 'result', subtype: 'success', structured_output: JSON.parse(output) },
    ];
    for (const line of lines) process.stdout.write(JSON.stringify(line) + '\n');
    break;
  }
  case 'codex': {
    const i = process.argv.indexOf('-o');
    if (i === -1 || !process.argv[i + 1]) {
      process.stderr.write('missing -o\n');
      process.exit(3);
    }
    writeFileSync(process.argv[i + 1], output);
    process.stdout.write('{"type":"turn.completed"}\n');
    break;
  }
  case 'fail':
    process.stderr.write('boom\n');
    process.exit(2);
    break;
  case 'echo-argv':
    process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
    break;
  case 'hang':
  case 'hang-tree':
    setTimeout(() => {}, 60_000);
    break;
  default:
    process.stderr.write(`unknown mode: ${mode}\n`);
    process.exit(4);
}
