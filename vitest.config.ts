import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['pipeline/**/*.test.ts', 'lib/**/*.test.ts'] },
});
