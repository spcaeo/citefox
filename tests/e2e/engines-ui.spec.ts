import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, shot, type SeededApp } from './screens-app'

/**
 * Multi-engine screens (Engines.dc.html panels 2 and 3) on stored cloro answers: the
 * engine filter and a dot per engine on Questions and Summary, kept in the URL with Back
 * and Forward, and a tab per engine on the question detail (answer, sources, and
 * Perplexity's unavailable state). No live calls: the answers are seeded.
 */

async function openEnginesApp(): Promise<SeededApp> {
  installRawMarkdown()
  const { seedEnginesProject } = await import('./engines-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-engines-'))
  await seedEnginesProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
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

function hashParam(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => {
    const hash = window.location.hash
    return new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '').get(
      name
    )
  }, key)
}

/** Every scroller in the main pane (itself included) whose content is wider than it is. */
async function sideways(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const top = document.querySelector('#main')
    if (!top) return ['#main not found']
    return [top, ...top.querySelectorAll('*')]
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .filter((node) => {
        const scrolls = node === top || /auto|scroll/.test(getComputedStyle(node).overflowX)
        return scrolls && node.scrollWidth - node.clientWidth > 1
      })
      .map(
        (node) =>
          `${node.tagName.toLowerCase()}.${node.className} ${node.scrollWidth}>${node.clientWidth}`
      )
  })
}

