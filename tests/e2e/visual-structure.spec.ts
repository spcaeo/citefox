import { expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { gridReports, type GridReport } from './grid-structure'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openCommunitiesApp } from './communities-app'
import { openHash, openTwoMarketApp } from './screens-app'
import { openAllPages } from './nav-helpers'

/**
 * Visual structure of the main grids in the built app (real CSS bundle, lazy
 * chunks and all): every header cell lines up with its body cells, and no
 * column is narrower than its header label's longest word. A shared grid rule
 * that beats a screen's own columns (the Checking table once lost its layout
 * that way) fails here. The cascade layers in styles.css must hold too.
 */
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 1024, height: 700 }
] as const

/** Screen, hash, and grids (by accessible name or class) that must be on it with rows. */
const SCREENS: readonly { name: string; hash: string; grids: RegExp[] }[] = [
  { name: 'all-pages', hash: '#/pages', grids: [/^Pages/] },
  { name: 'results', hash: '#/pages/page-1/results', grids: [/^Buyer questions from the/] },
  { name: 'markets', hash: '#/pages/page-1/markets', grids: [] },
  { name: 'gaps', hash: '#/pages/page-1/gaps', grids: [] },
  { name: 'prompts', hash: '#/pages/page-1/prompts', grids: [] },
  { name: 'history', hash: '#/pages/page-1/history', grids: [] },
  { name: 'reports', hash: '#/reports?tab=emails', grids: [/^Schedules/] },
  { name: 'projects', hash: '#/projects', grids: [] }
]

const LAYER_ORDER = ['shared', 'results', 'screens', 'utilities']

async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/)).toHaveCount(0)
  await page.waitForTimeout(250)
}

function problems(screen: string, width: number, reports: GridReport[]): string[] {
  return reports.flatMap((report) =>
    [...report.misaligned, ...report.crushed].map(
      (line) => `${screen} @${width} · ${report.name}: ${line}`
    )
  )
}

test('main grids keep header and body columns aligned at 1280 and 1024', async () => {
  test.setTimeout(300_000)
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-visual-structure-'))
  await seedTwoMarketProject(dir)

  // A saved schedule with one failed send, so Scheduled reports has both grids filled.
  const first = await launchCiteFox({ userDataDir: dir })
  try {
    await openAllPages(first.page)
    await first.page.evaluate(() => {
      window.location.hash = '#/reports?tab=emails'
    })
    await first.page.getByRole('button', { name: 'New schedule' }).first().click()
    const form = first.page.locator('.rpt [data-drawer="schedule"]')
    await form.getByLabel('Name').fill('Weekly TextBolt report for the leadership team')
    await form.getByLabel('Project', { exact: true }).selectOption({ label: 'TextBolt' })
    await form.getByLabel('Recipients').fill('reports@example.com')
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await form.getByRole('button', { name: 'Save schedule' }).click()
    await expect(
      first.page.getByRole('button', { name: /Weekly TextBolt report.*: open details/ })
    ).toBeVisible()
  } finally {
    await first.app.close()
  }
  const db = new Database(path.join(dir, 'app.sqlite'))
  try {
    const schedule = db.prepare('SELECT id FROM report_schedules LIMIT 1').get() as
      { id: string } | undefined
    db.prepare(
      `INSERT INTO deliveries (id, schedule_id, at, trigger, project_id, recipients, ok, error, outcome, next_step)
       VALUES ('vs-delivery', ?, ?, 'weekly', 'proj-1', ?, 0, ?, 'failed', ?)`
    ).run(
      schedule?.id ?? '',
      new Date(Date.now() - 3_600_000).toISOString(),
      JSON.stringify(['reports@example.com']),
      'SMTP sign-in failed: 535 authentication failed',
      'Fix the sending account in Email setup.'
    )
  } finally {
    db.close()
  }

  const { app, page } = await launchCiteFox({ userDataDir: dir })
  const found: string[] = []
  try {
    await openAllPages(page)
    for (const screen of SCREENS) {
      await page.evaluate((hash) => {
        window.location.hash = hash
      }, screen.hash)
      await settle(page)
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await page.waitForTimeout(200)
        const reports = await gridReports(page)
        for (const report of reports) {
          if (report.rows > 0) found.push(`${screen.name}:${report.name}`)
        }
        for (const wanted of screen.grids) {
          expect(
            reports.some((report) => wanted.test(report.name) && report.rows > 0),
            `${screen.name} @${viewport.width} shows ${wanted} with rows`
          ).toBe(true)
        }
        expect(problems(screen.name, viewport.width, reports)).toEqual([])
      }
      await page.setViewportSize(VIEWPORTS[0])
      await page.screenshot({ path: await e2eArtifact(`visual-structure-${screen.name}.png`) })
    }

    // Every rule sits in a declared layer, in the declared order.
    const layers = await page.evaluate(() => {
      const names: string[] = []
      let unlayered = 0
      const visit = (rules: CSSRuleList, prefix: string): void => {
        for (const rule of rules) {
          if (rule instanceof CSSLayerStatementRule) {
            for (const name of rule.nameList) names.push(prefix + name)
          } else if (rule instanceof CSSLayerBlockRule) {
            names.push(prefix + rule.name)
          } else if (rule instanceof CSSImportRule && rule.styleSheet) {
            visit(rule.styleSheet.cssRules, prefix)
          } else if (prefix === '' && !(rule instanceof CSSFontFaceRule)) {
            unlayered += 1
          }
        }
      }
      for (const sheet of document.styleSheets) visit(sheet.cssRules, '')
      return { order: [...new Set(names)], unlayered }
    })
    expect(layers.order).toEqual(LAYER_ORDER)
    expect(layers.unlayered).toBe(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
  // The checks above ran on real grids, not on empty screens.
  expect(found.length).toBeGreaterThanOrEqual(8)
})

/** Top edges of the tabs in the page tab strip, and whether the strip scrolls. */
async function tabStrip(page: Page): Promise<{
  tops: number[]
  stripHeight: number
  tabHeight: number
  activeVisible: boolean
}> {
  return page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(
      '[role="tablist"][aria-label="Page sections"]'
    )
    const tabs = [...(strip?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
    const box = strip?.getBoundingClientRect()
    const active = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')
    const at = active?.getBoundingClientRect()
    return {
      tops: tabs.map((tab) => Math.round(tab.getBoundingClientRect().top)),
      stripHeight: Math.round(box?.height ?? 0),
      tabHeight: Math.round(tabs[0]?.getBoundingClientRect().height ?? 0),
      activeVisible: Boolean(box && at && at.left >= box.left - 1 && at.right <= box.right + 1)
    }
  })
}

test('page tabs stay on one row at 1280 and 1024 and keep the active tab in view', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('visual-tabs')
  try {
    for (const tab of ['results', 'history'] as const) {
      await openHash(page, `#/pages/page-1/${tab}`)
      await settle(page)
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await page.waitForTimeout(200)
        const strip = await tabStrip(page)
        expect(strip.tops.length, `${tab} @${viewport.width} tabs`).toBe(9)
        expect(new Set(strip.tops).size, `${tab} @${viewport.width}: one row`).toBe(1)
        // One row of tabs, plus at most a thin scrollbar.
        expect(strip.stripHeight).toBeLessThan(strip.tabHeight * 1.6)
        expect(strip.activeVisible, `${tab} @${viewport.width}: active tab in view`).toBe(true)
        await page.screenshot({
          path: await e2eArtifact(`visual-structure-tabs-${tab}-${viewport.width}.png`)
        })
      }
    }
    // The keyboard reaches a tab that starts out of view, and it scrolls in.
    await page.setViewportSize(VIEWPORTS[1])
    await openHash(page, '#/pages/page-1/results')
    await settle(page)
    const tablist = page.getByRole('tablist', { name: 'Page sections' })
    await tablist.getByRole('tab', { name: 'Results', exact: true }).focus()
    await page.keyboard.press('End')
    await expect(tablist.getByRole('tab', { name: 'History', exact: true })).toBeFocused()
    await expect(page).toHaveURL(/#\/pages\/page-1\/history/)
    await page.waitForTimeout(200)
    expect((await tabStrip(page)).activeVisible).toBe(true)
  } finally {
    await close()
  }
})

