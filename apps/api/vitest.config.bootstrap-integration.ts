import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  envDir: false,
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/bootstrap-platform-admin.integration.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
