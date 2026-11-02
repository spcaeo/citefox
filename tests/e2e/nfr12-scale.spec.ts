import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { CiteFoxApi } from '@shared/ipc'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages } from './nav-helpers'

/**
 * NFR-12 and FR-20.1: All pages with 2,014 pages (TextBolt's sitemap), 186
 * tracked and 40 checked through the real IPC handlers. Search, sort and
 * filter SHOULD update in under 300 ms with virtualized rows. Times are taken
 * inside the renderer, from the input event to the committed DOM plus a frame.
 */
const BUDGET_MS = 300
/** Not an SRS number: the first paint of All pages, IPC included. */
const FIRST_RENDER_BUDGET_MS = 3000

let app: ElectronApplication
let page: Page
let dir: string
const timings: Record<string, number | number[] | string> = {}
/** Mirrors `SCALE` in scale-seed.ts, which loads only after the raw-markdown hook. */
const SCALE = { projectId: 'proj-scale', total: 2014 } as const

test.beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-nfr12-'))
  installRawMarkdown()
  const { seedScaleProject } = await import('./scale-seed')
  const { seedMs } = await seedScaleProject(dir)
  timings.seedMs = seedMs
  const launched = await launchCiteFox({ userDataDir: dir, viewport: { width: 1280, height: 900 } })
  app = launched.app
  page = launched.page
  await openAllPages(page)
})

test.afterAll(async () => {
  await writeFile(await e2eArtifact('nfr12-timings.json'), JSON.stringify(timings, null, 2))
  console.log('NFR-12 timings', JSON.stringify(timings))
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

type Action = 'sortScore' | 'shiftSortStatus' | 'filterTracked' | 'showAll'

/** Runs one action in the page and resolves after React commits and the next frame paints. */
async function timed(name: string, action: Action): Promise<number> {
  const ms = await page.evaluate(async (which) => {
    const header = (label: string): HTMLElement => {
      const found = [...document.querySelectorAll<HTMLElement>('.ui-lg-sort')].find((button) =>
        (button.textContent ?? '').startsWith(label)
      )
      if (!found) throw new Error(`No ${label} header`)
      return found
    }
    const started = performance.now()
    if (which === 'sortScore') header('Score').click()
    if (which === 'shiftSortStatus') {
      header('Status').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    }
    if (which === 'filterTracked') {
      const status = [
        ...document.querySelectorAll<HTMLElement>('[aria-label="Page filters"] fieldset')
      ].find((set) => set.querySelector('legend')?.textContent === 'Status')
      const label = [...(status?.querySelectorAll<HTMLElement>('label') ?? [])].find((item) =>
        (item.textContent ?? '').startsWith('Tracked')
      )
      label?.querySelector('input')?.click()
    }
    if (which === 'showAll') {
      const pages = document.querySelector('[role="grid"][aria-label="Pages"]')?.closest('.ui-lg')
      ;[...(pages?.querySelectorAll<HTMLElement>('.ui-lg-foot button') ?? [])]
        .find((button) => (button.textContent ?? '').startsWith('Show all'))
        ?.click()
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    return performance.now() - started
  }, action)
  timings[name] = Math.round(ms * 10) / 10
  return ms
}

test('All pages renders 2,014 pages and says how many it shows', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/settings'
  })
  await expect(page.getByRole('heading', { level: 1, name: 'App settings' })).toBeVisible()
  const ms = await page.evaluate(async () => {
    const started = performance.now()
    window.location.hash = '#/pages'
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const status = [...document.querySelectorAll('[role="status"]')].some((node) =>
          /Showing 25 of 2,014 pages/.test(node.textContent ?? '')
        )
        if (status && document.querySelector('[role="grid"] [data-line="0"]')) resolve()
        else requestAnimationFrame(tick)
      }
      tick()
    })
    return performance.now() - started
  })
  timings.firstRenderMs = Math.round(ms)
  const ipc = await page.evaluate(async (projectId) => {
    const started = performance.now()
    const data = await (window as unknown as { citefox: CiteFoxApi }).citefox['allpages:list']({
      projectId
    })
    return { ms: performance.now() - started, rows: data.rows.length }
  }, SCALE.projectId)
  timings.allPagesListIpcMs = Math.round(ipc.ms)
  const review = await page.evaluate(async (projectId) => {
    const started = performance.now()
    const data = await (window as unknown as { citefox: CiteFoxApi }).citefox['allpages:citations'](
      { projectId }
    )
    return { ms: performance.now() - started, wrong: data.wrongPage.length }
  }, SCALE.projectId)
  timings.citationsIpcMs = Math.round(review.ms)
  const cited = await page.evaluate(async (projectId) => {
    const started = performance.now()
    const data = await (window as unknown as { citefox: CiteFoxApi }).citefox[
      'allpages:citedPages'
    ]({ projectId })
    return { ms: performance.now() - started, rows: data.rows.length }
  }, SCALE.projectId)
  timings.citedPagesIpcMs = Math.round(cited.ms)
  timings.citedPagesRows = cited.rows
  const scores = await page.evaluate(async (projectId) => {
    const started = performance.now()
    await (window as unknown as { citefox: CiteFoxApi }).citefox['scores:listPages']({ projectId })
    return performance.now() - started
  }, SCALE.projectId)
  timings.scoresListPagesIpcMs = Math.round(scores)
  expect(ipc.rows).toBe(SCALE.total)
  expect(review.wrong).toBeGreaterThan(0)
  expect(cited.rows).toBeGreaterThan(0)
  const summary = page.getByRole('region', { name: 'Summary' })
  await expect(summary.getByText('2,014', { exact: true })).toBeVisible()
  await expect(summary.getByText('186 tracked · 1,828 found, not tracked')).toBeVisible()
  // Over a 2,014-row grid Needs attention starts as one line (deep audit 7h).
  const attention = page.getByRole('region', { name: 'Needs attention' })
  await expect(attention.getByText(/wrong-page cases? on/)).toBeVisible()
  await expect(attention.getByRole('button', { name: /^Review/ })).toBeVisible()
  await page.screenshot({ path: await e2eArtifact('nfr12-all-pages-2014-1280.png') })
  expect(ms).toBeLessThan(FIRST_RENDER_BUDGET_MS)
})

