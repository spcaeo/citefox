import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible } from './screens-app'
import { e2eArtifactsDir } from './artifacts'
import { openAllPages, sidebarLink } from './nav-helpers'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * Ask CiteFox (FR-25.7) through real IPC, in its drawer. The two-market
 * TextBolt seed holds four stored prompt checks. A "which / where" question
 * is a list answer: the `claude` stand-in answers the filter prompt from
 * src/main/ask/fixtures/ask-filters.json (UK, every "not cited" status) and
 * the rows come from the stored checks.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const SCREENSHOTS = path.join(e2eArtifactsDir(), 'screenshots', 'templates')
const QUESTION = 'Where is my page not cited in the UK?'

test('Ask CiteFox answers a list question from stored results', async () => {
  test.setTimeout(120_000)
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-ask-'))
  await seedTwoMarketProject(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeClaudeStandIn(path.join(bin, 'claude'), SHIM)
  const shimLog = path.join(dir, 'claude-shim.log')

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: shimLog
    }
  })

  const dialog = page.getByRole('dialog', { name: 'Ask CiteFox' })

  try {
    await openAllPages(page)

    await test.step('the top bar opens Ask CiteFox with the question box focused', async () => {
      await page.getByRole('button', { name: 'Ask CiteFox', exact: true }).click()
      await expect(dialog).toBeVisible()
      await expect(page).toHaveURL(/drawer=ask/)
      await expect(dialog.getByRole('textbox', { name: 'Your question' })).toBeFocused()
      await expect(
        dialog.getByText(
          'Answers come from your stored checks. It never searches Google or changes anything without asking.'
        )
      ).toBeVisible()
    })

    const region = dialog.getByRole('region', { name: 'Answer from CiteFox AI' })

    await test.step('a question becomes filters, rows, and a plain answer', async () => {
      await dialog.getByRole('textbox', { name: 'Your question' }).fill(QUESTION)
      await dialog.getByRole('button', { name: 'Ask', exact: true }).click()
      await expect(
        region.getByText(
          /^2 of 4 prompt checks match in UK · EN: your page is not cited for 1 prompt and another of your pages is cited for 1 prompt\. Sites cited most in these, besides yours: simpletexting\.com \(1 of 2\)\. Latest check Oct 19, 2026, \d{1,2}:\d{2}\s?[AP]M\.$/
        )
      ).toBeVisible({ timeout: 60_000 })
      await expect(dialog.getByText(QUESTION, { exact: true })).toBeVisible()
      await expect(region.getByText(/^Based on 4 stored checks in 1 market/)).toBeVisible()
      await expect(region.getByText(/no searches$/)).toBeVisible()
      const table = region.getByRole('grid', { name: 'Matching question checks' })
      await expect(table.getByRole('row')).toHaveCount(3)
      // Row links name the project the answer came from (a project route).
      await expect(
        table.getByRole('link', { name: 'How do I alert the crew in the UK without a developer?' })
      ).toHaveAttribute('href', /^#\/p\/[^/]+\/pages\/page-1\/prompt\/prompt-1\?market=/)
      await expect(table.getByText('simpletexting.com')).toBeVisible()
      expect(shimLines(shimLog).filter((line) => line === 'ask')).toHaveLength(1)
    })

    await test.step('axe and screenshot', async () => {
      await expectMainAccessible(page)
      await mkdir(SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SCREENSHOTS, 'ask-citefox.png') })
    })

    await test.step('the answer counts drill into exactly the matched rows', async () => {
      const rows = page.locator('[data-drill-row]')
      const checks = region.getByRole('button', { name: '2 question checks match these filters' })
      await expect(checks.locator('[data-nfr-figure]')).toHaveText('2')
      const pages = region.getByRole('button', { name: /pages? in this answer$/ })
      const pageCount = await pages.locator('[data-nfr-figure]').textContent()
      await pages.click()
      // The drill drawer opens over Ask CiteFox; Escape closes only the drill.
      await expect(rows).toHaveCount(Number(pageCount))
      await page.keyboard.press('Escape')
      await expect(rows).toHaveCount(0)
      await expect(dialog).toBeVisible()
      await checks.click()
      await expect(rows).toHaveCount(2)
      await expectMainAccessible(page)
      await rows.first().focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/#\/pages\/[^/]+\/prompt\/[^?]+\?market=/)
    })

    await test.step('an old #/ask link opens the drawer with the question box focused', async () => {
      await clickAllPages(page)
      await page.evaluate(() => {
        window.location.hash = '#/ask'
      })
      await expect(page).toHaveURL(/drawer=ask/)
      await expect(dialog.getByRole('textbox', { name: 'Your question' })).toBeFocused()
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

function shimLines(file: string): string[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
}

async function clickAllPages(page: Page): Promise<void> {
  await (await sidebarLink(page, 'Your site', /^Pages/)).click()
  await expect(page).toHaveURL(/#\/pages$/)
  await expect(page.getByRole('dialog', { name: 'Ask CiteFox' })).toHaveCount(0)
}
