import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'

/**
 * Every URL, domain and site path (UrlStates board): the site's icon in front,
 * Copy and Open revealed on hover or focus, a green tick for 1.5 s after a
 * copy (then the icons hide), Open hands the address to the system browser,
 * and Enter / Ctrl Enter work from the focused text. Screens with URLs are
 * captured at 1440×900 and 1134×770.
 */

const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }

async function openSeeded(prefix: string): Promise<{
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
}> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
  await seedTwoMarketProject(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: WIDE })
  await expect(page.locator('#main')).toBeVisible()
  return {
    app,
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** Drawn icons for `favicons:get` (the network is off in e2e): a tile per domain, none for every third. */
async function stubMain(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain, shell }) => {
    const colors = ['#1a73e8', '#0f9d58', '#e8710a', '#a142f4', '#d93025', '#12b5cb']
    ipcMain.removeHandler('favicons:get')
    ipcMain.handle('favicons:get', (_event, request: { domains: string[] }) => ({
      icons: request.domains.map((domain, index) => {
        if (index % 3 === 2) return { domain, dataUri: null }
        const color = colors[domain.length % colors.length] ?? '#1a73e8'
        const letter = domain.charAt(0).toUpperCase()
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><text x="16" y="22" font-family="Arial" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`
        return {
          domain,
          dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
        }
      })
    }))
    const store = globalThis as unknown as { __citefoxOpened?: string[]; __citefoxShown?: string[] }
    store.__citefoxOpened = []
    store.__citefoxShown = []
    shell.openExternal = (async (url: string) => {
      store.__citefoxOpened?.push(url)
    }) as typeof shell.openExternal
    shell.showItemInFolder = ((filePath: string) => {
      store.__citefoxShown?.push(filePath)
    }) as typeof shell.showItemInFolder
  })
}

async function shown(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __citefoxShown?: string[] }).__citefoxShown ?? []
  )
}

async function opened(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __citefoxOpened?: string[] }).__citefoxOpened ?? []
  )
}

/** The address as the browser hands it on (`https://a.com` → `https://a.com/`). */
function normal(href: string): string {
  return new URL(href).toString()
}

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
}

async function actionsOpacity(url: Locator): Promise<string> {
  return url
    .locator('.ui-url-actions')
    .evaluate((element) => window.getComputedStyle(element).opacity)
}

/**
 * Leaves, then hovers the text until Copy and Open show. The hidden test window
 * sometimes misses a first hover, so it tries again rather than wait on a lost one.
 */
async function hoverUntilShown(page: Page, url: Locator): Promise<void> {
  await expect(async () => {
    await page.mouse.move(1, 1)
    await url.locator('.ui-url-value').hover()
    await expect.poll(() => actionsOpacity(url), { timeout: 1000 }).toBe('1')
  }).toPass({ timeout: 15_000 })
}

test('a URL reveals Copy and Open on hover, ticks after a copy, opens in the browser, and works from the keyboard', async () => {
  test.setTimeout(120_000)
  const { app, page, close } = await openSeeded('site-urls')
  try {
    await stubMain(app)
    // The renderer keeps icon answers for its life; reload so it asks the stub.
    await page.reload()
    await go(page, '#/pages')
    const url = page.locator('#main .ui-url[data-url-text]').first()
    await expect(url).toBeVisible()
    const value = url.locator('.ui-url-value')
    const href = (await value.getAttribute('title')) ?? ''
    expect(href).toMatch(/^https?:\/\//)
    await expect(url.locator('[data-site-icon]')).toHaveCount(1)

    // At rest: icon and text only.
    await page.mouse.move(1, 1)
    await expect.poll(() => actionsOpacity(url)).toBe('0')

    // Hover: Copy and Open appear.
    await hoverUntilShown(page, url)
    await page.screenshot({ path: await e2eArtifact('site-urls-hover.png') })
    // A screenshot of the hidden test window drops the hover, so the pointer goes
    // back to the text after each one (else no leave fires when it moves away).
    await hoverUntilShown(page, url)

    // Copy: a green tick, the full URL on the clipboard, then the icons hide.
    const copy = url.locator('.ui-url-copy')
    await copy.click()
    await expect(copy).toHaveAttribute('aria-label', /^Copied /)
    await expect(url).toHaveClass(/ui-url-copied/)
    await page.screenshot({ path: await e2eArtifact('site-urls-copied.png') })
    await value.hover()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(href)
    await expect(page.locator('[data-announcer]')).toHaveText('Copied')
    await expect(url).toHaveClass(/ui-url-done/, { timeout: 3000 })
    await expect(copy).toHaveAttribute('aria-label', /^Copy /)
    await expect.poll(() => actionsOpacity(url)).toBe('0')

    // Leave and come back: shown again. Open goes to the system browser and hides them.
    await hoverUntilShown(page, url)
    await url.locator('.ui-url-open').click()
    await expect.poll(() => opened(app)).toEqual([normal(href)])
    await expect(url).toHaveClass(/ui-url-done/)

    // Keyboard: Tab reaches the text, Enter copies, Ctrl Enter opens.
    await page.mouse.move(1, 1)
    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    await value.focus()
    await expect.poll(() => actionsOpacity(url)).toBe('1')
    await page.keyboard.press('Enter')
    await expect(url).toHaveClass(/ui-url-copied/)
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(href)
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(href)
    await page.keyboard.press('Control+Enter')
    await expect.poll(() => opened(app)).toEqual([normal(href), normal(href)])
    await page.keyboard.press('Tab')
    await expect(url.locator('.ui-url-copy')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(url.locator('.ui-url-open')).toBeFocused()
  } finally {
    await close()
  }
})

test('a path copies and opens the full URL on its own site', async () => {
  test.setTimeout(120_000)
  const { app, page, close } = await openSeeded('site-urls-path')
  try {
    await stubMain(app)
    await page.reload()
    await go(page, '#/pages')
    const sitePath = page.locator('#main .ui-url[data-url-text="path"]').first()
    await expect(sitePath).toBeVisible()
    const label = (await sitePath.locator('.ui-url-value').textContent()) ?? ''
    const href = (await sitePath.locator('.ui-url-value').getAttribute('title')) ?? ''
    expect(label.startsWith('/')).toBe(true)
    expect(href).toMatch(
      new RegExp(`^https?://[^/]+${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    )
    await hoverUntilShown(page, sitePath)
    await sitePath.locator('.ui-url-copy').click()
    await expect(sitePath).toHaveClass(/ui-url-copied/)
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(href)

    // A file on this computer: Copy and Show in Finder (settings:revealPath), never Open.
    await go(page, '#/project-settings?tab=data')
    const file = page.locator('#main .ui-url[data-url-text="file"]').first()
    await file.scrollIntoViewIfNeeded()
    await expect(file).toBeVisible()
    await expect(file.locator('.ui-url-open')).toHaveCount(0)
    const filePath = (await file.locator('.ui-url-value').getAttribute('title')) ?? ''
    await hoverUntilShown(page, file)
    await file.locator('.ui-url-reveal').click()
    await expect.poll(async () => (await shown(app)).length).toBe(1)
    expect((await shown(app))[0]?.endsWith(path.basename(filePath))).toBe(true)
    await page.screenshot({ path: await e2eArtifact('site-urls-file.png') })
  } finally {
    await close()
  }
})

const SCREENS: readonly { name: string; hash: string }[] = [
  { name: 'overview', hash: '#/overview' },
  { name: 'citations', hash: '#/citations' },
  { name: 'competitors', hash: '#/competitors' },
  { name: 'questions', hash: '#/questions' },
  { name: 'all-pages', hash: '#/pages' },
  { name: 'page-results', hash: '#/pages/page-1/results' },
  { name: 'structure', hash: '#/structure' },
  { name: 'projects', hash: '#/projects' },
  { name: 'page-read', hash: '#/pages/page-1/read' },
  { name: 'prompt-detail', hash: '#/pages/page-1/prompt/prompt-1' },
  { name: 'project-settings-data', hash: '#/project-settings?tab=data' },
  { name: 'settings-data', hash: '#/settings?tab=data' }
]

test('screens with URLs, domains and paths at 1440×900 and 1134×770', async () => {
  test.setTimeout(240_000)
  const { app, page, close } = await openSeeded('site-urls-shots')
  try {
    await stubMain(app)
    await page.reload()
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size)
      for (const screen of SCREENS) {
        await go(page, screen.hash)
        await expect(page.locator('#main')).toBeVisible()
        // Let lists and icons settle.
        await page.waitForTimeout(700)
        const urls = page.locator('#main .ui-url')
        if ((await urls.count()) > 0) {
          const first = urls.first()
          if (await first.isVisible()) await first.locator('.ui-url-value').hover()
        }
        await page.screenshot({
          path: await e2eArtifact(`site-urls-${screen.name}-${size.width}.png`)
        })
        await page.mouse.move(1, 1)
      }
    }
  } finally {
    await close()
  }
})
