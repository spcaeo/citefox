import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const cli = require.resolve('@playwright/test/cli')
const extra = process.argv.slice(2)

// Several specs set localStorage `citefox.client=mock`. A release build ignores
// that flag, so the suite runs against a build made with VITE_CITEFOX_E2E_MOCKS=1.
// Set CITEFOX_E2E_SKIP_BUILD=1 to reuse an `out/` built that way.
if (process.env.CITEFOX_E2E_SKIP_BUILD !== '1') {
  const electronVite = join(
    dirname(require.resolve('electron-vite/package.json')),
    'bin/electron-vite.js'
  )
  const built = spawnSync(process.execPath, [electronVite, 'build'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_CITEFOX_E2E_MOCKS: '1' }
  })
  if (built.status !== 0) process.exit(built.status ?? 1)
}
const headlessLinux =
  process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY

const command = headlessLinux ? 'xvfb-run' : process.execPath
const args = headlessLinux
  ? ['-a', '--server-args=-screen 0 1600x1000x24', process.execPath, cli, 'test', ...extra]
  : [cli, 'test', ...extra]

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env
})

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 1)
})
