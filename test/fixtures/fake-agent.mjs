// Stand-in for an agent CLI in adapter tests. Behaviour is selected by FAKE_AGENT_MODE.
import { writeFileSync } from 'node:fs';

const mode = process.env.FAKE_AGENT_MODE ?? 'ok';
const output = process.env.FAKE_AGENT_OUTPUT ?? '{}';

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
  case 'claude': {
    // Read the prompt to the end so a stdin that is never closed makes the test hang.
    await readStdin();
    const lines = [
      { type: 'system', subtype: 'init' },
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
  case 'hang':
    // The pid file lets tests confirm the process is gone after a timeout.
    writeFileSync('fake-agent.pid', String(process.pid));
    setTimeout(() => {}, 60_000);
    break;
  default:
    process.stderr.write(`unknown mode: ${mode}\n`);
    process.exit(4);
}
