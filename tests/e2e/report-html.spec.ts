import {
  chromium,
  expect,
  test,
  type Browser,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import type { ExportStartResult } from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { readStoredZip } from '../../src/main/export/zip'
import { e2eArtifact, e2eArtifactsDir } from './artifacts'
import { launchCiteFox } from './launch'

/**
 * The interactive HTML report end to end: one real check against the recorded
 * fixtures, `exports:start` over real IPC, then the exported index.html opened from
 * disk in Chromium with its CSP in force. Every interaction runs in a real browser:
 * the drawer, search, CSV download and print expansion.
 *
 * Screenshots go to CITEFOX_REPORT_HTML_SHOTS, or test-results/e2e/report-html.
 */

interface LoadedCheck {
  userDataDir: string
  projectId: string
  pageId: string
  marketId: string
}

const SECTIONS: ExportRequest['sections'] = [
  'overview',
  'pages',
  'competition',
  'reputation',
  'trends',
  'universe',
  'sources',
  'answer_shape',
  'content_gaps',
  'prompts'
]

const SHOTS = process.env.CITEFOX_REPORT_HTML_SHOTS ?? path.join(e2eArtifactsDir(), 'report-html')

let server: ViteDevServer | undefined
let seeded: LoadedCheck | undefined
let workDir = ''

test.beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'citefox-report-html-'))
  server = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true },
    resolve: { alias: { '@shared': path.resolve('src/shared') } },
    // Same reasons as nfr14-consistency.spec.ts: a private cache, no prebundling.
    cacheDir: path.resolve('node_modules/.vite-report-html'),
    optimizeDeps: { noDiscovery: true },
    ssr: {
      external: ['better-sqlite3', 'electron', '@napi-rs/keyring', 'exceljs'],
      optimizeDeps: { noDiscovery: true }
    }
  })
  const loaded = (await server.ssrLoadModule(path.resolve('tests/e2e/nfr14-load.ts'))) as {
    loadTextboltCheck: () => Promise<LoadedCheck>
  }
  seeded = await loaded.loadTextboltCheck()
})

