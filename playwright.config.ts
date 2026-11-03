import { defineConfig } from '@playwright/test'
import { startOwnDisplay } from './tests/e2e/own-display'

// Docker runs: each worker gets its own Xvfb (pointer, focus and clipboard stay its own).
startOwnDisplay()

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: true,
  // GitHub's shared Mac and Windows runners are slow and uneven: one retry there, and the
  // report still lists any test that needed it as flaky. Local and Docker runs never retry.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results'
})
