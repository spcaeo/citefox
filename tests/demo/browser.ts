import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'

/**
 * Opens a URL in a bare Electron window (tests/demo/browser.cjs), the headless
 * browser of the demo checks. Docker only: scripts/demo/docker.mjs runs it under
 * xvfb, so no window ever opens on a desktop.
 */
export async function openBrowser(
  url: string
): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  if (process.env.CITEFOX_DEMO_DOCKER !== '1') {
    throw new Error(
      'The demo checks open a browser: run them with npm run demo:record / demo:check (Docker).'
    )
  }
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  env.CITEFOX_DEMO_URL = url
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [resolve('tests/demo/browser.cjs')], env })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  // A missing element fails the step after 15 s instead of waiting forever.
  page.setDefaultTimeout(15_000)
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${page.url()} :: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${page.url()} :: ${error.message}`))
  await page.waitForLoadState('domcontentloaded')
  return { app, page, errors }
}
