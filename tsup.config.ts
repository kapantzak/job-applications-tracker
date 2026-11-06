import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/server/index.ts'],
  format: ['esm'],
  outDir: 'dist/server',
  external: ['better-sqlite3'],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
