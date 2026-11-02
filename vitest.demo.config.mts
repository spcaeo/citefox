import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * The browser demo and sample reports (Docs/DEMO.md), run by npm scripts, not by
 * `npm test`:
 * - tests/demo/samples.e2e.ts  `npm run samples:build` (Node only)
 * - tests/demo/record.e2e.ts   `npm run demo:record` (inside Docker only)
 * - tests/demo/check.e2e.ts    `npm run demo:check` (inside Docker only)
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
    include: ['tests/demo/**/*.e2e.ts'],
    fileParallelism: false,
    css: { include: [/src\/shared\/charts\/charts\.css/] },
    server: {
      deps: {
        external: ['better-sqlite3', '@napi-rs/keyring']
      }
    }
  }
})
