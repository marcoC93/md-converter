import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // I test creano directory temporanee proprie: eseguirli in parallelo è sicuro.
    pool: 'forks',
  },
});
