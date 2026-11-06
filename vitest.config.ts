import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['test/server/**/*.test.ts', 'test/e2e/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: { '@': fileURLToPath(new URL('./src/ui', import.meta.url)) } },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['test/ui/**/*.test.{ts,tsx}'],
          setupFiles: ['test/ui/setup.ts'],
        },
      },
    ],
  },
});
