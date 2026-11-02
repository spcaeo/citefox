import { chromium, expect, test, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
 * The finished Reports plan on a rich seeded project (44 questions, 3 checks, three
 * engines, two markets; no live calls): branding in Project settings › Reports, the
 * Reports home order and the Full report link, every Impact review section (Lost ground,
 * Deep dives, Backlinks, the 5-step cycle), per engine and per market, the 14-day email
 * preset, then the downloaded HTML (engine logos, sponsors, Prepared for, drawer lists
 * that stay in their engine view) and a real PDF with pages and text.
 * Screenshots: test-results/e2e/reports-finish/.
 */

const SHOTS = path.join(e2eArtifactsDir(), 'reports-finish')

async function snap(page: Page, name: string, fullPage = false): Promise<void> {
  await mkdir(SHOTS, { recursive: true })
  // Chart bars grow in for 420 ms: let them finish.
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage })
}

/** A small square logo (SVG) for "Prepared for". */
const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="40" height="40" rx="8" fill="#1f4c91"/><text x="20" y="27" font-family="Arial" font-size="20" fill="#fff" text-anchor="middle">A</text><text x="50" y="27" font-family="Arial" font-size="16" fill="#1f4c91">Acme</text></svg>'

test('Reports finished: agency sections, deep dives, engines, markets, branding, downloads and PDF', async () => {
  test.setTimeout(420_000)
  installRawMarkdown()
  const { seedReportsProject } = await import('./reports-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-reports-'))
  const saved = path.join(dir, 'saved')
  await mkdir(saved, { recursive: true })
  const logoFile = path.join(dir, 'acme.svg')
  await writeFile(logoFile, LOGO_SVG, 'utf8')
  await seedReportsProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
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
    const m = page.locator('#main')
    const tip = page.getByRole('button', { name: 'Got it' })

    // ---- Project settings › Reports: the "Prepared for" line ----
    await openHash(page, '#/project-settings?tab=reports')
    const brand = m.locator('#ps-reports-brand')
    await expect(brand).toBeVisible()
    await brand.getByLabel('Prepared for').fill('Acme Marketing')
    await brand.locator('input[type="file"]').setInputFiles(logoFile)
    await expect(brand.getByRole('img', { name: 'Logo preview' })).toBeVisible()
    await brand.getByRole('button', { name: 'Save' }).click()
    await expect(brand.getByRole('status')).toContainText('Saved')
    if (await tip.isVisible().catch(() => false)) await tip.click()
    await snap(page, '01-settings-prepared-for')

    // ---- Reports home: Impact review, What changed, Visibility report ----
    await openHash(page, '#/reports')
    // By goal is the default view; By report shows the six reports by name.
    await m.getByRole('tab', { name: 'By report' }).click()
    const cards = m.locator('[data-card]')
    await expect(cards).toHaveCount(6)
    expect(
      await cards.evaluateAll((list) => list.map((el) => el.getAttribute('data-card')))
    ).toEqual(['visibility', 'changed', 'impact', 'pitch', 'content', 'rival'])
    await expect(m.locator('[data-card="visibility"] a[data-full-report]')).toHaveAttribute(
      'href',
      '#/export'
    )
    if (await tip.isVisible().catch(() => false)) await tip.click()
    await snap(page, '02-reports-home')

    // ---- Impact review: every section ----
    await m.locator('[data-card="impact"]').getByRole('button', { name: 'Open' }).click()
    await expect(m.getByRole('region', { name: 'Verdict' })).toBeVisible()
    const tabs = m.getByRole('tablist', { name: 'Report sections' })
    // Thirteen sections in grouped tabs: one line of top tabs, pill sub-tabs inside a group.
    await expect(tabs.getByRole('tab')).toHaveText([
      'Verdict',
      'Published pages',
      'Questions',
      'Competitors',
      'Pages•',
      'Client asks•',
      'More',
      'How we measured'
    ])
    for (const [group, pills] of [
      ['Pages', ['Pages', 'Lost ground•']],
      ['Client asks', ['Not indexed•', 'Backlinks', 'Next round']],
      ['More', ['What changed', 'Topics', 'Deep dives']]
    ] as const) {
      await tabs.getByRole('tab', { name: new RegExp(`^${group}`) }).click()
      await expect(
        m.getByRole('tablist', { name: `${group} sections` }).getByRole('tab')
      ).toHaveText([...pills])
    }
    await openReportSection(m, 'Verdict')
    await snap(page, '03-impact-verdict', true)
    const sections = [
      ['Published pages', '04-published'],
      ['What changed', '05-what-changed'],
      ['Questions', '06-questions'],
      ['Competitors', '07-competitors'],
      ['Pages', '08-pages'],
      ['Lost ground', '09-lost-ground'],
      ['Topics', '10-topics'],
      ['Deep dives', '11-deep-dives'],
      ['Not indexed', '12-not-indexed'],
      ['Backlinks', '13-backlinks'],
      ['Next round', '14-next-round'],
      ['How we measured', '15-method']
    ] as const
    for (const [label, name] of sections) {
      await openReportSection(m, label)
      await expect(m.getByText('Loading the report…')).toHaveCount(0)
      expect(await page.evaluate(() => window.location.hash)).toContain('section=')
      await snap(page, name, true)
    }

    // Lost ground: what changed on the page and where its questions went; a tile drills.
    await openReportSection(m, 'Lost ground')
    const lost = m.getByRole('region', { name: /^Lost ground: \/blog\// })
    await expect(lost).toContainText('What changed on the page')
    await expect(lost).toContainText('1 section removed')
    await expect(lost).toContainText('Who uses it')
    await expect(lost).toContainText('Recovery plan')
    await lost.locator('.rv-tile button').first().click()
    const drill = page.locator('[data-drawer="report-drill"]')
    await expect(drill).toBeVisible()
    await expect(drill.getByTestId('rv-dstats')).toContainText('5 questions')
    await snap(page, '16-lost-drill')
    await page.keyboard.press('Escape')

    // Backlinks: suggested and saved anchor text; CSV saves.
    await openReportSection(m, 'Backlinks')
    const asks = m.getByRole('table', { name: 'Backlink ask list' })
    await expect(asks).toContainText('email to SMS pricing')
    await expect(asks).toContainText('(suggested)')
    await m.getByRole('button', { name: 'Download CSV', exact: true }).click()
    await expect
      .poll(async () => (await readdir(saved)).filter((name) => name.endsWith('-backlinks.csv')))
      .toHaveLength(1)

    // Next round: five steps with owners; a count drills to its pages.
    await openReportSection(m, 'Next round')
    const cycle = m.locator('.rv-round-step')
    await expect(cycle).toHaveCount(5)
    await expect(m.locator('[data-step="publish"]')).toContainText('Dana (web team)')

    // Deep dives per engine: All engines shows engines agreeing; one engine does not.
    await openReportSection(m, 'Deep dives')
    await expect(m.getByRole('heading', { name: 'Do the engines agree?' })).toBeVisible()
    await expect(
      m.locator('.rv-panel', { hasText: 'Do the engines agree?' }).locator('.cfc-drill')
    ).not.toHaveCount(0)
    const engines = m.getByRole('group', { name: 'Engine' })
    await engines.getByRole('button', { name: 'ChatGPT' }).click()
    expect(await page.evaluate(() => window.location.hash)).toContain('engine=chatgpt')
    await expect(m.getByText('Pick All engines to compare the engines.')).toBeVisible()
    await snap(page, '17-deep-dives-chatgpt', true)
    await openReportSection(m, 'Verdict')
    await snap(page, '18-verdict-chatgpt', true)
    await engines.getByRole('button', { name: 'Perplexity' }).click()
    await snap(page, '19-verdict-perplexity', true)
    await engines.getByRole('button', { name: 'All' }).click()

    // ---- Per market: the Visibility report in the UK ----
    await openHash(page, '#/reports?report=visibility&market=mkt-uk')
    await expect(m.getByRole('heading', { name: 'Visibility report' })).toBeVisible()
    await expect(m.getByText('Loading the report…')).toHaveCount(0)
    await expect(m.locator('.rv-window')).toBeVisible()
    await snap(page, '20-visibility-uk', true)

    // ---- Scheduled emails: the 14-day Impact review preset ----
    await openHash(page, '#/reports?tab=emails')
    const preset = m.getByTestId('impact-preset')
    await expect(preset).toBeVisible()
    await preset.getByRole('button', { name: 'Set it up' }).click()
    const form = page.locator('[data-drawer="schedule"]')
    await expect(form.getByLabel('Name')).toHaveValue('Impact review every 14 days')
    await snap(page, '21-email-preset')
    await page.keyboard.press('Escape')

    // ---- Downloads: HTML and a real PDF of the Impact review ----
    await openHash(page, '#/reports?report=impact')
    await expect(m.getByRole('region', { name: 'Verdict' })).toBeVisible()
    await m.getByRole('button', { name: /^Download/ }).click()
    await page.getByRole('menuitem', { name: /Offline HTML/ }).click()
    await expect(m.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({
      timeout: 90_000
    })
    await m.getByRole('button', { name: 'Print / PDF' }).click()
    const note = m.locator('.rv-head [role="status"]')
    await expect(note).toHaveText(/\.pdf|not|could|check|failed/i, { timeout: 150_000 })
    await snap(page, '22-pdf-saved-note')
    if (!((await note.textContent()) ?? '').includes('.pdf')) {
      const log = await readFile(path.join(dir, 'logs', 'citefox.log'), 'utf8').catch(() => '')
      await writeFile(path.join(SHOTS, 'pdf-failure.log'), log.slice(-20_000), 'utf8')
    }
    await expect(note).toContainText('.pdf')
    expect(problems).toEqual([])

    // The PDF: real pages and text.
    const pdfName = (await readdir(saved)).find((name) => name.endsWith('.pdf')) ?? ''
    const pdf = await readFile(path.join(saved, pdfName))
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length
    expect(pages).toBeGreaterThan(2)
    expect(pdf.toString('latin1')).toMatch(/\/ToUnicode/)
    const { extractPdfText } = await import('../../src/main/export/pdf-inspect.test-helper')
    const text = extractPdfText(pdf).replace(/\s+/g, ' ')
    await writeFile(path.join(SHOTS, 'pdf-text.txt'), text, 'utf8')
    expect(text).toContain('Impact review')
    // The PDF's first page, rendered by Electron's own PDF viewer.
    const png = await app.evaluate(
      async ({ BrowserWindow }, file) => {
        const win = new BrowserWindow({
          show: false,
          width: 1000,
          height: 1300,
          webPreferences: { plugins: true, partition: 'e2e-pdf-view' }
        })
        try {
          await win.loadURL(`file://${file}`)
          await new Promise((resolve) => setTimeout(resolve, 2500))
          return (await win.webContents.capturePage()).toPNG().toString('base64')
        } finally {
          win.destroy()
        }
      },
      path.join(saved, pdfName)
    )
    await writeFile(path.join(SHOTS, '22b-pdf-first-page.png'), Buffer.from(png, 'base64'))

    // ---- The downloaded HTML, headless ----
    const htmlName = (await readdir(saved)).find((name) => name.endsWith('.html')) ?? ''
    const html = await readFile(path.join(saved, htmlName), 'utf8')
    expect(html).not.toContain('[object')
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const report = await context.newPage()
      await report.emulateMedia({ reducedMotion: 'reduce' })
      const errors: string[] = []
      report.on('pageerror', (error) => errors.push(error.message))
      report.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await report.goto(pathToFileURL(path.join(saved, htmlName)).href)
      await expect(report.locator('html.js')).toHaveCount(1)
      await expect(report.getByTestId('prepared-for')).toContainText('Prepared for Acme Marketing')
      await expect(report.locator('.rv-engines img.rv-logo')).toHaveCount(3)
      await snap(report, '23-download-top')
      await report.locator('#sec-lost').scrollIntoViewIfNeeded()
      await snap(report, '24-download-lost-ground')
      await report.locator('#sec-deep').scrollIntoViewIfNeeded()
      await snap(report, '25-download-deep-dives')
      await report.locator('#sec-backlinks').scrollIntoViewIfNeeded()
      await snap(report, '26-download-backlinks')
      await report.locator('.rv-sponsors').scrollIntoViewIfNeeded()
      await expect(report.locator('.rv-sponsor')).toHaveCount(2)
      await snap(report, '27-download-sponsors')

      // ChatGPT view: a question's site list holds only ChatGPT rows; the strip says questions.
      await report.locator('[data-switch="engine"][data-value="chatgpt"]').click()
      await snap(report, '28-download-chatgpt')
      await report
        .locator('[data-switch-panel="engine"][data-value="chatgpt"] button.drill[data-drill]')
        .first()
        .click()
      const drawer = report.locator('#drawer')
      await expect(drawer).toBeVisible()
      await expect(drawer.getByTestId('drawer-summary')).toContainText('Questions')
      await expect(drawer.getByTestId('drawer-summary')).toContainText('AI answer shown')
      const question = drawer.locator('button[data-open^="q:chatgpt|"]').first()
      await question.click()
      const site = drawer.locator('button[data-open^="dom:chatgpt|"]').first()
      await site.click()
      const ids = await drawer
        .locator('tr[data-row-id]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-id') ?? ''))
      expect(ids.length).toBeGreaterThan(0)
      expect(ids.every((id) => id.startsWith('chatgpt|'))).toBe(true)
      await snap(report, '29-download-chatgpt-site-drill')
      await report.keyboard.press('Escape')
      await report.keyboard.press('Escape')
      await report.keyboard.press('Escape')
      await report.emulateMedia({ media: 'print' })
      await snap(report, '30-download-print', true)
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
