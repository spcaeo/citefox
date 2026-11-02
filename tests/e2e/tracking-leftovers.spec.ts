import { expect, test, type Locator, type Page } from '@playwright/test'
import type { CiteFoxApi } from '@shared/ipc'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { animationsDone, DRAWER_SIZES } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash, openTwoMarketApp } from './screens-app'

/**
 * Tracking leftovers (deep audit W3I item E), each on real IPC handlers with
 * no live network and no live Claude:
 * - rows ticked on Results carry into the Check now drawer (URL ids only);
 * - All pages fits a 1134 window with the Ask CiteFox column, and the cluster
 *   drawer's bulk bar keeps Clear on its first line;
 * - Check history's "What changed" shows the recorded Claude reply (the e2e
 *   stand-in answers `Assist: history.whatChanged` from its fixture).
 * Screenshots: test-results/e2e/leftovers-<what>-<width>.png.
 */

type Bridge = typeof globalThis & { citefox: CiteFoxApi }

const NARROW = { width: 1134, height: 770 }

function query(hash: string): URLSearchParams {
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
}

async function hashOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

async function shots(page: Page, name: string, before?: () => Promise<void>): Promise<void> {
  for (const size of DRAWER_SIZES) {
    await page.setViewportSize(size)
    await animationsDone(page)
    if (before) await before()
    await animationsDone(page)
    await page.screenshot({ path: await e2eArtifact(`leftovers-${name}-${size.width}.png`) })
  }
}

/** The grid never scrolls sideways. */
async function sideways(grid: Locator): Promise<number> {
  return grid.evaluate((node) => {
    const scroller = node.closest('.ui-lg-scroll') ?? node
    return scroller.scrollWidth - scroller.clientWidth
  })
}

async function centreY(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('not on screen')
  return box.y + box.height / 2
}

test('Check now carries the rows ticked on Results, as opaque ids on the URL', async () => {
  test.setTimeout(240_000)
  const { page, close } = await openTwoMarketApp('leftovers-checknow')
  try {
    await openHash(page, '#/pages/page-1/results')
    const boxes = page.getByRole('checkbox', { name: /^Select question \d+$/ })
    await expect(boxes.first()).toBeVisible()
    await boxes.nth(0).check()
    await boxes.nth(1).check()
    await expect
      .poll(
        async () =>
          query(await hashOf(page))
            .get('sel')
            ?.split(',').length
      )
      .toBe(2)
    const picked = (query(await hashOf(page)).get('sel') ?? '').split(',').sort()
    for (const id of picked) expect(id).toMatch(/^[\w-]+$/)

    const header = page.getByTestId('page-check-selected')
    await expect(header).toHaveText('Check 2 selected questions')
    await shots(page, 'results-ticked')
    await page.setViewportSize({ width: 1280, height: 900 })
    await header.click()

    const dialog = page.getByRole('dialog', { name: 'Check now' })
    await expect(dialog).toBeVisible()
    const params = query(await hashOf(page))
    expect(params.get('check.only')).toBe('picked')
    expect(params.get('check.ids')).toBe('page-1')
    expect((params.get('check.prompts') ?? '').split(',').sort()).toEqual(picked)
    expect(params.get('check.markets')).toMatch(/^mkt-/)
    const picker = dialog.getByTestId('check-now-question-picker')
    await expect(picker.getByRole('checkbox', { checked: true })).toHaveCount(2)
    await expect(dialog.getByTestId('check-now-cost')).toContainText('2 questions')
    await shots(page, 'checknow-picked')

    // The same drawer after a reload: the state is the URL.
    await page.reload()
    await expect(page.getByRole('dialog', { name: 'Check now' })).toBeVisible()
    await expect(
      page
        .getByRole('dialog', { name: 'Check now' })
        .getByTestId('check-now-question-picker')
        .getByRole('checkbox', { checked: true })
    ).toHaveCount(2)
  } finally {
    await close()
  }
})