test.afterAll(async () => {
  if (seeded) await rm(seeded.userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
  await server?.close()
})

test('zip export: the report opens offline and every interaction works under its CSP', async () => {
  test.setTimeout(240_000)
  const fixture = requiredSeed()
  const zipPath = path.join(workDir, 'report.zip')
  const result = await exportHtml(fixture, 'zip', zipPath)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) return
  expect(result.filename).toMatch(/^textbolt\.com-.+-ai-visibility-\d{4}-\d{2}-\d{2}\.zip$/)

  const entries = readStoredZip(await readFile(result.filePath))
  const folder = result.filename.replace(/\.zip$/, '')
  expect(entries.map((entry) => entry.name).sort()).toEqual([
    `${folder}/README.txt`,
    `${folder}/index.html`
  ])
  const html =
    entries.find((entry) => entry.name.endsWith('/index.html'))?.data.toString('utf8') ?? ''
  const readme =
    entries.find((entry) => entry.name.endsWith('/README.txt'))?.data.toString('utf8') ?? ''
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(readme).toContain('index.html')
  expect(readme).toContain('no network requests')

  const siteDir = path.join(workDir, folder)
  await mkdir(siteDir, { recursive: true })
  const indexPath = path.join(siteDir, 'index.html')
  await writeFile(indexPath, html)
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch()
  try {
    const { page, problems, requests } = await openReport(browser, indexPath, 1280)
    await page.screenshot({ path: path.join(SHOTS, 'report-1280.png'), fullPage: true })

    // The KPI's drawer lists exactly the number on the KPI (NFR-14).
    const kpi = page.locator('.kpi', { hasText: 'AI Overview appears' }).locator('button.drill')
    await expect(kpi).toHaveCount(1)
    const shown = Number(await kpi.textContent())
    expect(await kpi.getAttribute('data-n')).toBe(String(shown))
    await kpi.click()
    const drawer = page.getByRole('dialog', { name: 'AI Overview appears' })
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('tbody tr')).toHaveCount(shown)
    await expect(drawer.getByTestId('drawer-summary')).toContainText(`Questions${shown}`)
    await page.screenshot({ path: path.join(SHOTS, 'report-1280-drawer.png') })
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-drill'))).toBe(
      'aio:shown'
    )

    // One check so far: the headline sits on the cover, the verdict is a first
    // measurement, "What to do next" follows it, What changed has nothing to compare, and
    // "How this report was made" closes the report.
    const sectionIds = await page
      .locator('main > section')
      .evaluateAll((items) => items.map((item) => item.id))
    expect(sectionIds.slice(0, 5)).toEqual([
      'sec-cover',
      'sec-verdict',
      'sec-next',
      'sec-overview',
      'sec-what-changed'
    ])
    expect(sectionIds.at(-1)).toBe('sec-method')
    await expect(page.getByTestId('report-headline')).toContainText('your buyer prompt')
    const recs = page.locator('[data-testid="recommendations"] > li')
    expect(await recs.count()).toBeGreaterThan(0)
    expect(await recs.count()).toBeLessThanOrEqual(3)
    await expect(recs.first().locator('.rec-label').first()).toHaveText('Do this')
    await expect(recs.first().locator('tbody tr').first()).toBeVisible()
    await page.locator('#sec-next').screenshot({ path: path.join(SHOTS, 'report-1280-next.png') })
    await expect(page.getByTestId('verdict-badge')).toHaveText('Too early to tell')
    await expect(page.locator('.vd-finding').first()).toContainText('First measurement.')
    await expect(page.locator('#sec-what-changed')).toContainText('Nothing to compare yet')
    await expect(page.locator('#sec-method')).toContainText('Prompts searched')

    // Every other drill button agrees with its drawer too.
    const drills = page.locator('main button.drill')
    const total = await drills.count()
    expect(total).toBeGreaterThan(20)
    for (let index = 0; index < total; index += 1) {
      const drill = drills.nth(index)
      if (!(await drill.isVisible())) continue
      const n = Number(await drill.getAttribute('data-n'))
      expect(await drill.textContent()).toBe(String(n))
      await drill.click()
      await expect(page.locator('#drawer tbody tr')).toHaveCount(n)
      await page.keyboard.press('Escape')
      await expect(page.locator('#drawer')).toBeHidden()
    }

    // Search: a word from a real prompt opens the drawer with at least that prompt.
    const word = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('report-data')?.textContent ?? '{}') as {
        rows: { text: string }[]
      }
      const words = (data.rows[0]?.text ?? '')
        .split(/[^A-Za-z]+/)
        .filter((item) => item.length >= 5)
      return words[0] ?? ''
    })
    expect(word.length).toBeGreaterThan(0)
    await page.getByRole('searchbox', { name: 'Search all prompts' }).fill(word)
    await expect(page.locator('#search-status')).toContainText('match')
    await page.getByRole('searchbox', { name: 'Search all prompts' }).press('Enter')
    await expect(page.locator('#drawer')).toBeVisible()
    expect(await page.locator('#drawer tbody tr').count()).toBeGreaterThanOrEqual(1)
    await page.keyboard.press('Escape')

    // CSV: a Blob download with the UTF-8 BOM.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.csv-btn[data-table="prompts"]').click()
    ])
    expect(download.suggestedFilename()).toMatch(/-prompts\.csv$/)
    const csv = await readFile(await download.path())
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(csv.toString('utf8')).toContain('\r\n')

    // Focus mode hides the section nav.
    await page.getByRole('button', { name: 'Focus' }).click()
    await expect(page.getByRole('button', { name: 'Focus' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByRole('navigation', { name: 'Report sections' })).toBeHidden()
    await page.getByRole('button', { name: 'Focus' }).click()

    // Print: collapsed rows become visible, chrome is hidden.
    const collapsed = page.locator('[data-table-wrap].collapsed tr.extra')
    const hiddenRows = await collapsed.count()
    if (hiddenRows > 0) await expect(collapsed.first()).toBeHidden()
    await page.emulateMedia({ media: 'print' })
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    for (const row of await page.locator('main tbody tr').all()) await expect(row).toBeVisible()
    await expect(page.locator('.topbar')).toBeHidden()
    await expect(page.locator('.csv-btn').first()).toBeHidden()
    test.info().annotations.push({
      type: 'print',
      description: `${hiddenRows} collapsed rows expanded for print`
    })
    await page.screenshot({ path: path.join(SHOTS, 'report-print.png'), fullPage: true })
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))

    expect(problems).toEqual([])
    expect(requests).toEqual([])
    await page.close()

    // 640 px: no horizontal scroll, the drawer still opens.
    const narrow = await openReport(browser, indexPath, 640)
    await narrow.page.screenshot({ path: path.join(SHOTS, 'report-640.png'), fullPage: true })
    expect(
      await narrow.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ).toBeLessThanOrEqual(0)
    await narrow.page
      .locator('.kpi', { hasText: 'AI Overview appears' })
      .locator('button.drill')
      .click()
    await expect(narrow.page.locator('#drawer tbody tr')).toHaveCount(shown)
    await narrow.page.screenshot({ path: path.join(SHOTS, 'report-640-drawer.png') })
    expect(narrow.problems).toEqual([])
  } finally {
    await browser.close()
  }
})

