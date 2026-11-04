import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// One clock for every run: tests read the same on a laptop in Toronto at 8 PM and on CI.
// Tests that are about a zone set process.env.TZ themselves.
process.env.TZ = 'UTC'

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
    // Windows runners are several times slower at file and SQLite work (antivirus scans every
    // new temp file), so tests that take 1-2 s elsewhere can pass the 5 s default there.
    // On CI the three systems share busy runners, and a different slow test timed out on each
    // run (a 5 s or 30 s limit on a test that takes 2 s on a laptop). A real hang still fails,
    // just later.
    ...(process.env.CI
      ? process.platform === 'win32'
        ? { testTimeout: 90_000, hookTimeout: 90_000 }
        : { testTimeout: 30_000, hookTimeout: 30_000 }
      : process.platform === 'win32'
        ? { testTimeout: 30_000, hookTimeout: 30_000 }
        : {}),
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
    // The report inlines the chart kit's stylesheet (`charts.css?raw`); keep its text in tests.
    css: { include: [/src\/shared\/charts\/charts\.css/] },
    // Drawers are on the URL: close them between tests (Docs/DRAWER.md).
    // A Claude Code limit pauses Claude for the process: lift it between tests.
    setupFiles: [
      'src/renderer/src/shell/drawers.test-helper.ts',
      'src/main/providers/claude/pause.test-helper.ts'
    ],
    coverage: {
      // Not production code. `npm run typecheck` still includes these files
      // through tsconfig.node.json (`src/main/**/*`). ESLint lints them too.
      exclude: ['**/*.test-helper.ts']
    },
    server: {
      deps: {
        external: ['better-sqlite3', '@napi-rs/keyring']
      }
    }
  }
})
