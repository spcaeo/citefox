import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import type { ExportStartResult } from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { e2eArtifactsDir } from './artifacts'
import { launchCiteFox } from './launch'

/**
 * Drill-downs inside the downloaded HTML report, in a real browser: one real check
 * against the recorded fixtures, `exports:start` over IPC, then the saved file opened
 * from disk with its CSP in force. It drills three levels (list -> answer -> site),
 * uses Back, the browser's Back and Forward, copies the view's link, reopens the file
 * from that link, and checks print and a narrow window.
 *
 * Screenshots go to CITEFOX_REPORT_DRILL_SHOTS, or test-results/e2e/report-drill.
 */

interface LoadedCheck {
  userDataDir: string
  projectId: string
  pageId: string
  marketId: string
}

const SHOTS = process.env.CITEFOX_REPORT_DRILL_SHOTS ?? path.join(e2eArtifactsDir(), 'report-drill')

let server: ViteDevServer | undefined
let seeded: LoadedCheck | undefined
let workDir = ''

test.beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'citefox-report-drill-'))
  server = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true },
    resolve: { alias: { '@shared': path.resolve('src/shared') } },
    cacheDir: path.resolve('node_modules/.vite-report-drill'),
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

test('the downloaded report drills three levels, goes back, and reopens from a copied link', async () => {
  test.setTimeout(240_000)
  if (!seeded) throw new Error('TextBolt check was not loaded')
  const result = await exportHtml(seeded, path.join(workDir, 'report.html'))
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) return
  const html = await readFile(result.filePath, 'utf8')
  const indexPath = path.join(workDir, 'site', 'index.html')
  await mkdir(path.dirname(indexPath), { recursive: true })
  await writeFile(indexPath, html)
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch()
  try {
    const { page, problems, requests } = await openReport(browser, pathToFileURL(indexPath).href)
    const drawer = page.locator('#drawer')
    const title = page.locator('#drawer-title')
    const target = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('report-data')?.textContent ?? '{}') as {
        rows: { id: string; text: string; refs: [number, string, string, string, string][] }[]
      }
      for (const row of data.rows) {
        const ref = row.refs.find((item) => item[4] === 'other' || item[4] === 'competitor')
        if (ref) return { id: row.id, text: row.text, domain: ref[2] }
      }
      return null
    })
    if (target === null) throw new Error('no answer cites another site')

    // Level 1: a KPI opens its prompt list.
    const kpi = page.locator('.kpi .drill[data-drill="all"]')
    await kpi.click()
    await expect(drawer).toBeVisible()
    const listTitle = (await title.textContent()) ?? ''
    await expect(page.locator('#drawer-back')).toBeHidden()
    expect(decodeURIComponent(new URL(page.url()).hash)).toBe('#d=l:all')
    await page.screenshot({ path: path.join(SHOTS, '1-list.png') })

    // Level 2: one prompt's answer, with every site it cites.
    await page.locator(`#drawer-body button[data-open="q:${target.id}"]`).click()
    await expect(title).toHaveText(target.text)
    await expect(title).toBeFocused()
    await expect(page.locator('#drawer-body .answer')).toBeVisible()
    await expect(page.locator('#drawer-body table.drawer-refs tbody tr').first()).toBeVisible()
    await expect(page.locator('#drawer-trail li')).toHaveCount(2)
    await page.screenshot({ path: path.join(SHOTS, '2-answer.png') })

    // Level 3: the prompts citing one of those sites.
    await page.locator(`#drawer-body button[data-open="dom:${target.domain}"]`).first().click()
    await expect(title).toHaveText(target.domain)
    await expect(page.locator('#drawer-trail li')).toHaveCount(3)
    await expect(page.locator(`#drawer-body tr[data-row-id="${target.id}"]`)).toHaveCount(1)
    expect(decodeURIComponent(new URL(page.url()).hash)).toBe(
      `#d=l:all&d=q:${target.id}&d=dom:${target.domain}`
    )
    await page.screenshot({ path: path.join(SHOTS, '3-site.png') })

    // The panel's Back pops one level and returns focus to what opened the step.
    await page.locator('#drawer-back').click()
    await expect(title).toHaveText(target.text)
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-open'))).toBe(
      `dom:${target.domain}`
    )

    // The browser's Back and Forward walk through the same steps.
    await page.goBack()
    await expect(title).toHaveText(target.domain)
    await page.goBack()
    await expect(title).toHaveText(target.text)
    await page.goBack()
    await expect(title).toHaveText(listTitle)
    await page.goForward()
    await expect(title).toHaveText(target.text)

    // Copy link copies this view's address (the file path plus the hash).
    await page.locator('#drawer-link').click()
    const copied = await copiedText(page)
    expect(copied).toBe(page.url())
    expect(copied.startsWith('file://')).toBe(true)
    expect(decodeURIComponent(new URL(copied).hash)).toBe(`#d=l:all&d=q:${target.id}`)

    // CSV of the panel's rows.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#drawer-csv').click()
    ])
    const csv = (await readFile(await download.path())).toString('utf8')
    expect(csv).toContain('"Position","Site","Cited page","Title","Kind"')

    // Escape closes one level at a time; focus returns to the KPI.
    await page.keyboard.press('Escape')
    await expect(title).toHaveText(listTitle)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(kpi).toBeFocused()
    expect(problems).toEqual([])
    expect(requests).toEqual([])
    await page.context().close()

    // A fresh window opened on the copied address shows the same view.
    const reopened = await openReport(browser, copied)
    await expect(reopened.page.locator('#drawer')).toBeVisible()
    await expect(reopened.page.locator('#drawer-title')).toHaveText(target.text)
    await expect(reopened.page.locator('#drawer-trail li')).toHaveCount(2)
    await reopened.page.screenshot({ path: path.join(SHOTS, '4-reopened.png') })
    await reopened.page.locator('#drawer-back').click()
    await expect(reopened.page.locator('#drawer-title')).toHaveText(listTitle)

    // A filter and a section live in the address too.
    await reopened.page.locator('#drawer-close').click()
    await expect(reopened.page.locator('#drawer')).toBeHidden()
    const filter = reopened.page.locator('[data-filter="prompts"]')
    await filter.fill(target.text.split(' ')[0] ?? '')
    await expect.poll(() => new URL(reopened.page.url()).hash).toContain('f=prompts')

    // Print: tables print in full and the panel is hidden even when it is open.
    await reopened.page.locator('.kpi .drill[data-drill="all"]').click()
    await reopened.page.emulateMedia({ media: 'print' })
    await reopened.page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await expect(reopened.page.locator('#drawer')).toBeHidden()
    for (const row of await reopened.page.locator('main tbody tr').all()) {
      await expect(row).toBeVisible()
    }
    await reopened.page.screenshot({ path: path.join(SHOTS, '5-print.png'), fullPage: true })
    await reopened.page.emulateMedia({ media: 'screen' })
    expect(reopened.problems).toEqual([])
    await reopened.page.context().close()

    // 640 px: the answer step fits without sideways scrolling.
    const narrow = await openReport(
      browser,
      `${pathToFileURL(indexPath).href}#d=l:all&d=q:${target.id}`,
      640
    )
    await expect(narrow.page.locator('#drawer-title')).toHaveText(target.text)
    await narrow.page.screenshot({ path: path.join(SHOTS, '6-answer-640.png') })
    expect(
      await narrow.page.evaluate(() => {
        const body = document.getElementById('drawer-body')
        return body ? body.scrollWidth - body.clientWidth : 0
      })
    ).toBeLessThanOrEqual(0)
    expect(narrow.problems).toEqual([])
    await narrow.page.context().close()
  } finally {
    await browser.close()
  }
})

