#!/usr/bin/env node
import { parseArgs } from 'node:util';

const USAGE = `Usage: jobtrack [options]

Options:
  --port <n>         Port to listen on (falls back to the next free port)
  --data-dir <path>  Directory for the database and run logs
  --no-open          Do not open the browser
  --help             Show this help
  --version          Show the version
`;

let values;
try {
  ({ values } = parseArgs({
    allowPositionals: false,
    options: {
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      'no-open': { type: 'boolean' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
    },
  }));
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n\n${USAGE}`);
  process.exit(2);
}

if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

let port;
if (values.port !== undefined) {
  if (!/^\d+$/.test(values.port) || Number(values.port) > 65535) {
    process.stderr.write(`Error: invalid --port "${values.port}"\n\n${USAGE}`);
    process.exit(2);
  }
  port = Number(values.port);
}

let server;
try {
  server = await import('../dist/server/index.js');
} catch (err) {
  // Only a missing build is reported as such; real load errors must surface.
  if (err?.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes('dist/server/index.js')) {
    process.stderr.write('Build output not found. Run "npm run build" first.\n');
  } else {
    process.stderr.write(`Error: ${err?.message ?? err}\n`);
  }
  process.exit(1);
}

if (values.version) {
  process.stdout.write(`${server.APP_VERSION}\n`);
  process.exit(0);
}

let app;
try {
  app = await server.startApp({ port, dataDir: values['data-dir'] });
} catch (err) {
  process.stderr.write(`Error: ${err?.message ?? err}\n`);
  process.exit(1);
}

process.stdout.write(`Job Applications Tracker running at ${app.url}\n`);
process.stdout.write(`Data directory: ${app.dataDir}\n`);

if (!values['no-open'] && !process.env.CI) {
  try {
    const { default: open } = await import('open');
    await open(app.url);
  } catch (err) {
    process.stderr.write(`Warning: could not open the browser (${err?.message ?? err})\n`);
  }
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write('Shutting down...\n');
  try {
    await app.close();
  } catch (err) {
    process.stderr.write(`Error: ${err?.message ?? err}\n`);
    process.exit(1);
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
