import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    forceExit: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      thresholds: { lines: 99 },
    },
    reporters: ['verbose', 'junit'],
    outputFile: { junit: 'coverage/test-reporter.xml' },
  },
})