test('perspectives over two full checks: verdict, What changed chips, kinds of site, method', async () => {
  test.setTimeout(120_000)
  // The rich TextBolt sample has an earlier full check, so every perspective has data.
  const rendered = (await requiredServer().ssrLoadModule(
    path.resolve('tests/e2e/report-html-sample.ts')
  )) as { sampleReportHtml: () => string }
  const indexPath = path.join(workDir, 'sample', 'index.html')
  await mkdir(path.dirname(indexPath), { recursive: true })
  await writeFile(indexPath, rendered.sampleReportHtml())

  const browser = await chromium.launch()
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1134, height: 770 }
    ]) {
      const { page, problems, requests } = await openReport(browser, indexPath, viewport.width, {
        height: viewport.height
      })
      const tag = `${viewport.width}x${viewport.height}`
      await page.screenshot({ path: await e2eArtifact(`report-perspectives-${tag}.png`) })
      await page.screenshot({
        path: await e2eArtifact(`report-perspectives-${tag}-full.png`),
        fullPage: true
      })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      ).toBeLessThanOrEqual(0)

      // The verdict: a badge and findings; an inline number opens exactly its prompts.
      const verdict = page.locator('#sec-verdict')
      await expect(page.getByTestId('verdict-badge')).toHaveText('Working, early signs')
      await expect(verdict.locator('.vd-finding')).toHaveCount(5)
      await expect(verdict.locator('.vd-finding .vd-lead').first()).toHaveText(
        'More answers cite you.'
      )
      await verdict.scrollIntoViewIfNeeded()
      await verdict.screenshot({
        path: await e2eArtifact(`report-perspectives-${tag}-verdict.png`)
      })
      const gained = verdict.locator('button.drill[data-drill="change:gained"]').first()
      const gainedN = Number(await gained.textContent())
      expect(gainedN).toBeGreaterThan(0)
      await gained.click()
      const drawer = page.getByRole('dialog', { name: 'Gained since the 5 Oct 2026 check' })
      await expect(drawer).toBeVisible()
      await expect(drawer.locator('tbody tr')).toHaveCount(gainedN)
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      for (const number of await verdict.locator('button.drill').all()) {
        const n = Number(await number.getAttribute('data-n'))
        expect(await number.textContent()).toBe(String(n))
        await number.click()
        await expect(page.locator('#drawer tbody tr')).toHaveCount(n)
        await page.keyboard.press('Escape')
      }

      // What changed: each chip shows only its rows; All brings every row back.
      const changes = page.locator('#sec-what-changed')
      const tableRows = changes.locator('[data-table-wrap="what-changed"] tbody tr')
      const all = await tableRows.count()
      expect(all).toBeGreaterThan(10)
      for (const value of ['gained', 'lost', 'kept', 'never']) {
        const chip = changes.locator(`.seg[data-seg-value="${value}"]`)
        const n = Number(await chip.locator('.seg-n').textContent())
        await chip.click()
        await expect(chip).toHaveAttribute('aria-pressed', 'true')
        await expect(changes.locator(`tbody tr[data-seg="${value}"]:visible`)).toHaveCount(n)
        await expect(changes.locator('tbody tr:visible')).toHaveCount(n)
        const pill = changes
          .locator(`.chg-summary button.drill`)
          .nth(['gained', 'lost', 'kept', 'never'].indexOf(value))
        expect(Number(await pill.textContent())).toBe(n)
      }
      await changes.locator('.seg[data-seg-value="lost"]').click()
      await changes.scrollIntoViewIfNeeded()
      await changes.screenshot({
        path: await e2eArtifact(`report-perspectives-${tag}-what-changed.png`)
      })
      await changes.locator('.seg[data-seg-value=""]').click()
      await expect(changes.locator('tbody tr:visible')).toHaveCount(Math.min(all, 12))

      // Competition: the kind table, the Kind column and the faint earlier bars.
      const kinds = page.locator('[data-table-wrap="site-kinds"]')
      await expect(kinds.locator('tbody tr').first()).toContainText('Video, social & forums')
      await expect(page.locator('#cp-domains + .lede + .card rect.before').first()).toBeAttached()
      const kindDrill = kinds.locator('button.drill').first()
      const kindN = Number(await kindDrill.textContent())
      await kindDrill.click()
      await expect(page.locator('#drawer tbody tr')).toHaveCount(kindN)
      await page.keyboard.press('Escape')
      await page.locator('#cp-kinds').scrollIntoViewIfNeeded()
      await page.screenshot({ path: await e2eArtifact(`report-perspectives-${tag}-kinds.png`) })

      // How this report was made, last.
      const method = page.locator('main > section').last()
      await expect(method).toHaveAttribute('id', 'sec-method')
      await expect(method).toContainText('What was searched and when')
      await expect(method).toContainText('different AI Overview')
      await method.scrollIntoViewIfNeeded()
      await method.screenshot({ path: await e2eArtifact(`report-perspectives-${tag}-method.png`) })

      expect(problems).toEqual([])
      expect(requests).toEqual([])
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('file export: the bare HTML file', async () => {
  test.setTimeout(180_000)
  const fixture = requiredSeed()
  const filePath = path.join(workDir, 'report.html')
  const result = await exportHtml(fixture, 'file', filePath)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) return
  expect(result.filename).toMatch(/^textbolt\.com-.+-ai-visibility-\d{4}-\d{2}-\d{2}\.html$/)
  const html = await readFile(result.filePath, 'utf8')
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('<script id="report-data" type="application/json">')
  expect(html).toContain('Built with CiteFox')
})

