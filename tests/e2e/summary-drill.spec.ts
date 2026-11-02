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
 * Summary drill-downs end to end (owner, 2026-11-01): every number, chip, chart point
 * and count on Summary opens a drawer over Summary with exactly the rows it counts
 * (`drawer=drill&drill=<id>`), Back closes it and Forward reopens it, and a page fix in
 * the fixes drawer opens its own drawer on top. Every drawer is screenshotted into
 * test-results/e2e/summary-drill/. Stored checks and answers only: nothing spends a search.
 */

const HIDE =
  '.gd-float,.gd-pop,.gd-coach,.gd-dim,.gd-mask,.gd-hint-layer,.gd-callout,[aria-label="CiteFox work console"],[data-testid="guide-explainer"]{display:none!important}'

const errors: string[] = []

async function openEnginesApp(): Promise<SeededApp> {
  installRawMarkdown()
  const { seedEnginesProject } = await import('./engines-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-summary-drill-'))
  await seedEnginesProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  // A drawer that fails to draw shows here (and fails the test at the end).
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.log(`[summary-drill] page error: ${error.stack ?? error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[summary-drill] console: ${message.text()}`)
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

/** The Progress seed: a check Oct 5, a fix live Oct 8 with its follow-up, a check Oct 19. */
async function openProgressApp(): Promise<SeededApp> {
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-summary-drill-progress-'))
  await seedProgressProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  page.on('pageerror', (error) => errors.push(error.message))
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

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`summary-drill/${name}.png`) })
}

function drillParam(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const hash = window.location.hash
    const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    return new URLSearchParams(query).get('drill')
  })
}

/** Every control in the main pane that opens a drill, in reading order. */
function drillControls(main: Locator): Locator {
  return main.locator('[data-drill-open], button.drill-num, a[href*="drawer=drill"]')
}

/** The rows the open drill drawer lists in all. */
async function drawerRows(dialog: Locator): Promise<number> {
  const more = dialog.getByRole('button', { name: /^Show all \d/ })
  if ((await more.count()) > 0) await more.click()
  const grid = dialog.getByRole('grid')
  if ((await grid.count()) === 0) return 0
  return Number(await grid.first().getAttribute('aria-rowcount')) - 1
}

