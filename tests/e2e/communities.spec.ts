import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { openCommunitiesApp, type CommunitiesApp } from './communities-app'
import { sidebar, sidebarLink } from './nav-helpers'
import { expectMainAccessible, openHash } from './screens-app'
import { e2eArtifactsDir } from './artifacts'

const SHOTS =
  process.env.CITEFOX_COMMUNITIES_SHOTS ??
  path.join(e2eArtifactsDir(), 'screenshots', 'communities')

let opened: CommunitiesApp | undefined

test.afterEach(async () => {
  await opened?.close()
  opened = undefined
})

async function shoot(page: Page, name: string, heading?: string): Promise<void> {
  await mkdir(SHOTS, { recursive: true })
  if (heading !== undefined) {
    await page.getByRole('heading', { name: heading, exact: true }).scrollIntoViewIfNeeded()
  }
  await page.screenshot({ path: path.join(SHOTS, name) })
}

/**
 * Opens a grid row's ⋯ menu. The menu closes when the page scrolls, and the
 * click itself can scroll the row into view, so retry until it stays open.
 */
async function openRowMenu(page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded()
  await expect(async () => {
    if ((await page.getByRole('menu').count()) === 0) await button.click()
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
}

test('Communities tab: source mix, cited sources, drill, Check threads and opportunities', async () => {
  test.setTimeout(120_000)
  opened = await openCommunitiesApp('communities')
  const { page } = opened
  await openHash(page, '#/pages/page-1/communities')
  const main = page.locator('#main')

  await test.step('the source mix follows the header market (US · EN)', async () => {
    // No heading repeats the tab's name: one intro line, then the KPI strip.
    await expect(main.getByText(/The forums, videos and posts AI answers cite/)).toBeVisible()
    await expect(main.getByTestId('mix-caption')).toContainText(
      '8 citations (links, not questions) across 2 overviews'
    )
    await expectMainAccessible(page)
  })

  await test.step('all markets counts every stored citation once', async () => {
    await main.getByRole('button', { name: 'All markets' }).click()
    await expect(main.getByTestId('mix-caption')).toContainText(
      '15 citations (links, not questions) across 4 overviews'
    )
    const reddit = main.getByRole('row').filter({ has: page.locator('[data-mix-type="reddit"]') })
    await expect(reddit.getByRole('gridcell').nth(1)).toHaveText('3')
    for (const type of ['Reddit', 'YouTube', 'LinkedIn']) {
      await expect(main.getByRole('button', { name: `3 citations: ${type}` })).toBeVisible()
    }
    await shoot(page, 'communities-page.png')
  })

  await test.step('a drill lists exactly the answers behind the number', async () => {
    const button = main.getByRole('button', { name: '3 answers cite Reddit' })
    await button.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Reddit cited · 3 answers' })).toBeVisible()
    await expect(dialog.locator('[data-drill-row]')).toHaveCount(3)
    await shoot(page, 'communities-drill.png')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(button).toBeFocused()
  })

  await test.step('a citation count lists exactly its links, on real IPC (NFR-14)', async () => {
    const report = await page.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          citefox: {
            'communities:get': (request: unknown) => Promise<{
              links: { checkIndex: number; type: string; owner: string }[]
              checks: { index: number; citations: number }[]
            }>
          }
        }
      ).citefox
      return api['communities:get']({
        projectId: 'proj-1',
        scope: 'page',
        pageId: 'page-1',
        marketId: null
      })
    })
    const newest = report.links.filter((link) => link.checkIndex === 0)
    expect(newest).toHaveLength(report.checks.find((check) => check.index === 0)?.citations ?? -1)
    const total = main.getByRole('button', { name: `${newest.length} citations in total` })
    await total.click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', {
        name: `Every citation in the newest check · ${newest.length} citations`
      })
    ).toBeVisible()
    await expect(dialog.locator('[data-drill-row]')).toHaveCount(newest.length)
    await page.keyboard.press('Escape')
    const redditLinks = newest.filter((link) => link.type === 'reddit').length
    await main.getByRole('button', { name: `${redditLinks} citations: Reddit` }).click()
    await expect(dialog.locator('[data-drill-row]')).toHaveCount(redditLinks)
    // Every link opens in the browser (the main process opens it).
    // (A row also carries the shared copy / open icons, so count rows, not anchors.)
    await expect(
      dialog
        .locator('[data-drill-row]')
        .filter({ has: page.locator('a[target="_blank"][href*="reddit.com"]') })
    ).toHaveCount(redditLinks)
    await shoot(page, 'communities-links-drill.png')
    // Enter on a row opens that answer's Prompt detail, pinned to its market and check.
    await dialog.locator('[data-drill-row]').first().focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/pages\/page-1\/prompt\/[^?]+\?market=[^&]+&run=/)
    await openHash(page, '#/pages/page-1/communities')
    await main.getByRole('button', { name: 'All markets' }).click()
    await expect(main.getByTestId('mix-caption')).toContainText('15 citations')
  })

  await test.step('a Reddit row opens the thread and the prompts citing it', async () => {
    await shoot(page, 'communities-mix.png')
    await main.getByRole('tab', { name: /^Reddit/ }).click()
    const table = main.getByTestId('cm-reddit-table')
    const row = table.getByRole('row', { name: /vtext\.com shutting down/ })
    await row.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Can we reply?')
    const cited = Number(
      (await row.getByRole('button', { name: /cited in \d+ answer/ }).textContent()) ?? '-1'
    )
    await expect(dialog.locator('[data-drill-row]')).toHaveCount(cited)
    await expect(
      dialog.getByRole('link', { name: /Open the thread in your browser/ })
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(table.getByRole('columnheader', { name: /Gap/ })).toBeVisible()
  })

  await test.step('a YouTube video linked three ways is counted once', async () => {
    await main.getByRole('tab', { name: /^YouTube/ }).click()
    const table = main.getByTestId('cm-youtube-table')
    const row = table.getByRole('row', { name: /Send SMS Alerts from Grafana in 5 Minutes/ })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('48,210')
    await expect(row).toContainText('Ops Shortcuts')
    await expect(table.locator('[role="row"][data-row]')).toHaveCount(2)
    await shoot(page, 'communities-youtube.png')
    await row.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    const cited = Number(
      (await row.getByRole('button', { name: /cited in \d+ answer/ }).textContent()) ?? '-1'
    )
    await expect(dialog.locator('[data-drill-row]')).toHaveCount(cited)
    await expect(dialog).toContainText('Ops Shortcuts')
    await page.keyboard.press('Escape')
  })

  await test.step('Check threads reads public Reddit data and marks open and archived', async () => {
    await main.getByRole('tab', { name: /^Reddit/ }).click()
    const table = main.getByTestId('cm-reddit-table')
    await expect(table.getByText('Unchecked')).toHaveCount(2)
    await main.getByRole('button', { name: 'Check threads' }).click()
    await expect(main.getByText('Read 2 threads.')).toBeVisible()
    const sysadmin = table.getByRole('row', { name: /vtext\.com shutting down/ })
    const small = table.getByRole('row', { name: /Twilio quote was crazy/ })
    await expect(sysadmin).toContainText('Open')
    await expect(sysadmin).toContainText('214')
    await expect(sysadmin).toContainText('Yes')
    await expect(small).toContainText('Archived')
    await expect(main.getByText(/1 of 2 checked threads are open/)).toBeVisible()
    const fetched = await opened?.fetched()
    expect(fetched).toHaveLength(2)
    for (const url of fetched ?? []) {
      expect(url).toMatch(/^https:\/\/www\.reddit\.com\/comments\/(1abc23x|1def45y)\.json\?/)
    }
    await shoot(page, 'communities-threads-checked.png')
  })

  await test.step('"Brand in thread" shows the sentence that names the brand', async () => {
    const table = main.getByTestId('cm-reddit-table')
    const sysadmin = table.getByRole('row', { name: /vtext\.com shutting down/ })
    await sysadmin.getByRole('button', { name: /Brand in thread: Yes/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('blockquote').first()).toContainText(
      'TextBolt worked for us, took 20 minutes.'
    )
    await expect(dialog).toContainText('Our alarm panels send to @vtext.com. What now?')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  await test.step('"First seen" opens the first check and prompt that cited the thread', async () => {
    const table = main.getByTestId('cm-reddit-table')
    const sysadmin = table.getByRole('row', { name: /vtext\.com shutting down/ })
    const first = sysadmin.getByRole('link', { name: /^First seen .* for question \d+ in / })
    await expect(first).toHaveAttribute(
      'href',
      /^#\/pages\/page-1\/prompt\/[^?]+\?market=[^&]+&run=/
    )
  })

  await test.step('"Draft a helpful reply" from the row menu; the user copies it (FR-17.6)', async () => {
    const table = main.getByTestId('cm-reddit-table')
    const small = table.getByRole('row', { name: /Twilio quote was crazy/ })
    await openRowMenu(page, small.getByRole('button', { name: /^Actions for / }))
    await expect(page.getByRole('menuitem', { name: /Show the answers citing it/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Draft a helpful reply/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await openRowMenu(
      page,
      table.getByRole('button', { name: /^Actions for vtext\.com shutting down/ })
    )
    await page.getByRole('menuitem', { name: /Draft a helpful reply/ }).click()
    const panel = main.getByRole('region', { name: 'Draft reply for r/sysadmin' })
    const text = panel.getByTestId('cm-reply-text')
    await expect(text.locator('p[data-reply-part="answer"]')).toContainText(
      'Point the alarm panels at a business text address'
    )
    await expect(text.locator('p[data-reply-part="disclosure"]')).toContainText(
      'Full disclosure: I work at TextBolt'
    )
    await expect(panel).toContainText('CiteFox never posts for you')
    await expect(panel.getByRole('link', { name: /Open thread/ })).toHaveAttribute(
      'href',
      /reddit\.com/
    )
    await panel.getByRole('button', { name: 'Copy reply' }).click()
    await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible()
    const copied = await opened?.app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('Point the alarm panels at a business text address')
    expect(copied).toContain('Full disclosure: I work at TextBolt')
    await expectMainAccessible(page)
    await panel.scrollIntoViewIfNeeded()
    await shoot(page, 'communities-reply-draft.png')
    await panel.getByRole('button', { name: 'Close the draft' }).click()
    await expect(panel).toHaveCount(0)
  })

  await test.step('opportunities are ranked by what there is to gain', async () => {
    await main.getByRole('tab', { name: /^Opportunities/ }).click()
    const rows = main.getByTestId('cm-opportunities').locator('[role="row"][data-row]')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0).locator('[role="gridcell"]').first()).toHaveText('1')
    await expect(rows.nth(0)).toContainText('YouTube · Ops Shortcuts')
    await expect(rows.nth(0)).toContainText('+3 points if cited')
    await expect(rows.nth(1)).toContainText('Reddit · r/sysadmin')
    await expect(rows.nth(2)).toContainText('LinkedIn · LinkedIn post')
    await expect(rows.nth(2)).toContainText('+2 points if cited')
    // One Export: the page header's.
    await expect(main.getByRole('link', { name: 'Export this report' })).toHaveCount(0)
    await expectMainAccessible(page)
    await shoot(page, 'communities-opportunities.png')
    // Export report is under the page header's ⋯; it starts on the market the page shows.
    const back = await page.evaluate(() => window.location.hash)
    await page.locator('.ui-head-page').getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Export report' }).click()
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toMatch(/^#\/export\?page=page-1&market=[^&]+$/)
    await page.goBack()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(back)
  })

  await test.step('whole project scope', async () => {
    await main.getByRole('tab', { name: /^Source mix/ }).click()
    await main.getByRole('button', { name: 'Whole project' }).click()
    await expect(main.getByRole('button', { name: 'Whole project' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(main.getByTestId('mix-caption')).toContainText('1 tracked page · All markets')
    await expect(main.getByRole('columnheader', { name: /Latest check/ })).toBeVisible()
    // The section and both filters are in the URL.
    await expect(page).toHaveURL(/communities\?(?=.*scope=project)(?=.*markets=all)/)
    await page.evaluate(() => window.scrollTo(0, 0))
    await main.getByTestId('mix-caption').scrollIntoViewIfNeeded()
    await shoot(page, 'communities-project.png')
  })
})

test('Project Communities: every tracked page, market filter in the URL, Back, drill', async () => {
  test.setTimeout(120_000)
  opened = await openCommunitiesApp('communities-project')
  const { page } = opened
  const main = page.locator('#main')

  await test.step('opens from Pages in the sidebar, then its Communities tab, with one header', async () => {
    const link = await sidebarLink(page, 'Your site', 'Communities')
    await link.click()
    await expect(page).toHaveURL(/#\/communities$/)
    await expect(link).toHaveAttribute('aria-selected', 'true')
    await expect(sidebar(page).getByRole('link', { name: /^Pages/ })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(['Communities'])
    await expect(main.getByTestId('mix-caption')).toContainText('1 tracked page · All markets')
    await expect(main.getByTestId('mix-caption')).toContainText(
      '15 citations (links, not questions) across 4 overviews'
    )
    // No "This page" switch: the whole project is the scope.
    await expect(main.getByRole('button', { name: 'This page' })).toHaveCount(0)
    await expectMainAccessible(page)
    await shoot(page, 'communities-project-screen.png')
  })

  await test.step('the market filter is in the URL, and Back undoes it', async () => {
    const select = main.getByRole('combobox', { name: 'Market' }).first()
    const us = (await select.locator('option', { hasText: 'US' }).getAttribute('value')) ?? ''
    expect(us).not.toBe('')
    await select.selectOption(us)
    await expect(page).toHaveURL(new RegExp(`#/communities\\?market=${us}$`))
    await expect(main.getByTestId('mix-caption')).toContainText(
      '8 citations (links, not questions) across 2 overviews'
    )
    await page.goBack()
    await expect(page).toHaveURL(/#\/communities$/)
    await expect(main.getByTestId('mix-caption')).toContainText('15 citations')
  })

  await test.step('a number drills to exactly its answers, each naming its page', async () => {
    const button = main.getByRole('button', { name: '3 answers cite Reddit' })
    await button.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('[data-drill-row]')).toHaveCount(3)
    await expect(dialog).toContainText('Its page')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(button).toBeFocused()
  })

  await test.step('a section opens from its URL and comes back with Back', async () => {
    await main.getByRole('tab', { name: /^Reddit/ }).click()
    await expect(page).toHaveURL(/#\/communities\?view=reddit$/)
    await expect(main.getByTestId('cm-reddit-table')).toBeVisible()
    await openHash(page, '#/overview')
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await page.goBack()
    await expect(main.getByTestId('cm-reddit-table')).toBeVisible()
    await expect(main.getByRole('tab', { name: /^Reddit/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})