test('at 1440×900 the Pages grid header is above the fold (UI audit P4)', async () => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
  const header = page.getByRole('grid', { name: 'Pages' }).getByRole('columnheader').first()
  await expect(header).toBeVisible()
  const box = await header.boundingBox()
  timings.pagesHeaderBottom1440 = Math.round(box?.y ?? 0) + Math.round(box?.height ?? 0)
  await page.screenshot({ path: await e2eArtifact('nfr12-all-pages-2014-1440.png') })
  expect(box).not.toBeNull()
  expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThanOrEqual(900)
  await page.setViewportSize({ width: 1280, height: 900 })
})

test('sort, Shift-sort, filter and search each update in under 300 ms', async () => {
  const grid = page.getByRole('grid', { name: 'Pages' })
  const score = grid.getByRole('columnheader', { name: /^Score/ })
  const sortScore = await timed('sortScoreMs', 'sortScore')
  await expect(score).toHaveAttribute('aria-sort', 'none')
  const shiftSort = await timed('shiftSortStatusMs', 'shiftSortStatus')
  await expect(grid.getByRole('columnheader', { name: /^Status/ })).toHaveAttribute(
    'aria-sort',
    'ascending'
  )
  const views = page.getByRole('button', { name: 'Views' })
  await views.evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await views.click()
  await page.getByRole('menuitem', { name: /^Filters/ }).click()
  const panel = page.getByRole('region', { name: 'Page filters' })
  await expect(panel).toBeVisible()
  const filter = await timed('filterTrackedMs', 'filterTracked')
  await expect(page.getByText(/^Showing 25 of 40 pages/)).toBeVisible()
  await panel.getByRole('button', { name: 'Clear all filters' }).click()
  await panel.getByRole('button', { name: 'Done' }).click()

  const keys = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="search"][placeholder="Search pages by title or URL"]'
    )
    if (!input) throw new Error('search box missing')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    const results: number[] = []
    let text = ''
    for (const char of 'pricing') {
      text += char
      const started = performance.now()
      setter?.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      // The list renders the search on the next frames (a deferred value): wait for them.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => resolve()), 0))
      )
      results.push(performance.now() - started)
    }
    return results
  })
  timings.searchKeystrokeMs = keys.map((value) => Math.round(value * 10) / 10)
  await expect(page.getByText(/in all, filtered/)).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search pages by title or URL' }).fill('')
  expect(sortScore).toBeLessThan(BUDGET_MS)
  expect(shiftSort).toBeLessThan(BUDGET_MS)
  expect(filter).toBeLessThan(BUDGET_MS)
  expect(Math.max(...keys)).toBeLessThan(BUDGET_MS)
})

test('Show all renders a window of rows and scrolls 2,014 pages smoothly', async () => {
  const showAll = await timed('showAllMs', 'showAll')
  await expect(page.getByText(/^Showing 2,014 pages/)).toBeVisible()
  const rendered = await page.locator('[role="grid"] [data-line]').count()
  timings.renderedRowsWithAll = rendered
  const frames = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>('[role="grid"][aria-label="Pages"]')
    if (!grid) throw new Error('grid missing')
    const deltas: number[] = []
    let last = performance.now()
    const steps = 40
    for (let step = 1; step <= steps; step += 1) {
      grid.scrollTop = (grid.scrollHeight * step) / steps
      grid.dispatchEvent(new Event('scroll'))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const now = performance.now()
      deltas.push(now - last)
      last = now
    }
    return deltas
  })
  timings.scrollFrameAvgMs =
    Math.round((frames.reduce((a, b) => a + b, 0) / frames.length) * 10) / 10
  timings.scrollFrameMaxMs = Math.round(Math.max(...frames) * 10) / 10
  await expect(page.locator('[role="grid"] [data-line="2013"]')).toBeAttached()
  await page.screenshot({ path: await e2eArtifact('nfr12-all-pages-scrolled-1280.png') })
  expect(rendered).toBeLessThan(120)
  expect(showAll).toBeLessThan(BUDGET_MS)
  expect(Math.max(...frames)).toBeLessThan(BUDGET_MS)
})
