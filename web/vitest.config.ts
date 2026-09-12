import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Tests set VITE_API_BASE_URL to point at a mocked fetch; never hit a real backend
    env: { VITE_API_BASE_URL: 'http://mock.local' },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Run files sequentially — zustand store state is module-global
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        // App bootstrap — exercised by e2e/browser, not unit tests
        'src/main.tsx',
      ],
      // Ratchet thresholds: floor is set just under current coverage.
      // It may only go up — add tests with every new feature.
      thresholds: {
        statements: 5,
        branches: 30,
        functions: 15,
        lines: 5,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
