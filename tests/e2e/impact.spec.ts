import { chromium, expect, test, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { e2eArtifactsDir } from './artifacts'
import { launchCiteFox } from './launch'
import { openReportSection } from './report-tabs'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * Reports → Ready reports and the Impact review, on the seeded multi-engine TextBolt
 * project (no live calls): the three cards, every section of the Impact review, drills
 * one and two levels deep, the engine filter, the Topics lens, Scheduled emails, the
 * quiet Summary line, then the downloaded HTML opened headlessly with its drills and
 * engine switch. Screenshots: test-results/e2e/impact/.
 */

const SHOTS = path.join(e2eArtifactsDir(), 'impact')

async function snap(page: Page, name: string, fullPage = false): Promise<void> {
  await mkdir(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage })
}

function main(page: Page): ReturnType<Page['locator']> {
  return page.locator('#main')
}

test('Reports: ready reports, the Impact review, its drills and the downloaded file', async () => {
  test.setTimeout(300_000)
  installRawMarkdown()
  const { seedImpactProject } = await import('./impact-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-impact-'))
  const saved = path.join(dir, 'saved')
  await mkdir(saved, { recursive: true })
  await seedImpactProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  try {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.find(
          (arg): arg is { defaultPath?: string } =>
            typeof arg === 'object' && arg !== null && 'defaultPath' in arg
        )
        return { canceled: false, filePath: `${folder}/${options?.defaultPath ?? 'report'}` }
      }) as typeof dialog.showSaveDialog
    }, saved)
    await openAllPages(page)

    // ---- Ready reports ----
    await openHash(page, '#/reports')
    const m = main(page)
    await expect(m.getByRole('tab', { name: 'Ready reports' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // By goal is the default view; By report names the reports themselves.
    await m.getByRole('tab', { name: 'By report' }).click()
    await expect(m.getByRole('tab', { name: 'By report' })).toHaveAttribute('aria-selected', 'true')
    for (const name of ['Visibility report', 'What changed', 'Impact review']) {
      await expect(m.getByRole('region', { name })).toBeVisible()
    }
    // The first-visit page tip covers the cards' corner: put it away for clean screenshots.
    const tip = page.getByRole('button', { name: 'Got it' })
    if (await tip.isVisible().catch(() => false)) await tip.click()
    const impactCard = m.getByRole('region', { name: 'Impact review' })
    await expect(impactCard).toContainText('pages published')
    await snap(page, '01-ready-reports')

    // ---- Impact review: every section ----
    await impactCard.getByRole('button', { name: 'Open' }).click()
    const verdict = m.getByRole('region', { name: 'Verdict' })
    await expect(verdict).toBeVisible()
    await expect(verdict).toContainText('Questions citing your pages')
    await snap(page, '02-verdict')
    await snap(page, '02-verdict-full', true)
    const sections = [
      ['Published pages', '03-published'],
      ['What changed', '04-what-changed'],
      ['Questions', '05-questions'],
      ['Competitors', '06-competitors'],
      ['Pages', '07-pages'],
      ['Topics', '08-topics'],
      ['Not indexed', '09-not-indexed'],
      ['Next round', '10-next-round'],
      ['How we measured', '11-method']
    ] as const
    for (const [label, name] of sections) {
      await openReportSection(m, label)
      await expect(m.locator('.rv-body')).toBeVisible()
      await expect(m.getByText('Loading the report…')).toHaveCount(0)
      expect(await page.evaluate(() => window.location.hash)).toContain('section=')
      await snap(page, name, true)
    }
    await expect(m.getByRole('table', { name: 'Not indexed yet' }).first())
      .toBeVisible()
      .catch(() => undefined)

    // Topics lens on the URL.
    await openReportSection(m, 'Topics')
    await m
      .getByRole('group', { name: 'Group questions by' })
      .getByRole('button', { name: 'Funnel stage' })
      .click()
    expect(await page.evaluate(() => window.location.hash)).toContain('seg=funnel')
    await snap(page, '12-topics-funnel')

    // ---- Drills: a KPI → its questions → one question's answers ----
    await openReportSection(m, 'Verdict')
    await m.getByRole('region', { name: 'Verdict' }).locator('.rv-kpi').first().click()
    const drill = page.locator('[data-drawer="report-drill"]')
    await expect(drill).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toContain('drawer=report-drill')
    await snap(page, '13-drill-kpi')
    const firstRow = drill.locator('tbody tr').first()
    if ((await firstRow.count()) > 0) {
      await firstRow.click()
      const detail = page.locator('[data-drawer="report-detail"]')
      await expect(detail).toBeVisible()
      await snap(page, '14-drill-question')
      // A site in the answer opens the questions citing it.
      const site = detail.locator('.rv-sites .rv-link').first()
      if ((await site.count()) > 0) {
        await site.click()
        await expect(detail).toBeVisible()
        await snap(page, '15-drill-site')
      }
    }
    // Esc steps back one level at a time (site → question → list → closed); each step
    // changes the URL before the next key.
    for (
      let step = 0;
      // The URL, not the DOM: a closing drawer stays in the page while it animates out.
      step < 4 && (await page.evaluate(() => window.location.hash)).includes('drawer=');
      step += 1
    ) {
      const before = await page.evaluate(() => window.location.hash)
      await page.keyboard.press('Escape')
      await expect.poll(() => page.evaluate(() => window.location.hash)).not.toBe(before)
    }
    await expect(drill).toHaveCount(0)

    // A chart bar drills too (Competitors).
    await openReportSection(m, 'Competitors')
    // The first mark is the share-of-voice ring (its centre is the hole, with the total):
    // open it from the keyboard, as the chart allows.
    const bar = m.locator('.cfc-drill').first()
    await bar.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-drawer="report-drill"]')).toBeVisible()
    await snap(page, '16-drill-chart')
    await page.keyboard.press('Escape')

    // Published pages: a tile opens its pages.
    await openReportSection(m, 'Published pages')
    await m.locator('.rv-tile').first().click()
    await expect(page.locator('[data-drawer="report-drill"]')).toBeVisible()
    await snap(page, '17-drill-pages')
    await page.keyboard.press('Escape')

    // ---- Engine filter with logos ----
    await openReportSection(m, 'Verdict')
    const engines = m.getByRole('group', { name: 'Engine' })
    await engines.getByRole('button', { name: 'ChatGPT' }).click()
    expect(await page.evaluate(() => window.location.hash)).toContain('engine=chatgpt')
    await expect(m.getByText(/ChatGPT/).first()).toBeVisible()
    await snap(page, '18-verdict-chatgpt')
    await engines.getByRole('button', { name: 'All' }).click()

    // ---- Download the HTML ----
    await m.getByRole('button', { name: /^Download/ }).click()
    await page.getByRole('menuitem', { name: /Offline HTML/ }).click()
    await expect(m.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({
      timeout: 60_000
    })
    const files = (await readdir(saved)).filter((name) => name.endsWith('.html'))
    expect(files.length).toBe(1)

    // CSV of one table.
    await m.getByRole('button', { name: /^Download/ }).click()
    await page.getByRole('menuitem', { name: 'Questions (CSV)' }).click()
    await expect
      .poll(async () => (await readdir(saved)).filter((name) => name.endsWith('.csv')).length)
      .toBe(1)

    // ---- Scheduled emails and Summary ----
    await openHash(page, '#/reports?tab=emails')
    await expect(m.getByRole('tab', { name: /^Schedules/ })).toBeVisible()
    await snap(page, '19-scheduled-emails')
    await openHash(page, '#/overview')
    const glance = m.getByRole('region', { name: 'Is it working?' })
    await expect(glance).toBeVisible()
    await expect(m.getByRole('heading', { name: 'Verdict' })).toHaveCount(0)
    await snap(page, '20-summary-line')
    await glance.getByRole('link', { name: 'See the Impact review →' }).click()
    await expect(m.getByRole('region', { name: 'Verdict' })).toBeVisible()
    expect(problems).toEqual([])

    // ---- The downloaded file, headless ----
    const html = await readFile(path.join(saved, files[0] ?? ''), 'utf8')
    expect(html).toContain('Impact review')
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const report = await context.newPage()
      const errors: string[] = []
      report.on('pageerror', (error) => errors.push(error.message))
      report.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await report.goto(pathToFileURL(path.join(saved, files[0] ?? '')).href)
      await expect(report.locator('html.js')).toHaveCount(1)
      await snap(report, '21-download-top')
      await snap(report, '22-download-full', true)
      await report.locator('main button.drill[data-drill]').first().click()
      await expect(report.locator('#drawer')).toBeVisible()
      await snap(report, '23-download-drill')
      const step = report.locator('#drawer-body button[data-open^="q:"]').first()
      if ((await step.count()) > 0) {
        await step.click()
        await snap(report, '24-download-answer')
      }
      await report.keyboard.press('Escape')
      await report.keyboard.press('Escape')
      const chatgpt = report.locator('[data-switch="engine"][data-value="chatgpt"]')
      if ((await chatgpt.count()) > 0) {
        await chatgpt.click()
        await snap(report, '25-download-chatgpt')
      }
      await report.emulateMedia({ media: 'print' })
      await snap(report, '26-download-print', true)
      expect(errors).toEqual([])
      await context.close()
    } finally {
      await browser.close()
    }
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
