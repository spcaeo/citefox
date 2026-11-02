import { defineConfig } from '@playwright/test'

/**
 * Marketing media (README and download site screenshots, demo video). Not part of
 * the e2e suite: run it with `npm run media:record` (scripts/media/record-demo.mjs),
 * which runs this inside Docker so no window opens on your screen.
 */
export default defineConfig({
  testDir: '.',
  timeout: 600_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: '../../test-results/media'
})
