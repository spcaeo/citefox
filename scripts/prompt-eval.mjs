// Dev-only prompt test bench: runs the real setup section prompts on websites without the
// app window (src/main/eval/). Not part of the app, CI or npm test.
//   mise exec node@24.19.0 -- node scripts/prompt-eval.mjs --sites a.com,b.com --out <dir> --label baseline
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const server = await createServer({
  configFile: false,
  root: repoRoot,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: {
    alias: {
      '@shared': resolve(repoRoot, 'src/shared')
    }
  },
  ssr: {
    external: ['better-sqlite3', '@napi-rs/keyring']
  }
})

try {
  const loaded = await server.ssrLoadModule(resolve(repoRoot, 'src/main/eval/cli.ts'))
  const code = await loaded.runPromptEvalCli(process.argv.slice(2))
  process.exitCode = typeof code === 'number' ? code : 1
} finally {
  await server.close()
}
