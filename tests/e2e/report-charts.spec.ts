import { expect, test, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  bucketColumns,
  funnelChart,
  gainersLosers,
  historyStrip,
  pairedBars,
  positionChart,
  rankedBars,
  splitBar
} from '../../src/shared/charts'
import {
  BEFORE,
  BUCKETS,
  FUNNEL,
  HISTORY,
  MOVERS,
  NOT_CITED,
  NOW,
  PAIRED,
  POSITIONS,
  RANKED,
  SPLIT
} from '../../src/renderer/src/playground/gallery/reportChartsData'
import { e2eArtifactsDir } from './artifacts'
import { openHash, openTwoMarketApp } from './screens-app'

/**
 * The report charts (src/shared/charts) on the gallery board in sepia, light and
 * dark, and the same SVG in a page styled like the downloaded report (light and
 * print). Screenshots land in test-results/e2e/report-charts/ for a visual check.
 */

async function shotTo(page: Page, name: string, locator = page.locator('body')): Promise<void> {
  const dir = path.join(e2eArtifactsDir(), 'report-charts')
  await mkdir(dir, { recursive: true })
  await locator.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled' })
}

/** Text that runs outside its chart's box (a label too long for its room). */
async function overflowingText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    for (const svg of document.querySelectorAll<SVGSVGElement>('svg.cfc')) {
      const box = svg.viewBox.baseVal
      for (const node of svg.querySelectorAll<SVGTextElement>('text')) {
        const b = node.getBBox()
        if (b.width === 0) continue
        if (b.x < box.x - 1 || b.x + b.width > box.x + box.width + 1)
          out.push(`${svg.getAttribute('aria-label')}: "${node.textContent}"`)
      }
    }
    return out
  })
}

/** The downloaded report's light colours and chart map, read from style.ts, plus the kit. */
async function reportStyles(): Promise<string> {
  const root = process.cwd()
  const source = await readFile(path.join(root, 'src/main/export/html/style.ts'), 'utf8')
  const vars = /export const REPORT_CHART_VARS = `([\s\S]*?)`/.exec(source)?.[1] ?? ''
  const light = /return `(:root \{[\s\S]*?\n\})/.exec(source)?.[1] ?? ''
  const kit = await readFile(path.join(root, 'src/shared/charts/charts.css'), 'utf8')
  return `${light.replace('${accent}', '#c2410c')}
body { margin: 0; padding: 24px; background: var(--bg); color: var(--ink); font: 14px/20px var(--font); }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; max-width: 1000px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }
.wide { grid-column: 1 / -1; }
h3 { margin: 0 0 8px; font-size: 14px; }
${kit}
${vars}`
}

function reportPage(css: string): string {
  const w = 440
  const card = (title: string, svg: string, wide = false): string =>
    `<div class="card${wide ? ' wide' : ''}"><h3>${title}</h3>${svg}</div>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report charts</title><style>${css}</style></head><body><div class="grid">
${card('Where the change came from', splitBar({ label: 'Change', width: 930, parts: SPLIT, signedValues: true }).svg, true)}
${card('Where citations come from', pairedBars({ label: 'Groups', width: w, items: PAIRED, beforeLabel: BEFORE, nowLabel: NOW }).svg)}
${card('How fast new pages get cited', bucketColumns({ label: 'Speed', width: w, items: BUCKETS }).svg)}
${card('Who moved', gainersLosers({ label: 'Movers', width: 930, items: MOVERS, limit: 4 }).svg, true)}
${card('Most cited sites', rankedBars({ label: 'Sites', width: w, items: RANKED, previousLabel: BEFORE, nowLabel: NOW }).svg)}
${card('Where visibility falls away', funnelChart({ label: 'Funnel', width: w, steps: FUNNEL }).svg)}
${card('Your position among the sources', positionChart({ label: 'Position', width: w, positions: POSITIONS, notCited: NOT_CITED }).svg)}
${card('History per question', HISTORY.map((row) => `<p>${row.question} ${historyStrip({ label: row.question, cells: row.cells }).svg}</p>`).join(''))}
</div></body></html>`
}

test('report charts draw the same in sepia, light, dark and the downloaded report', async () => {
  test.setTimeout(240_000)
  const { app, page, close } = await openTwoMarketApp('report-charts')
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'citefox-report-charts-'))
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openHash(page, '#/playground/gallery')
    const heading = page.getByRole('heading', { level: 2, name: 'Report charts' })
    await expect(heading).toBeVisible()
    const board = page.getByTestId('report-charts-board')
    await board.scrollIntoViewIfNeeded()
    await expect(board.locator('svg.cfc')).toHaveCount(11)

    await test.step('hover, focus and drill', async () => {
      const mark = board.getByRole('button', { name: /^textbolt\.com: 6 to 20/ })
      await mark.hover()
      await expect(board.locator('.ui-rchart-card')).toContainText('textbolt.com')
      await mark.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByText('Would open: dom:textbolt.com')).toBeVisible()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(page.getByText('Would open: dom:reddit.com')).toBeVisible()
      await page.mouse.move(0, 0)
    })

    const themes = page.getByRole('group', { name: 'Chart board theme' })
    for (const theme of ['Sepia', 'Light', 'Dark'] as const) {
      await test.step(`board in ${theme}`, async () => {
        await themes.getByRole('button', { name: theme }).click()
        await expect(board).toHaveAttribute('data-theme', theme.toLowerCase())
        // Tall enough for the whole board: an element shot past the window comes out blank.
        await page.setViewportSize({ width: 1440, height: 2600 })
        await page.waitForTimeout(600)
        expect(await overflowingText(page)).toEqual([])
        await shotTo(page, `board-${theme.toLowerCase()}`, board)
      })
    }

    await test.step('narrow window: one card a row', async () => {
      await page.setViewportSize({ width: 1024, height: 3000 })
      await page.waitForTimeout(600)
      expect(await overflowingText(page)).toEqual([])
      await shotTo(page, 'board-dark-1024', board)
    })

    await test.step('the downloaded report draws the same SVG', async () => {
      const file = path.join(tmp, 'report.html')
      await writeFile(file, reportPage(await reportStyles()))
      await app.evaluate(async ({ BrowserWindow }, target) => {
        const win = new BrowserWindow({
          show: false,
          width: 1100,
          height: 1300,
          // Its own session: the app's session only lets the app's own pages load.
          webPreferences: { partition: 'report-charts-e2e', sandbox: true }
        })
        await win.loadFile(target)
      }, file)
      const report = app.windows().find((w) => w.url().endsWith('report.html'))
      expect(report).toBeTruthy()
      if (!report) return
      await report.setViewportSize({ width: 1100, height: 1500 })
      await report.waitForTimeout(600)
      expect(await overflowingText(report)).toEqual([])
      await shotTo(report, 'report-light')
      await report.emulateMedia({ media: 'print' })
      await shotTo(report, 'report-print')
      await report.close()
    })
  } finally {
    await close()
    await rm(tmp, { recursive: true, force: true })
  }
})
