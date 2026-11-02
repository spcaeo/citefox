import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'

/**
 * Opt-in smoke test of a packaged build (`npm run dist` / `npm run pack`).
 * Set CITEFOX_PACKAGED_APP to the app executable, for example
 * `release/mac-arm64/CiteFox.app/Contents/MacOS/CiteFox`.
 *
 * The packaged app has the EnableNodeCliInspectArguments fuse off, so
 * Playwright's `_electron.launch` (which needs `--inspect`) cannot attach.
 * The test starts the binary itself and drives the renderer over the Chromium
 * DevTools protocol instead.
 */
const executable = process.env.CITEFOX_PACKAGED_APP?.trim()

test.skip(!executable, 'Set CITEFOX_PACKAGED_APP to a packaged CiteFox executable')

test('packaged app starts, renders onboarding, and opens its database', async () => {
  test.setTimeout(90_000)
  const binary = path.resolve(executable ?? '')
  expect(existsSync(binary), `${binary} exists`).toBe(true)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-packaged-'))
  const port = await freePort()
  const child = spawn(binary, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`], {
    stdio: 'ignore'
  })
  let browser: Browser | undefined
  try {
    browser = await connect(port, child)
    const page = await appPage(browser)
    await expect(page.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()
    expect(page.url()).toMatch(/^file:.*app\.asar\/out\/renderer\/index\.html/)
    await page.screenshot({ path: await e2eArtifact('packaged-onboarding.png') })

    // better-sqlite3 loaded from app.asar.unpacked and created the database.
    await expect.poll(() => existsSync(path.join(dir, 'app.sqlite'))).toBe(true)
    // @napi-rs/keyring is required when the main bundle loads; a missing
    // binary would have stopped the window from opening. The log has no errors.
    const log = path.join(dir, 'logs', 'citefox.log')
    await expect.poll(() => existsSync(log)).toBe(true)
    const text = readFileSync(log, 'utf8')
    expect(text).toContain('CiteFox ')
    expect(text).not.toContain(' ERROR ')
  } finally {
    await browser?.close().catch(() => undefined)
    await stop(child)
    await rm(dir, { recursive: true, force: true })
  }
})

/** SIGTERM, then SIGKILL after 5 s, so a hung app never outlives the test. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
  await exited
  clearTimeout(timer)
}

async function connect(port: number, child: ChildProcess): Promise<Browser> {
  const deadline = Date.now() + 30_000
  let lastError: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`CiteFox exited with code ${child.exitCode}`)
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch (error: unknown) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Could not reach the DevTools port: ${String(lastError)}`)
}

async function appPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => candidate.url().startsWith('file:'))
      if (page !== undefined) return page
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('The CiteFox window did not open')
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port)
        else reject(new Error('No free port'))
      })
    })
  })
}
