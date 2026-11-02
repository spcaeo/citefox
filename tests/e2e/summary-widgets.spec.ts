import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { settle } from './a11y-helpers'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash, type SeededApp } from './screens-app'

/**
 * Summary as widgets end to end (owner-approved mock-up, 2026-10-30): Edit mode on the
 * URL, add from the gallery, resize, reorder by keyboard and by pointer, remove with
 * Undo, a role preset, each widget's own engine filter, Pin to Summary from a question,
 * and the layout kept after a reload. Screenshots in Sepia, Light and Dark go to
 * test-results/e2e/widgets/. Stored checks only: nothing spends a search.
 */

const HIDE =
  '.gd-float,.gd-pop,.gd-coach,.gd-dim,.gd-mask,.gd-hint-layer,.gd-callout,[aria-label="CiteFox work console"],[data-testid="guide-explainer"]{display:none!important}'

type Theme = 'sepia' | 'light' | 'dark'

const errors: string[] = []

async function openApp(): Promise<SeededApp> {
  installRawMarkdown()
  const { seedEnginesProject } = await import('./engines-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-widgets-'))
  await seedEnginesProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.log(`[widgets] page error: ${error.stack ?? error.message}`)
  })
  await openAllPages(page)
  return {
    app,
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate(async (choice) => {
    const api = (
      window as unknown as {
        citefox: { 'settings:update': (patch: { theme: string }) => Promise<unknown> }
      }
    ).citefox
    await api['settings:update']({ theme: choice })
  }, theme)
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  await page.waitForTimeout(250)
}

/** One screenshot per theme, ending on Sepia (the default). */
async function shots(page: Page, name: string, full = false): Promise<void> {
  for (const theme of ['light', 'dark', 'sepia'] as const) {
    await setTheme(page, theme)
    if (full) await page.locator('#main').evaluate((node) => node.scrollTo(0, 0))
    await page.screenshot({ path: await e2eArtifact(`widgets/${name}-${theme}.png`) })
    if (full) {
      await page.locator('#main').evaluate((node) => node.scrollTo(0, node.scrollHeight))
      await page.waitForTimeout(150)
      await page.screenshot({ path: await e2eArtifact(`widgets/${name}-${theme}-bottom.png`) })
      await page.locator('#main').evaluate((node) => node.scrollTo(0, 0))
    }
  }
}

function kinds(page: Page): Promise<(string | null)[]> {
  return page
    .locator('#main [data-widget-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-kind')))
}

function cell(page: Page, kind: string): Locator {
  return page.locator(`#main [data-widget-id][data-kind="${kind}"]`).first()
}

function hashParams(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

/** The rows the open drill drawer lists in all. */
async function drawerRows(dialog: Locator): Promise<number> {
  const more = dialog.getByRole('button', { name: /^Show all \d/ })
  if ((await more.count()) > 0) await more.click()
  const grid = dialog.getByRole('grid')
  if ((await grid.count()) === 0) return 0
  return Number(await grid.first().getAttribute('aria-rowcount')) - 1
}

/** Every number in a widget opens a drawer with exactly that many rows. */
async function drillEvery(page: Page, scope: Locator, prefix: string): Promise<number> {
  const controls = scope.locator('[data-drill-open], button.drill-num')
  const count = await controls.count()
  let opened = 0
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index)
    if (!(await control.isVisible())) continue
    const figure = control.locator('[data-nfr-figure]')
    const shown =
      (await figure.count()) > 0
        ? Number((await figure.first().textContent())?.replace(/[,\s]/g, ''))
        : null
    await control.scrollIntoViewIfNeeded()
    await control.click()
    const dialog = page.locator('[data-drill]')
    await expect(dialog).toBeVisible()
    if (shown !== null && !Number.isNaN(shown)) expect(await drawerRows(dialog)).toBe(shown)
    await page.waitForTimeout(120)
    await page.screenshot({
      path: await e2eArtifact(`widgets/drill-${prefix}-${String(index).padStart(2, '0')}.png`)
    })
    opened += 1
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
  return opened
}