/** The clipboard's text, or the copy box's text when the browser blocked the clipboard. */
async function copiedText(page: Page): Promise<string> {
  const box = page.locator('#copy-box')
  await expect(page.locator('#toast.show, #copy-box:not([hidden])')).toBeVisible()
  if (await box.isVisible()) {
    const text = await page.locator('#copy-text').inputValue()
    await page.locator('#copy-done').click()
    return text
  }
  return page.evaluate(() => navigator.clipboard.readText())
}

async function exportHtml(fixture: LoadedCheck, savePath: string): Promise<ExportStartResult> {
  const { app, page } = await launchCiteFox({ userDataDir: fixture.userDataDir })
  try {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.find(
          (arg): arg is { defaultPath?: string } =>
            typeof arg === 'object' && arg !== null && 'defaultPath' in arg
        )
        return { canceled: false, filePath: `${folder}/${options?.defaultPath ?? 'report'}` }
      }) as typeof dialog.showSaveDialog
    }, path.dirname(savePath))
    const request: ExportRequest = {
      projectId: fixture.projectId,
      scope: 'page',
      pageIds: [fixture.pageId],
      viewId: null,
      marketIds: [fixture.marketId],
      checks: 'all',
      from: null,
      to: null,
      sections: ['overview', 'pages', 'competition', 'sources', 'prompts'],
      format: 'html',
      pdf: null,
      xlsx: null,
      csv: null,
      html: { packaging: 'file' },
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

async function openReport(
  browser: Browser,
  url: string,
  width = 1280
): Promise<{ page: Page; problems: string[]; requests: string[] }> {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    acceptDownloads: true,
    // No slide-in, so screenshots show the panel where it settles.
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write']
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
    const address = request.url()
    if (!/^(file|data|blob):/.test(address)) requests.push(address)
  })
  await page.goto(url)
  await expect(page.locator('html.js')).toHaveCount(1)
  return { page, problems, requests }
}