async function exportHtml(
  fixture: LoadedCheck,
  packaging: 'zip' | 'file',
  savePath: string
): Promise<ExportStartResult> {
  const { app, page } = await launchCiteFox({ userDataDir: fixture.userDataDir })
  try {
    await installSaveDialog(app, savePath)
    const request: ExportRequest = {
      projectId: fixture.projectId,
      scope: 'page',
      pageIds: [fixture.pageId],
      viewId: null,
      marketIds: [fixture.marketId],
      checks: 'all',
      from: null,
      to: null,
      sections: SECTIONS,
      format: 'html',
      pdf: null,
      xlsx: null,
      csv: null,
      html: { packaging },
      filenamePattern: '{project}-{page}-{date}.{ext}',
      timeZone: 'UTC',
      logoBase64: null
    }
    return await page.evaluate(
      async (body) =>
        (
          globalThis as typeof globalThis & {
            citefox: { 'exports:start': (request: ExportRequest) => Promise<ExportStartResult> }
          }
        ).citefox['exports:start'](body),
      request
    )
  } finally {
    await app.close()
  }
}

/** Saves under the default name the app offers, in the folder of `filePath`. */
async function installSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = args.find(
        (arg): arg is { defaultPath?: string } =>
          typeof arg === 'object' && arg !== null && 'defaultPath' in arg
      )
      return { canceled: false, filePath: `${folder}/${options?.defaultPath ?? 'report'}` }
    }) as typeof dialog.showSaveDialog
  }, path.dirname(filePath))
}

async function openReport(
  browser: Browser,
  indexPath: string,
  width: number,
  options: { height?: number } = {}
): Promise<{ page: Page; problems: string[]; requests: string[] }> {
  const context = await browser.newContext({
    viewport: { width, height: options.height ?? 900 },
    acceptDownloads: true
  })
  const page = await context.newPage()
  const problems: string[] = []
  const requests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || /Content Security Policy/i.test(message.text())) {
      problems.push(message.text())
    }
  })
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:'))
      requests.push(url)
  })
  await page.goto(pathToFileURL(indexPath).href)
  await expect(page.locator('html.js')).toHaveCount(1)
  return { page, problems, requests }
}

function requiredServer(): ViteDevServer {
  if (!server) throw new Error('The Vite loader did not start')
  return server
}

function requiredSeed(): LoadedCheck {
  if (!seeded) throw new Error('TextBolt check was not loaded')
  return seeded
}
