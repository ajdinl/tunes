import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{js,ts}', 'tests/api/**/*.test.{js,ts}'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    // API tests each start their own server on their own port; files can run in parallel.
    fileParallelism: true,
  },
});
