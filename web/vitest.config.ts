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
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
