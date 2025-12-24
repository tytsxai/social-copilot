import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['src/ui/**/*.{test,spec}.ts', 'jsdom'],
    ],
    setupFiles: [],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
  },
  define: {
    __SC_RELEASE__: 'false',
  },
  resolve: {
    alias: {
      '@social-copilot/core': resolve(__dirname, '../core/src'),
    },
  },
});
