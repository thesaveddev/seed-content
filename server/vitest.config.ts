import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run suites sequentially — they share one database
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**'],
      exclude: [
        'src/test/**',
        'src/**/*.test.ts',
        // Runtime shell: DB/listen side effects, covered by live smoke tests
        'src/index.ts',
        // One-off CLI scripts (bootstrap admin)
        'src/scripts/**',
        // Legacy standalone schema — live model is defined in models/index.ts
        'src/models/Notification.ts',
      ],
      thresholds: {
        statements: 61,
        branches: 65,
        functions: 64,
        lines: 61,
      },
    },
  },
});
