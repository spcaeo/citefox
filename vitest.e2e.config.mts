import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Files `npm run test:e2e` runs before Playwright.
 * The headless check-due suite lives here because the check engine imports
 * Vite `?raw` templates, which the Playwright loader cannot resolve.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  ssr: {
    external: ['better-sqlite3', '@napi-rs/keyring']
  },
  test: {
    environment: 'node',
    include: ['src/main/export/pdf-bundle.test.ts', 'tests/e2e/headless-check-due.e2e.ts'],
    server: {
      deps: {
        external: ['better-sqlite3', '@napi-rs/keyring']
      }
    }
  }
})