/** The number a control shows (its figure), or null for a chip or a link without one. */
async function shownNumber(control: Locator): Promise<number | null> {
  const text = (await control.innerText())
    .replace(/,/g, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
  const figure = control.locator('[data-nfr-figure]')
  if ((await figure.count()) > 0) {
    return Number((await figure.first().textContent())?.replace(/[,\s]/g, '') ?? '')
  }
  const lead = /^(\d+)\b/.exec(text)
  const isChip = /^[+−-]|since|%/.test(text)
  return lead && !isChip ? Number(lead[1]) : null
}

/**
 * Clicks each drill control on the screen in turn: the drawer opens over Summary on the
 * URL, lists as many rows as the number says, and is screenshotted; Escape closes it.
 * Returns the drill ids opened.
 */
async function openEvery(page: Page, prefix: string): Promise<string[]> {
  const main = page.locator('#main')
  const controls = drillControls(main)
  const count = await controls.count()
  expect(count).toBeGreaterThan(0)
  const opened: string[] = []
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index)
    if (!(await control.isVisible())) continue
    const html = await control.evaluate((node) => node.outerHTML.slice(0, 300))
    const expected = await shownNumber(control)
    await control.scrollIntoViewIfNeeded()
    await control.click()
    const dialog = page.locator('[data-drill]')
    try {
      await expect(dialog).toBeVisible()
    } catch (error) {
      await shot(page, `${prefix}-${String(index).padStart(2, '0')}-FAILED`)
      console.log(`[summary-drill] ${prefix} #${index} did not open (${page.url()}): ${html}`)
      throw error
    }
    const id = (await drillParam(page)) ?? `unknown-${index}`
    expect(page.url()).toMatch(/#\/overview\?.*drawer=drill&drill=/)
    if (expected !== null) expect(await drawerRows(dialog), id).toBe(expected)
    await expect(dialog.getByText('Error', { exact: false })).toHaveCount(0)
    await page.waitForTimeout(150)
    await shot(
      page,
      `${prefix}-${String(index).padStart(2, '0')}-${id.replace(/[^a-z0-9]+/gi, '-')}`
    )
    opened.push(id)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
  return opened
}

test('Summary: every number drills into a drawer over Summary, with Back and Forward', async () => {
  test.setTimeout(300_000)
  const { page, close } = await openEnginesApp()
  try {
    await openHash(page, '#/overview')
    await settle(page)
    await page.addStyleTag({ content: HIDE })
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Results at a glance' })).toBeVisible()
    await shot(page, '00-summary')
    await page.locator('#main').evaluate((node) => node.scrollTo(0, node.scrollHeight))
    await shot(page, '00-summary-bottom')
    await page.locator('#main').evaluate((node) => node.scrollTo(0, 0))

    const opened = await openEvery(page, 'all')
    console.log(`[summary-drill] All: ${opened.length} drills: ${opened.join(', ')}`)
    // Under All (owner option A) the carried-over widgets read the shared metrics: the
    // headline, results and each trend point drill to their rows.
    expect(opened).toContain('w:headline:all:cited')
    expect(opened).toContain('w:results:all:target')
    expect(opened.some((id) => id.startsWith('w:trend:all:'))).toBe(true)
    await expect(page.locator('#main [data-kind="headline"]')).not.toContainText('AI Overview')

    // Google AI Overview keeps Summary's own numbers: this week and each week's point.
    await openHash(page, '#/overview?engine=google_aio')
    await settle(page)
    await expect(page.locator('#main [data-kind="headline"]')).toContainText('AI Overview shows')
    await shot(page, '00-summary-google')
    const google = await openEvery(page, 'google')
    console.log(`[summary-drill] Google: ${google.length} drills: ${google.join(', ')}`)
    expect(google).toContain('week:0')
    expect(google).toContain('week:1')
    await openHash(page, '#/overview')
    await settle(page)

    // Back closes a drill and Forward reopens it, on the same Summary.
    const first = drillControls(page.locator('#main')).first()
    await first.click()
    const dialog = page.locator('[data-drill]')
    await expect(dialog).toBeVisible()
    await page.goBack()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/#\/overview(\?(?!.*drawer=).*)?$/)
    await page.goForward()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Every page fix opens over Summary; a fix opens its own drawer on top.
    const fixes = page.locator('#main').getByRole('button', { name: /page fixes?: open them$/ })
    if ((await fixes.count()) > 0) {
      await fixes.first().click()
      const list = page.locator('[data-drill="fixes:all"]')
      await expect(list).toBeVisible()
      await list.getByRole('row').nth(1).click()
      const fix = page.getByRole('dialog', {
        name: /Improve a page|Pick which page|Write a new page/
      })
      await expect(fix).toBeVisible()
      await expect(page).toHaveURL(/drawer=drill&drill=fixes%3Aall&drawer=page-fix&pfx\.id=/)
      await page.waitForTimeout(300)
      await shot(page, 'all-fix-over-fixes')
      await page.goBack()
      await expect(fix).toHaveCount(0)
      await expect(list).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(list).toHaveCount(0)
    } else {
      console.log('[summary-drill] no page fixes in this seed')
    }

    // How we measure: its count opens every tracked question.
    await page.getByRole('button', { name: 'How we measure' }).click()
    const method = page.getByRole('dialog', { name: 'How we measure' })
    await expect(method).toBeVisible()
    await method.locator('button.drill-num').first().click()
    await expect(page.locator('[data-drill="kpi:tracked"]')).toBeVisible()
    await page.waitForTimeout(150)
    await shot(page, 'method-tracked')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // One engine picked: its numbers and small print drill too.
    await openHash(page, '#/overview?engine=chatgpt')
    await settle(page)
    await expect(page.getByRole('region', { name: 'Headline numbers on ChatGPT' })).toBeVisible()
    await shot(page, '00-summary-chatgpt')
    const engine = await openEvery(page, 'chatgpt')
    console.log(`[summary-drill] ChatGPT: ${engine.length} drills: ${engine.join(', ')}`)
    expect(engine).toContain('engine:chatgpt:gained')
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await close()
  }
})

test('Summary after a change: the change chips and "since the first check" open what moved', async () => {
  test.setTimeout(300_000)
  errors.length = 0
  const { page, close } = await openProgressApp()
  try {
    await openHash(page, '#/overview')
    await settle(page)
    await page.addStyleTag({ content: HIDE })
    await expect(page.getByRole('region', { name: 'Results at a glance' })).toBeVisible()
    await shot(page, '00-progress-summary')
    const opened = await openEvery(page, 'progress')
    console.log(`[summary-drill] Progress: ${opened.length} drills: ${opened.join(', ')}`)
    // This project checks Google only, so All is Google: Summary's own change chips.
    expect(opened.some((id) => /^kpi:(aio|cited|named):moved$|^week:change$/.test(id))).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await close()
  }
})
