import { readFileSync } from 'node:fs';

declare const __APP_VERSION__: string | undefined;

// tsup injects the version at build time; under tsx/vitest it is undefined,
// so fall back to reading package.json from the source tree.
function resolveVersion(): string {
  if (typeof __APP_VERSION__ !== 'undefined') return __APP_VERSION__;
  const pkgUrl = new URL('../../package.json', import.meta.url);
  return (JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string }).version;
}

export const APP_VERSION: string = resolveVersion();