test('YouTube KPI tiles line up their labels and numbers at 1280 and 1024', async () => {
  test.setTimeout(180_000)
  const opened = await openCommunitiesApp('visual-youtube')
  const { page } = opened
  try {
    await openHash(page, '#/youtube')
    await expect(page.locator('.yt-stats .ui-kpi')).toHaveCount(4)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await page.waitForTimeout(200)
      const rows = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll<HTMLElement>('.yt-stats .ui-kpi')]
        const byRow = new Map<
          number,
          { label: number; value: number; valueLeft: number; labelLeft: number }[]
        >()
        for (const tile of tiles) {
          const top = Math.round(tile.getBoundingClientRect().top)
          const label = tile.querySelector<HTMLElement>('.ui-kpi-label')?.getBoundingClientRect()
          const value = tile.querySelector<HTMLElement>('.ui-kpi-value')?.getBoundingClientRect()
          const text = tile.querySelector<HTMLElement>('.yt-num')
          const range = document.createRange()
          if (text) range.selectNodeContents(text)
          const ink = range.getBoundingClientRect()
          const list = byRow.get(top) ?? []
          list.push({
            label: Math.round(label?.top ?? -1),
            value: Math.round(value?.top ?? -1),
            valueLeft: Math.round(ink.left),
            labelLeft: Math.round(label?.left ?? -1)
          })
          byRow.set(top, list)
        }
        return [...byRow.values()]
      })
      for (const row of rows) {
        expect(new Set(row.map((tile) => tile.label)).size, `labels @${viewport.width}`).toBe(1)
        expect(new Set(row.map((tile) => tile.value)).size, `numbers @${viewport.width}`).toBe(1)
        for (const tile of row) {
          // The number starts where its label starts.
          expect(
            Math.abs(tile.valueLeft - tile.labelLeft),
            `indent @${viewport.width}`
          ).toBeLessThanOrEqual(1)
        }
      }
      await page.locator('.yt-stats').screenshot({
        path: await e2eArtifact(`visual-structure-youtube-kpis-${viewport.width}.png`)
      })
    }
  } finally {
    await opened.close()
  }
})
