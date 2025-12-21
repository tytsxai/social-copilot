import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let hasZod = true;
try {
  require.resolve('zod');
} catch {
  hasZod = false;
}

export default defineConfig({
  resolve: {
    alias: hasZod
      ? {}
      : {
          zod: fileURLToPath(new URL('./src/vendor/zod-shim.ts', import.meta.url)),
        },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
});
