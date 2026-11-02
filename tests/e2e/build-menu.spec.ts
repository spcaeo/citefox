import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { openHash, openTwoMarketApp, shot } from './screens-app'

/**
 * Owner feedback batch 2, moved by the slim header: the version line in the
 * top bar's ⚙ menu (it copies the build info), the reset confirm dialog on
 * the URL, and Settings › About › Testing (Reset, Test as a new user). Screenshots land in
 * test-results/e2e/Build-*.png (copied to Mockups/v2/preview).
 *
 * Main's e2e build answers the app tools with a recorded fake
 * (CITEFOX_E2E_APP_TOOLS, record by default): no window, no restart, one JSON
 * line per call in <userData>/e2e-app-tools.jsonl.
 */

const root = process.cwd()
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  version: string
}

function appToolCalls(userData: string): { channel: string; request: unknown }[] {
  return readFileSync(path.join(userData, 'e2e-app-tools.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { channel: string; request: unknown })
}

async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/)).toHaveCount(0)
  await page.waitForTimeout(300)
}

test('⚙ menu version, copy, reset dialog and Test as a new user', async () => {
  test.setTimeout(180_000)
  const { app, page, close } = await openTwoMarketApp('build-menu')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openHash(page, '#/pages')
    await settle(page)
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))

    const banner = page.getByRole('banner')
    const gear = banner.getByRole('button', { name: 'Settings menu', exact: true })
    const menu = page.getByRole('menu', { name: 'Settings menu' })
    const version = menu.getByRole('menuitem', {
      name: new RegExp(`^v${pkg.version.replace(/\./g, '\\.')} .*: copy build info$`)
    })

    await test.step('the ⚙ menu shows the version from package.json; no chip in the bar', async () => {
      await expect(banner.locator('.bm-chip')).toHaveCount(0)
      await expect(gear).toHaveAttribute('aria-haspopup', 'menu')
      // ⚙ is the last control on the right, after Ask CiteFox.
      const gearBox = await gear.boundingBox()
      const askBox = await banner
        .getByRole('button', { name: 'Ask CiteFox', exact: true })
        .boundingBox()
      expect(gearBox && askBox && gearBox.x > askBox.x).toBe(true)
      await gear.click()
      await expect(menu).toBeVisible()
      await expect(version).toBeVisible()
      expect((await version.textContent())?.startsWith(`v${pkg.version}`)).toBe(true)
      await expect(menu.getByRole('menuitem', { name: 'Check for updates' })).toBeVisible()
      await shot(page, 'Build-menu-1440x900')
    })

    await test.step('the version line copies the build info', async () => {
      await version.click()
      await expect(version).toContainText('Copied')
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(copied).toContain(`CiteFox ${pkg.version}`)
      expect(copied).toContain('Commit: ')
      // The suite runs on a Mac and in Docker (Linux): expect the OS it runs on.
      const names: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
      expect(copied).toContain(`OS: ${names[process.platform] ?? ''}`)
      // The tick goes back after about 1.5 s.
      await expect(version).toContainText('Copy', { timeout: 4000 })
      await expect(version).not.toContainText('Copied')
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(gear).toBeFocused()
    })

    await test.step('the reset dialog lives on the URL; Cancel, Back and Escape close it', async () => {
      await page.evaluate(() => {
        window.location.hash = '#/pages?dialog=reset'
      })
      const dialog = page.getByRole('alertdialog', { name: 'Reset CiteFox, keep my keys?' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('Projects, pages and questions')
      await expect(dialog).toContainText('Your API keys')
      await expect(dialog).toContainText('A backup of the current data is kept in the data folder.')
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
      await page.waitForTimeout(200)
      await shot(page, 'Build-reset-dialog-1440x900')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      expect(await page.evaluate(() => window.location.hash)).toBe('#/pages')
      // The page behind is unchanged.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      // Back closes it too, and Escape.
      await page.evaluate(() => {
        window.location.hash = '#/pages?dialog=reset'
      })
      await expect(dialog).toBeVisible()
      await page.evaluate(() => window.history.back())
      await expect(dialog).toBeHidden()
      expect(await page.evaluate(() => window.location.hash)).toBe('#/pages')
      await page.evaluate(() => {
        window.location.hash = '#/pages?dialog=reset'
      })
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    })

    await test.step('Settings › Data & about shows the build, and Testing under More', async () => {
      await openHash(page, '#/settings')
      await settle(page)
      await page.getByRole('tab', { name: 'Data & about' }).click()
      const about = page.getByRole('region', { name: 'About CiteFox' })
      await expect(about).toContainText(pkg.version)
      const testing = page.getByRole('region', { name: 'Testing' })
      await expect(testing).toBeHidden()
      await page
        .locator('.stg-more > summary')
        .filter({ hasText: /^More$/ })
        .click()
      await expect(testing.getByRole('button', { name: 'Open test window' })).toBeVisible()
      await shot(page, 'Build-about-1440x900')
    })

    await test.step('Test as a new user (Settings › Data & about › More › Testing)', async () => {
      const testing = page.getByRole('region', { name: 'Testing' })
      await testing.getByRole('button', { name: 'Open test window' }).click()
      // Main's answer shows as the build toast.
      await expect(page.locator('.bm-toast')).toHaveText('Test window opened')
      const calls = appToolCalls(userData)
      expect(calls.at(-1)).toMatchObject({
        channel: 'app:openTestProfile',
        request: { fresh: false }
      })
      // No reset was ever sent: Cancel really cancelled.
      expect(calls.some((call) => call.channel === 'app:resetKeepKeys')).toBe(false)
    })

    await test.step('the test window stays open; a fresh start is refused inline', async () => {
      const testing = page.getByRole('region', { name: 'Testing' })
      await page.waitForTimeout(5500) // let the toast from the step above go
      await testing.getByRole('button', { name: 'Open test window' }).click()
      await expect(page.locator('.bm-toast')).toHaveText('Test window is already open')
      await testing.getByRole('button', { name: 'Start fresh…' }).click()
      const dialog = page.getByRole('alertdialog', { name: 'Start a fresh test profile?' })
      await expect(dialog).toBeVisible()
      expect(await page.evaluate(() => window.location.hash)).toBe(
        '#/settings?tab=data&dialog=fresh-test'
      )
      await dialog.getByRole('button', { name: 'Clear and open' }).click()
      await expect(dialog.getByRole('alert')).toHaveText(
        'Close the test window first, then start fresh.'
      )
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      expect(appToolCalls(userData).at(-1)).toMatchObject({
        channel: 'app:openTestProfile',
        request: { fresh: true }
      })
    })
  } finally {
    await close()
  }
})
