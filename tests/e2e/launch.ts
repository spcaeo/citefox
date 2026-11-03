import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testSecretsFile } from './keychain'

// The specs were written for Light/Dark following the computer: start on System, not the
// Sepia default. Set here too so settings the specs seed in this process match.
process.env.CITEFOX_DEFAULT_THEME ??= 'system'

export async function launchCiteFox(options?: {
  userDataDir?: string
  viewport?: { width: number; height: number }
  /** Extra environment for the production main process. Unset values are removed. */
  env?: Record<string, string | undefined>
}): Promise<{ app: ElectronApplication; page: Page }> {
  const root = process.cwd()
  // Seeded "setting up" pages must not start background setup (and its page reads).
  // Test windows stay invisible and never take focus unless CITEFOX_E2E_VISIBLE=1.
  const env: Record<string, string> = {
    CITEFOX_SETUP_RUNNER: 'off',
    // The first-run autopilot reads the real site; only the first-run spec turns it on.
    CITEFOX_START_AUTOPILOT: 'off',
    // Site icons are never fetched from the network in tests; specs stub `favicons:get`.
    CITEFOX_FAVICONS: 'off',
    // Slack posts never leave the machine: an offline transport answers (`/fail` fails).
    CITEFOX_SLACK: 'off',
    // Only the specs' shims count as Claude Code or Codex, never the real ones on this computer.
    CITEFOX_E2E_FAKE_AI_ONLY: '1',
    CITEFOX_DEFAULT_THEME: 'system',
    // Seeds record checks on fixed dates, so their pages go due as the calendar moves on.
    // The tray loop starts no due pass by itself; "Check due pages now" still runs one.
    // A spec that needs the automatic pass passes CITEFOX_AUTO_CHECKS: 'on'.
    CITEFOX_AUTO_CHECKS: 'off',
    ...(process.env.CITEFOX_E2E_VISIBLE === '1' ? {} : { CITEFOX_E2E_BACKGROUND: '1' })
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  // A developer's CITEFOX_USER_DATA would point every test at one shared folder.
  delete env.CITEFOX_USER_DATA
  // Never run against the real app data folder. Without a folder from the
  // spec, each launch gets a fresh one that is removed when the app closes.
  const ownDir = options?.userDataDir ? null : mkdtempSync(path.join(tmpdir(), 'citefox-e2e-'))
  const userDataDir = options?.userDataDir ?? ownDir
  // Keys and passwords go to a file in that folder, never the real login keychain.
  if (userDataDir !== null) env.CITEFOX_SECRETS_FILE = testSecretsFile(userDataDir)
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      // Windows names are case-insensitive: the inherited `Path` would hide our `PATH`.
      if (process.platform === 'win32') {
        for (const other of Object.keys(env)) {
          if (other !== key && other.toLowerCase() === key.toLowerCase()) delete env[other]
        }
      }
      if (value === undefined) delete env[key]
      else env[key] = value
    }
  }
  delete env.ELECTRON_RENDERER_URL
  // The topic wizard's stand-in site lives here, not in the app bundle
  // (src/main/topics/e2e-site.ts), so release builds carry no demo pages.
  if (env.CITEFOX_E2E_TOPICS === '1' && env.CITEFOX_E2E_TOPIC_SITE === undefined) {
    env.CITEFOX_E2E_TOPIC_SITE = path.join(root, 'tests/e2e/fixtures/topic-site.json')
  }

  const args = [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')]

  const app = await electron.launch({
    args,
    cwd: root,
    env
  })
  if (ownDir !== null) {
    app.once('close', () => rmSync(ownDir, { recursive: true, force: true }))
  }
  const page = await app.firstWindow()
  await page.setViewportSize(options?.viewport ?? { width: 1280, height: 900 })
  return { app, page }
}
