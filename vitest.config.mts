import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

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
