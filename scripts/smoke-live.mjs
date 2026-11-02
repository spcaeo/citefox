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
  const loaded = await server.ssrLoadModule(resolve(repoRoot, 'src/main/smoke/cli.ts'))
  const code = await loaded.runSmokeCli(process.argv.slice(2))
  process.exitCode = typeof code === 'number' ? code : 1
} finally {
  await server.close()
}