/** Light and dark shots at the owner's two widths, with no sideways scroll at either. */
async function shots(page: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1134, height: 770 }
    ]) {
      await page.setViewportSize(size)
      await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
      await shot(page, `engines-${name}-${scheme}-${size.width}`)
      expect(await sideways(page), `${name} ${scheme} at ${size.width}px`).toEqual([])
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.describe('engines UI', () => {
  let seeded: SeededApp

  test.beforeAll(async () => {
    seeded = await openEnginesApp()
  })

  test.afterAll(async () => {
    await seeded?.close()
  })

  test('Questions: engine filter and dots, kept in the URL with Back and Forward', async () => {
    const { page } = seeded
    await openHash(page, '#/questions?group=none')
    const main = page.locator('#main')
    const filter = main.getByRole('group', { name: 'Engine' })
    await expect(filter).toBeVisible()
    // "All" in words, each engine as its logo alone, named for screen readers.
    await expect(filter.getByRole('button')).toHaveText(['All', '', '', ''])
    for (const name of ['Google', 'ChatGPT', 'Perplexity'])
      await expect(filter.getByRole('button', { name, exact: true })).toBeVisible()
    const grid = main.getByRole('grid', { name: 'Questions' })
    await expect(grid.getByRole('columnheader', { name: /Engines/ })).toBeVisible()
    await expect(
      grid.getByRole('img', { name: /ChatGPT: Not cited; Perplexity: Unavailable$/ })
    ).toBeVisible()
    await expect(
      grid.getByRole('img', { name: /ChatGPT: Cited; Perplexity: Unavailable$/ })
    ).toBeVisible()
    await expect(main.getByRole('list', { name: 'What the engine dots mean' })).toBeVisible()
    await expectMainAccessible(page)
    await shots(page, 'questions-all')

    await filter.getByRole('button', { name: 'ChatGPT' }).click()
    expect(await hashParam(page, 'engine')).toBe('chatgpt')
    const kpis = main.getByRole('region', { name: 'Questions summary on ChatGPT' })
    await expect(kpis.getByRole('region', { name: 'ChatGPT answered' })).toContainText('2')
    await expect(kpis.getByRole('region', { name: 'Cited' })).toContainText('1 of 2')
    await expect(grid.getByRole('columnheader', { name: /ChatGPT/ })).toBeVisible()
    await expect(grid.getByRole('columnheader', { name: /Engines/ })).toHaveCount(0)
    await expect(grid.getByText('Not cited', { exact: true })).toBeVisible()
    await expectMainAccessible(page)
    await shots(page, 'questions-chatgpt')

    await page.goBack()
    await expect(main.getByRole('region', { name: 'Questions summary' })).toBeVisible()
    expect(await hashParam(page, 'engine')).toBeNull()
    await expect(grid.getByRole('columnheader', { name: /Engines/ })).toBeVisible()
    await page.goForward()
    await expect(main.getByRole('region', { name: 'Questions summary on ChatGPT' })).toBeVisible()

    // A row opens the question on the picked engine's tab.
    await grid.getByText('How do I alert the crew without a developer?').click()
    await expect(page.getByTestId('engine-answer')).toHaveAttribute('data-engine', 'chatgpt')
    expect(await hashParam(page, 'eng')).toBe('chatgpt')
  })

  test('Summary: each widget follows its own engine filter', async () => {
    const { page } = seeded
    await openHash(page, '#/overview')
    const main = page.locator('#main')
    // No per-engine strip under All: each widget's engine filter picks an engine.
    await expect(main.getByRole('region', { name: 'Headline numbers' })).toBeVisible()
    await expect(main.getByRole('region', { name: 'Cited on each engine' })).toHaveCount(0)
    await expectMainAccessible(page)
    await shots(page, 'summary-all')

    const filter = main.getByRole('group', { name: 'Engine for Headline numbers' })
    await filter.getByRole('button', { name: /ChatGPT/ }).click()
    const kpis = main.getByRole('region', { name: 'Headline numbers on ChatGPT' })
    await expect(kpis.getByRole('region', { name: 'You’re cited' })).toContainText('1 gained')
    // The other widgets keep their own engine.
    await expect(main.getByRole('region', { name: 'Results at a glance' })).toBeVisible()
    await expectMainAccessible(page)
    await shots(page, 'summary-chatgpt')

    // A link's ?engine= sets every widget at once, said once above them.
    await openHash(page, '#/overview?engine=perplexity')
    await expect(main.getByText(/Every widget shows Perplexity/)).toBeVisible()
    await main.getByRole('button', { name: 'Show each widget’s own engine' }).click()
    await expect.poll(() => hashParam(page, 'engine')).toBeNull()
    await expect(main.getByRole('region', { name: 'Headline numbers on ChatGPT' })).toBeVisible()
    await filter.getByRole('button', { name: 'All' }).click()
    await expect(main.getByRole('region', { name: 'Headline numbers' })).toBeVisible()
  })

  test('Question detail: a tab per engine with its answer, sources and the unavailable state', async () => {
    const { page } = seeded
    await openHash(page, '#/pages/page-1/prompt/prompt-1?market=mkt-us')
    const main = page.locator('#main')
    const tabs = main.getByRole('tablist', { name: 'Engines' })
    await expect(tabs.getByRole('tab')).toHaveText(['Google AI Overview', 'ChatGPT', 'Perplexity'])
    await expect(tabs.getByRole('tab', { name: 'Google AI Overview' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(main.getByRole('tablist', { name: 'Question sections' })).toBeVisible()
    await shots(page, 'detail-google')

    await tabs.getByRole('tab', { name: 'ChatGPT' }).click()
    expect(await hashParam(page, 'eng')).toBe('chatgpt')
    const answer = page.getByTestId('engine-answer')
    await expect(answer.getByText('email to text', { exact: true })).toBeVisible()
    // The raw script tag shows as text and never runs or becomes an element.
    await expect(answer.locator('script')).toHaveCount(0)
    await expect(answer.getByText('Not cited', { exact: true })).toBeVisible()
    await expect(answer.getByText('7 credits · $0.006')).toBeVisible()
    // The sources are a grid now: one row per source, below the header row.
    const sources = answer
      .getByRole('grid', { name: 'Sources ChatGPT used, in its order' })
      .getByRole('row')
      .filter({ has: page.getByRole('gridcell') })
    await expect(sources).toHaveCount(3)
    const first = sources.first()
    await first.hover()
    await expect(first.getByRole('button', { name: /Copy/ })).toBeVisible()
    await expectMainAccessible(page)
    await shots(page, 'detail-chatgpt')

    await tabs.getByRole('tab', { name: 'Perplexity' }).click()
    expect(await hashParam(page, 'eng')).toBe('perplexity')
    await expect(answer).toHaveAttribute('data-engine', 'perplexity')
    await expect(answer.getByRole('note')).toHaveText(
      'Perplexity was unavailable during this check, so there is no answer. CiteFox asks again at the next check.'
    )
    await expect(main.getByRole('alert')).toHaveCount(0)
    await expectMainAccessible(page)
    await shots(page, 'detail-perplexity')

    await page.goBack()
    expect(await hashParam(page, 'eng')).toBe('chatgpt')
    await expect(answer).toHaveAttribute('data-engine', 'chatgpt')
    await page.goBack()
    await expect(main.getByRole('tablist', { name: 'Question sections' })).toBeVisible()
  })
})
