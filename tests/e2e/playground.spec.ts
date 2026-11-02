import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { drawerShots } from './drawer-helpers'
import { launchOnboardedMock } from './onboarded'
import { leaveFirstRun } from './first-run-helpers'

const TEXTBOLT_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

/** The mock build, just onboarded (no setup wizard): TextBolt with no pages yet. */
async function openApp(): Promise<{
  app: ElectronApplication
  page: Page
  dir: string
}> {
  return launchOnboardedMock('playground', { viewport: { width: 1280, height: 820 } })
}

async function closeApp(app: ElectronApplication, dir: string): Promise<void> {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}

async function axeViolations(
  app: ElectronApplication,
  page: Page,
  selector: string
): Promise<string[]> {
  const source = readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8')
  await app.evaluate(({ BrowserWindow }, script) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No window')
    return win.webContents.executeJavaScript(script)
  }, source)
  return page.evaluate(
    async ({ root, tags }) => {
      const axeApi = (
        window as unknown as {
          axe: {
            run: (
              context: string,
              options: { runOnly: { type: 'tag'; values: string[] } }
            ) => Promise<{
              violations: { id: string; help: string; nodes: { target: string[] }[] }[]
            }>
          }
        }
      ).axe
      const result = await axeApi.run(root, { runOnly: { type: 'tag', values: tags } })
      return result.violations.map((violation) => {
        const target = violation.nodes[0]?.target.join(' ') ?? ''
        return `${violation.id}: ${violation.help} (${target})`
      })
    },
    {
      root: selector,
      tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
    }
  )
}

test('playground runs a template, shows cited sources, and saves picked parts', async () => {
  test.setTimeout(120_000)
  const { app, page, dir } = await openApp()
  try {
    await leaveFirstRun(page)
    await page.evaluate(() => {
      window.location.hash = '#/playground'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible()
    await expect(page.locator('.pg-banner')).toContainText("Playground runs aren't saved.")
    await expect(page.getByRole('status').filter({ hasText: '2 templates' })).toBeVisible()
    await expect(
      page.getByText("Pick a template, enter any URL, and run. Playground runs aren't saved.")
    ).toBeVisible()
    expect(await axeViolations(app, page, '.pg-page')).toEqual([])
    await page.screenshot({
      path: await e2eArtifact('playground-empty.png'),
      fullPage: true
    })

    await page.evaluate(() => localStorage.setItem('citefox.mock.pace', '2500'))
    await page.getByLabel('URL').fill(TEXTBOLT_URL)
    await page
      .getByRole('grid', { name: 'Choose a template' })
      .getByRole('row', { name: /Buyer questions/ })
      .click()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByRole('progressbar', { name: 'Running the template' })).toBeVisible()
    await page.screenshot({
      path: await e2eArtifact('playground-running.png'),
      fullPage: true
    })
    await expect(page.getByRole('heading', { name: '10 questions' })).toBeVisible()
    await expect(page.getByText('This run is not saved.', { exact: true })).toBeVisible()
    await expect(page.getByText('0 searches')).toBeVisible()
    await page.evaluate(() => localStorage.setItem('citefox.mock.pace', '0'))

    await page.getByRole('button', { name: 'Check AI Overviews' }).click()
    await expect(page.getByText('6 sources')).toBeVisible()
    await expect(page.getByText('textbolt.com').first()).toBeVisible()
    await expect(page.getByText('Position 2')).toBeVisible()
    await expect(page.getByText('Key · Work SerpApi')).toBeVisible()
    await expect(page.getByText(/\b1 search\b/)).toBeVisible()
    await expect(page.getByText('1 of 10 questions selected')).toBeVisible()

    // Drill-downs: the cited count opens exactly those prompts; sources open in the browser.
    const cited = page.getByRole('button', { name: /^Page cited in \d+ questions?$/ })
    const citedCount = Number(await cited.locator('[data-nfr-figure]').textContent())
    await cited.click()
    const drawer = page.getByRole('dialog')
    await expect(drawer.locator('[data-drill-row]')).toHaveCount(citedCount)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(page.locator('.pg-sources a[target="_blank"]').first()).toHaveAttribute(
      'href',
      /^https?:\/\//
    )
    await page.getByRole('button', { name: 'Position 2: show the page in the sources' }).click()
    await expect(page.locator('.pg-source-marked')).toContainText('This page')
    expect(await axeViolations(app, page, '.pg-page')).toEqual([])
    await page.screenshot({
      path: await e2eArtifact('playground-result.png'),
      fullPage: true
    })

    // Save to project is a drawer on the URL: Back closes it, ✕ closes it, then save.
    const saveButton = page.getByRole('button', { name: 'Save to project' })
    await saveButton.click()
    const dialog = page.getByRole('dialog', { name: 'Save to project' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-drawer', 'playground-save')
    expect(await page.evaluate(() => window.location.hash)).toMatch(
      /[?&]drawer=playground-save&pgs\.run=[^&]+$/
    )
    await page.evaluate(() => window.history.back())
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => window.location.hash)).not.toContain('drawer=')
    await saveButton.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close Save to project' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(saveButton).toBeFocused()
    await saveButton.click()
    await expect(dialog.getByRole('status')).toHaveText(/^3 parts selected/)
    await drawerShots(page, 'playground-save', page.viewportSize() ?? undefined)
    await dialog.getByRole('button', { name: 'Save to project', exact: true }).click()
    await expect(page.getByText(/Saved Page read, Questions, AI Overview checks/)).toBeVisible()
    const saved = page.getByRole('link', { name: 'Open the saved page' })
    await expect(saved).toHaveAttribute('href', /^#\/pages\/[^/]+\/prompts$/)
    await expect(page.getByText(/\. Page [a-z0-9-]+\./)).toHaveCount(0)
    await expect(page.getByText('citefox-sample-serpapi-b1f4')).toHaveCount(0)
  } finally {
    await closeApp(app, dir)
  }
})