test('All pages fits 1134 with the Ask column; the cluster bulk bar keeps Clear on one line', async () => {
  test.setTimeout(300_000)
  installRawMarkdown()
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-leftovers-pages-'))
  const { seedScaleProject } = await import('./scale-seed')
  await seedScaleProject(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: NARROW })
  try {
    await openAllPages(page)
    const grid = page.getByRole('grid', { name: 'Pages' })
    await expect(grid).toBeVisible()
    await expect(grid.getByRole('columnheader', { name: 'Ask CiteFox' })).toHaveCount(1)
    for (const name of ['Page', 'Score', 'Change', 'Page cited', 'Status']) {
      await expect(grid.getByRole('columnheader', { name, exact: true })).toBeVisible()
    }
    await expect.poll(() => sideways(grid)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: await e2eArtifact('leftovers-all-pages-1134.png') })
    // Wide: every default column is back, still with no sideways scroll.
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(grid.getByRole('columnheader', { name: 'Next check', exact: true })).toBeVisible()
    await expect.poll(() => sideways(grid)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: await e2eArtifact('leftovers-all-pages-1440.png') })

    const cluster = await page.evaluate(async () => {
      const api = (globalThis as Bridge).citefox
      await api['structure:recluster']({
        projectId: 'proj-scale',
        method: 'topic',
        useClaude: false,
        instruction: null
      })
      const view = await api['structure:get']({ projectId: 'proj-scale' })
      const biggest = [...view.clusters].sort((a, b) => b.pageCount - a.pageCount)[0]
      return biggest ? { id: biggest.id, name: biggest.name } : null
    })
    if (cluster === null) throw new Error('Group by rules made no clusters')
    await page.setViewportSize(NARROW)
    await openHash(page, `#/structure/clusters?drawer=cluster&cluster.id=${cluster.id}`)
    const drawer = page.getByRole('dialog', { name: cluster.name })
    const list = drawer.getByRole('grid', { name: `Pages in ${cluster.name}` })
    await expect(list).toBeVisible()
    await list.locator('[data-row] input[type="checkbox"]').first().check()
    const bar = drawer.getByRole('region', { name: 'Bulk actions' })
    await expect(bar).toBeVisible()
    const clear = bar.getByRole('button', { name: 'Clear', exact: true })
    const count = bar.getByRole('status')
    await animationsDone(page)
    expect(Math.abs((await centreY(clear)) - (await centreY(count)))).toBeLessThan(6)
    const clearBox = await clear.boundingBox()
    expect(clearBox?.height ?? 0).toBeLessThan(40)
    await page.screenshot({ path: await e2eArtifact('leftovers-cluster-bulk-1134.png') })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Check history: What changed shows the recorded reply, labelled as AI', async () => {
  test.setTimeout(300_000)
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-leftovers-history-'))
  await seedProgressProject(dir)
  // The `claude` stand-in answers `Assist: history.whatChanged` from its recorded fixture.
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  const shim = path.join(process.cwd(), 'tests/e2e/claude-shim.mjs')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(shim)} "$@"\n`)
  await chmod(claude, 0o755)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: path.join(process.cwd(), 'src/main/providers/fixtures/textbolt'),
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log')
    }
  })
  try {
    await openAllPages(page)
    await openHash(page, '#/history')
    await expect(page.getByRole('treegrid', { name: 'Check history' })).toBeVisible()
    await page.getByRole('button', { name: 'AI actions for Check history' }).click()
    await page.getByRole('menuitem', { name: /What changed/ }).click()

    const recorded = JSON.parse(
      await readFile(
        path.join(process.cwd(), 'src/main/assist/fixtures/history.whatChanged.json'),
        'utf8'
      )
    ) as { summary: string; items: { text: string }[] }
    const answer = page.getByTestId('what-changed')
    await expect(answer).toBeVisible({ timeout: 60_000 })
    const card = page.locator('section.ui-suggest').filter({ has: answer })
    await expect(card.getByRole('heading', { name: 'What changed' })).toBeVisible()
    await expect(card).toContainText('Written by AI from your saved checks.')
    await expect(answer).toContainText(recorded.summary)
    // Every number in the recorded reply is in this seed's saved checks: nothing is taken out.
    for (const item of recorded.items) await expect(answer).toContainText(item.text)
    await expect(card).not.toContainText('Took out sentences')
    await shots(page, 'what-changed')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
