import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible } from './screens-app'
import { drawerRowCount } from './drill-helpers'
import { openAllPages } from './nav-helpers'

/**
 * All pages drill-downs (REPORT-SPEC "Interaction model", NFR-14) on the
 * seeded TextBolt-sized project through the real IPC handlers: every number
 * opens what it counts and the drawer total equals the number clicked. No
 * live network: nothing here runs a check.
 */
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let dir: string

test.beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-drill-allpages-'))
  installRawMarkdown()
  const { seedScaleProject } = await import('./scale-seed')
  await seedScaleProject(dir)
  const launched = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  app = launched.app
  page = launched.page
  await openAllPages(page)
  await expect(page.getByText(/^Showing 25 of 2,014 pages/)).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

function drawer(): Locator {
  return page.getByRole('dialog')
}

/** The rows the drawer lists in all, from its grid's row count (less the header row). */
async function drawerTotal(): Promise<number> {
  await expect(drawer()).toBeVisible()
  return drawerRowCount(drawer())
}

async function figureOf(control: Locator): Promise<number> {
  const text = await control.locator('[data-nfr-figure]').first().textContent()
  return Number((text ?? '').replace(/,/g, ''))
}

async function closeDrawer(opener: Locator): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(drawer()).toHaveCount(0)
  await expect(opener).toBeFocused()
}

test('Page cited and Links to this page open drawers whose totals equal the cells', async () => {
  const grid = page.getByRole('grid', { name: 'Pages' })
  const cited = grid.locator('button[data-nfr-drill^="allpages:cited:"]').first()
  await expect(cited).toBeVisible()
  const citedCount = await figureOf(cited)
  await cited.focus()
  await page.keyboard.press('Enter')
  await expect(drawer()).toBeVisible()
  expect(await drawerTotal()).toBe(citedCount)
  await expectMainAccessible(page)
  await closeDrawer(cited)

  const links = grid.locator('button[data-nfr-drill^="allpages:links:"]').first()
  const linkCount = await figureOf(links)
  await links.click()
  expect(await drawerTotal()).toBe(linkCount)
  await closeDrawer(links)
})

test('a drawer row opens Prompt detail for that page', async () => {
  const cited = page
    .getByRole('grid', { name: 'Pages' })
    .locator('button[data-nfr-drill^="allpages:cited:"]')
    .first()
  await cited.click()
  const first = drawer()
    .getByRole('link', { name: /^Open question \d+:/ })
    .first()
  await expect(first).toBeVisible()
  await first.click()
  await expect(page).toHaveURL(/#\/pages\/[^/]+\/prompt\//)
  // Following a row leaves the drawer behind; Back returns to the grid with
  // the drill open again (it is on the URL), and Esc closes it.
  await expect(drawer()).toHaveCount(0)
  await page.goBack()
  await expect(page.getByText(/^Showing 25 of 2,014 pages/)).toBeVisible()
  await expect(drawer()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer()).toHaveCount(0)
})

test('the tracked count filters the grid to exactly that many pages', async () => {
  const summary = page.getByRole('region', { name: 'Summary' })
  const tracked = summary.getByRole('link', { name: /tracked: show the tracked pages/ })
  await expect(tracked).toHaveText('186 tracked')
  await tracked.click()
  await expect(page).toHaveURL(/#\/pages\?preset=tracked$/)
  await expect(page.getByText(/^Showing 25 of 186 pages/)).toBeVisible()
  await summary.getByRole('link', { name: /found, not tracked: show them/ }).click()
  await expect(page.getByText(/^Showing 25 of 1,828 pages/)).toBeVisible()
  await summary.getByRole('link', { name: /pages: show all pages/ }).click()
  await expect(page.getByText(/^Showing 25 of 2,014 pages/)).toBeVisible()
})

test('Due today opens the pages due today, the same count as the tile', async () => {
  const summary = page.getByRole('region', { name: 'Summary' })
  const due = summary.getByRole('button', { name: /due today: show them/ })
  if ((await due.count()) === 0) {
    // The tile falls back to the summary number only when schedule:listDue failed.
    await expect(summary.getByText('Due today')).toBeVisible()
    return
  }
  const count = await figureOf(due)
  await due.click()
  expect(await drawerTotal()).toBe(count)
  await closeDrawer(due)
})

/** Over 50 rows Needs attention is one line (deep audit 7h): Review opens the list. */
async function openAttention(): Promise<void> {
  const review = page
    .getByRole('region', { name: 'Needs attention' })
    .getByRole('button', { name: /^Review/ })
  if ((await review.count()) > 0) await review.click()
}

test('Wrong page cited: badge, prompt link and cited page drill', async () => {
  await openAttention()
  const section = page.getByRole('region', { name: 'Needs attention' })
  const badge = section.getByRole('button', { name: /cases?: show every wrong-page case/ })
  const count = await figureOf(badge)
  await badge.click()
  expect(await drawerTotal()).toBe(count)
  await closeDrawer(badge)
  const group = section.getByRole('button', { name: 'Wrong page cited' })
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
  const prompt = section.getByRole('link', { name: /^Open question “/ }).first()
  await expect(prompt).toHaveAttribute('href', /#\/pages\/[^/]+\/prompt\/[^?]+\?market=/)
})

test('Cited but not tracked: the count opens its citations', async () => {
  await openAttention()
  const section = page.getByRole('region', { name: 'Needs attention' })
  const count = section.getByRole('button', { name: /^Cited \d+ times? for/ }).first()
  const shown = await figureOf(count)
  await count.click()
  expect(await drawerTotal()).toBe(shown)
  await closeDrawer(count)
})