test('Summary widgets: edit, add, resize, reorder, remove, presets, engines, pin and keep', async () => {
  test.setTimeout(420_000)
  const { page, close } = await openApp()
  try {
    await openHash(page, '#/overview')
    await settle(page)
    await page.addStyleTag({ content: HIDE })
    const main = page.locator('#main')
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    // Today's Summary is the default board.
    await expect
      .poll(() => kinds(page))
      .toEqual(['headline', 'results', 'trend', 'cited-sites', 'next-fixes', 'changes'])
    await expect(main.getByRole('link', { name: 'See the Impact review →' })).toBeVisible()
    await shots(page, '01-default', true)
    // Under All the carried-over widgets count each question once, cited when any engine
    // cites you (owner option A), in AI answer words; each number opens exactly its rows.
    await expect(cell(page, 'headline')).toContainText('AI answer shows')
    await expect(cell(page, 'headline')).not.toContainText('AI Overview')
    await expect(cell(page, 'results')).not.toContainText('AI Overview')
    expect(await drillEvery(page, cell(page, 'headline'), 'all-headline')).toBeGreaterThan(0)
    // Google AI Overview keeps Summary's own Google numbers and words.
    await openHash(page, '#/overview?engine=google_aio')
    await expect(cell(page, 'headline')).toContainText('AI Overview shows')
    await page.locator('#main').evaluate((node) => node.scrollTo(0, 0))
    await page.screenshot({ path: await e2eArtifact('widgets/01-google-sepia.png') })
    await page.locator('#main').evaluate((node) => node.scrollTo(0, node.scrollHeight))
    await page.waitForTimeout(150)
    await page.screenshot({ path: await e2eArtifact('widgets/01-google-sepia-bottom.png') })
    await openHash(page, '#/overview')
    await expect(cell(page, 'headline')).toContainText('AI answer shows')

    // Edit mode is on the URL.
    await main.getByRole('button', { name: 'Edit widgets' }).click()
    await expect.poll(() => hashParams(page)).toContain('edit=1')
    await expect(
      main.getByRole('button', { name: 'Move Headline numbers', exact: true })
    ).toBeVisible()
    await shots(page, '02-edit')

    // Reorder by keyboard: the handle keeps focus as the widget moves.
    const handle = main.getByRole('button', { name: 'Move Headline numbers', exact: true })
    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await kinds(page)).slice(0, 2)).toEqual(['results', 'headline'])
    await expect(handle).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await kinds(page)).slice(0, 2)).toEqual(['headline', 'results'])

    // Reorder by pointer: drag Next fixes onto Headline numbers.
    const from = await main
      .getByRole('button', { name: 'Move Next fixes', exact: true })
      .boundingBox()
    const to = await cell(page, 'headline').boundingBox()
    if (from === null || to === null) throw new Error('No boxes to drag between')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 3, to.y + to.height / 2, { steps: 12 })
    await page.screenshot({ path: await e2eArtifact('widgets/03-dragging-sepia.png') })
    await page.mouse.up()
    await expect.poll(async () => (await kinds(page))[0]).toBe('next-fixes')

    // Resize with the size buttons and by key.
    await main
      .getByRole('group', { name: 'Size of Who gets cited' })
      .getByRole('button', { name: 'Wide' })
      .click()
    await expect(cell(page, 'cited-sites')).toHaveAttribute('data-size', 'w')
    await main.getByRole('button', { name: 'Move Who gets cited', exact: true }).focus()
    await page.keyboard.press('m')
    await expect(cell(page, 'cited-sites')).toHaveAttribute('data-size', 'm')

    // Remove with Undo.
    await main.getByRole('button', { name: 'Remove Results at a glance' }).click()
    await expect.poll(() => kinds(page)).not.toContain('results')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => kinds(page)).toContain('results')

    // Add from the gallery: every new widget.
    for (const name of [
      'Cited rate',
      'Engines side by side',
      'Fixes working',
      'Competitor watch',
      'Google updates',
      'Searches and credits',
      'Page changes nobody logged',
      'A pinned question'
    ]) {
      await main.getByRole('button', { name: 'Add widget' }).click()
      const gallery = page.getByRole('dialog', { name: 'Add a widget' })
      await expect(gallery).toBeVisible()
      if (name === 'Cited rate') {
        await expect.poll(() => hashParams(page)).toContain('add=1')
        await page.waitForTimeout(300)
        await page.screenshot({ path: await e2eArtifact('widgets/04-gallery-sepia.png') })
      }
      await gallery.getByRole('button', { name: `Add ${name}` }).click()
      await expect(gallery).toHaveCount(0)
    }
    await expect.poll(async () => (await kinds(page)).length).toBe(14)
    await main.getByRole('button', { name: 'Done' }).click()
    await expect.poll(() => hashParams(page)).not.toContain('edit=1')
    await settle(page)
    await shots(page, '05-every-widget', true)

    // Each widget has its own engine filter: Cited rate on ChatGPT, Headline stays All.
    const rate = cell(page, 'cited-rate')
    await rate.getByRole('button', { name: /^Engine for Cited rate/ }).click()
    await page.getByRole('menuitemradio', { name: 'ChatGPT' }).click()
    await expect(
      rate.getByRole('button', { name: /^Engine for Cited rate: ChatGPT/ })
    ).toBeVisible()
    await expect(
      main
        .getByRole('group', { name: 'Engine for Headline numbers' })
        .getByRole('button', { name: 'All' })
    ).toHaveAttribute('aria-pressed', 'true')
    const engines = main.getByRole('group', { name: 'Engine for Who gets cited' })
    await engines.getByRole('button', { name: 'ChatGPT' }).click()
    await expect(
      cell(page, 'cited-sites').getByText(/twilio\.com|No answer on ChatGPT/)
    ).toBeVisible()
    await shots(page, '06-engines')

    // Every number in the new widgets opens exactly its rows.
    let drills = 0
    for (const kind of ['cited-rate', 'engines', 'competitor', 'question', 'cited-sites']) {
      drills += await drillEvery(page, cell(page, kind), kind)
    }
    console.log(`[widgets] ${drills} widget drills opened`)
    expect(drills).toBeGreaterThan(2)

    // Kept after a reload: the order, the sizes and each widget's engine.
    const before = await kinds(page)
    await page.reload()
    await openAllPages(page)
    await openHash(page, '#/overview')
    await settle(page)
    await page.addStyleTag({ content: HIDE })
    await expect.poll(() => kinds(page)).toEqual(before)
    await expect(
      cell(page, 'cited-rate').getByRole('button', { name: /^Engine for Cited rate: ChatGPT/ })
    ).toBeVisible()

    // A role preset fills the board; Undo brings the old one back.
    await openHash(page, '#/overview?edit=1&add=1')
    const gallery = page.getByRole('dialog', { name: 'Add a widget' })
    await gallery.getByRole('button', { name: 'Use the SEO executive layout' }).click()
    await expect
      .poll(async () => (await kinds(page)).slice(0, 3))
      .toEqual(['headline', 'trend', 'cited-rate'])
    await main.getByRole('button', { name: 'Done' }).click()
    await settle(page)
    await shots(page, '07-preset-executive', true)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => kinds(page)).toEqual(before)

    // Pin to Summary from a question screen: the gallery pinned question 1, so pin 2.
    await openHash(page, '#/pages/page-1/prompt/prompt-2?market=mkt-us')
    const pin = page.getByRole('button', { name: 'Pin this question to Summary' })
    await expect(pin).toBeVisible()
    await pin.click()
    await expect(page.getByText('Pinned this question to Summary.')).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('widgets/08-pinned-sepia.png') })
    // A second pin says it is there already.
    await pin.click()
    await expect(page.getByText('This question is on your Summary already.')).toBeVisible()
    // From Citations too.
    await openHash(page, '#/citations')
    await page.getByRole('button', { name: 'Pin who gets cited to Summary' }).click()
    await expect(page.getByText(/who gets cited/i).last()).toBeVisible()
    await openHash(page, '#/overview')
    await settle(page)
    await expect
      .poll(async () => (await kinds(page)).filter((kind) => kind === 'question').length)
      .toBe(2)
    await page.locator('#main [data-kind="question"]').last().scrollIntoViewIfNeeded()
    await expect(
      page
        .locator('#main [data-kind="question"]')
        .last()
        .getByText('Which plan covers scheduled texts?')
    ).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('widgets/08-pinned-on-summary-sepia.png') })

    // A narrow window: two columns, then one.
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: await e2eArtifact('widgets/09-narrow-sepia.png') })
    await page.setViewportSize({ width: 1440, height: 900 })

    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await close()
  }
})
