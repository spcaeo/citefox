import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AssistProgress, CheckProgress } from '@shared/ipc'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { launchOnboardedMock } from './onboarded'
import { installRawMarkdown } from './raw-hook'

/**
 * The work console (approved mock-up), favicons beside domains, and the Fill
 * card's tabs, in the built app at 1440×900.
 *
 * The console listens to the progress events main already pushes. Here main
 * sends a fixture check's `checks:progress` events and a fill's
 * `assist:progress` steps itself, so no search or Claude call runs. Favicons
 * are off in e2e (`CITEFOX_FAVICONS=off`); `favicons:get` is stubbed in main
 * with drawn icons, so nothing is fetched from the network.
 */

const VIEWPORT = { width: 1440, height: 900 }

async function openSeeded(prefix: string): Promise<{
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
}> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
  await seedTwoMarketProject(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
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

/** Sends one push event from main to the window, as the real jobs do. */
async function push(app: ElectronApplication, channel: string, payload: unknown): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [name, value]) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(name as string, value)
    },
    [channel, payload] as const
  )
}

function check(extra: Partial<CheckProgress> = {}): CheckProgress {
  return {
    jobId: 'job-e2e',
    projectId: 'proj-1',
    pageId: 'page-1',
    marketId: 'mkt-us',
    promptId: 'prompt-1',
    sampleNo: 1,
    phase: 'search',
    state: 'running',
    detail: 'how do i alert the crew without a developer?',
    nextStep: null,
    errorCode: null,
    retrySearches: 0,
    done: 3,
    total: 12,
    searchesUsed: 3,
    searchesMax: 24,
    monthUsed: null,
    monthLimit: null,
    markets: [],
    ...extra
  }
}

function fillStep(extra: Partial<AssistProgress>): AssistProgress {
  return {
    runId: 'run-fill',
    channel: 'projects:fillFromWebsite',
    scope: 'textbolt.com',
    stepId: 'read-home',
    kind: 'read',
    label: 'Reading /',
    state: 'done',
    detail: 'Read · 820 words',
    startedAt: Date.now() - 4000,
    endedAt: Date.now() - 3000,
    claude: null,
    ...extra
  }
}

/**
 * The prompt before a stage, as the console draws it on this computer: `C:\CITEFOX\CHECKS\READ>`
 * on Windows, `citefox/checks/read $` on macOS and Linux. `short` is the pill's form.
 */
function prompt(parts: readonly string[], short = false): string {
  const all = short ? parts : ['CITEFOX', ...parts]
  return process.platform === 'win32'
    ? `C:\\${all.join('\\')}>`
    : `${all.join('/').toLowerCase()} $`
}

const consoleWindow = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'CiteFox work console' })
const pill = (page: Page): Locator => page.getByRole('button', { name: /Open the work console/ })

test('the work console follows a check, minimises, shakes when done and closes itself', async () => {
  test.setTimeout(150_000)
  const { app, page, close } = await openSeeded('work-console')
  try {
    await page.evaluate(() => {
      window.location.hash = '#/overview'
    })
    await expect(consoleWindow(page)).toHaveCount(0)

    // A check starts: the window opens on its own with the stage prompt.
    await push(app, 'checks:progress', check({ phase: 'reread', done: 0, detail: 'Re-reading' }))
    await push(app, 'checks:progress', check())
    const win = consoleWindow(page)
    await expect(win).toBeVisible()
    const log = win.getByRole('log')
    await expect(log).toHaveAttribute('aria-live', 'polite')
    await expect(log).toContainText(prompt(['CHECKS', 'READ']))
    await expect(log).toContainText(prompt(['CHECKS', 'SEARCH']))
    await expect(log).toContainText('3 of 12 questions')
    await expect(win.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')

    // AI generation in the same window: a fill run shows as a second job tab.
    await push(app, 'assist:progress', fillStep({}))
    await push(
      app,
      'assist:progress',
      fillStep({
        stepId: 'ask',
        kind: 'claude',
        label: 'Asking Claude to find brand names and competitors',
        state: 'running',
        detail: null,
        endedAt: null,
        claude: { connection: 'claude-code', connectionText: 'Claude · on your plan', model: null }
      })
    )
    await expect(win.getByRole('tab', { name: /Fill from textbolt\.com/ })).toBeVisible()
    await expect(log).toContainText(prompt(['FILL', 'CLAUDE']))
    await page.screenshot({ path: await e2eArtifact('work-console-open.png') })

    // Dragged by its title bar, it stays where it was put.
    const bar = win.locator('.wc-bar')
    const before = await win.boundingBox()
    const grip = await bar.boundingBox()
    if (!before || !grip) throw new Error('console not laid out')
    await page.mouse.move(grip.x + 40, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x - 260, grip.y - 200, { steps: 8 })
    await page.mouse.up()
    const after = await win.boundingBox()
    expect(after?.x ?? 0).toBeLessThan(before.x - 200)
    expect(after?.y ?? 0).toBeLessThan(before.y - 150)

    // The fill finishes; Escape minimises the window to the pill.
    await push(
      app,
      'assist:progress',
      fillStep({ stepId: 'result', kind: 'result', label: '31 suggestions', state: 'done' })
    )
    await log.focus()
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0)
    await expect(pill(page)).toBeVisible()
    await expect(pill(page)).toContainText(prompt(['CHECKS', 'SEARCH'], true))
    await page.screenshot({ path: await e2eArtifact('work-console-minimised.png') })

    // The check ends while minimised: the pill turns green and shakes, then waits.
    await push(app, 'checks:progress', check({ done: 12, state: 'ok', detail: 'Done' }))
    await expect(pill(page)).toHaveClass(/wc-pill-done/)
    await expect(pill(page)).toHaveClass(/wc-pill-shake|wc-pill-glow/)
    await expect(pill(page)).toContainText('Check done')
    await page.screenshot({ path: await e2eArtifact('work-console-done.png') })

    // A click opens the finished check; opened by hand, it stays until closed.
    await pill(page).click()
    await expect(win).toBeVisible()
    await expect(win.getByRole('log')).toContainText('12 of 12 questions checked')
    await expect(win.getByRole('log')).not.toContainText('closing in')

    // Work that ends while the window is open counts down and closes by itself.
    await push(app, 'checks:progress', check({ jobId: 'job-e2e-2', done: 1, total: 2 }))
    await push(
      app,
      'checks:progress',
      check({ jobId: 'job-e2e-2', done: 2, total: 2, state: 'ok', detail: 'Done' })
    )
    await expect(win.getByRole('log')).toContainText(/closing in \d/)
    await page.screenshot({ path: await e2eArtifact('work-console-done-open.png') })
    await expect(win).toHaveCount(0, { timeout: 10_000 })

    // The top bar's Activity button reopens it.
    const activity = page.getByRole('button', { name: /^Activity/ })
    await activity.click()
    await expect(win).toBeVisible()
    await expect(activity).toHaveAttribute('aria-expanded', 'true')
    await activity.click()
    await expect(win).toHaveCount(0)
  } finally {
    await close()
  }
})

test('a failed check is red, stays open, and retry starts it again', async () => {
  test.setTimeout(120_000)
  const { app, page, close } = await openSeeded('work-console-error')
  try {
    await app.evaluate(({ ipcMain }) => {
      const calls: unknown[] = []
      ;(globalThis as { __retryCalls?: unknown[] }).__retryCalls = calls
      ipcMain.removeHandler('checks:start')
      ipcMain.handle('checks:start', (_event, request: unknown) => {
        calls.push(request)
        return { jobId: 'job-retry' }
      })
    })
    await push(app, 'checks:progress', check())
    await push(
      app,
      'checks:progress',
      check({
        done: 12,
        state: 'error',
        detail: 'SerpApi refused the key.',
        nextStep: 'Paste the key again in Settings → Connections.',
        errorCode: 'rejected'
      })
    )
    const win = consoleWindow(page)
    const log = win.getByRole('log')
    await expect(win).toHaveAttribute('data-console-status', 'error')
    await expect(log).toContainText('SerpApi refused the key.')
    await expect(log).toContainText('Paste the key again')
    await page.screenshot({ path: await e2eArtifact('work-console-error.png') })
    // Errors never close by themselves.
    await page.waitForTimeout(6500)
    await expect(win).toBeVisible()
    await log.getByRole('button', { name: /retry/i }).click()
    await expect(log).toContainText('retry sent')
    const calls = await app.evaluate(
      () => (globalThis as { __retryCalls?: unknown[] }).__retryCalls ?? []
    )
    expect(calls).toEqual([
      { projectId: 'proj-1', pageIds: ['page-1'], marketIds: null, promptIds: null }
    ])
  } finally {
    await close()
  }
})

/** Drawn icons for `favicons:get`: a coloured tile per domain, none for every third. */
async function stubFavicons(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
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
  })
}

test('lists show a site icon beside each domain, a letter tile until it loads', async () => {
  test.setTimeout(120_000)
  const { app, page, close } = await openSeeded('favicons')
  try {
    await stubFavicons(app)
    // The renderer keeps answers for its life; reload so it asks the stub.
    await page.reload()
    await page.evaluate(() => {
      window.location.hash = '#/overview'
    })
    const cited = page.locator('.ov-sites')
    await expect(cited).toBeVisible()
    await expect(cited.locator('img.site-icon').first()).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('favicons-overview.png') })

    await page.evaluate(() => {
      window.location.hash = '#/competitors'
    })
    // Every site list shares the icon | name | website | type columns.
    const sites = page.locator('#main').getByRole('grid', { name: 'Cited sites' })
    await expect(sites).toBeVisible()
    await expect(sites.locator('[data-site-icon]').first()).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('favicons-competitors.png') })
  } finally {
    await close()
  }
})

test('the Fill card shows its suggestions in tabs, the open tab in the URL', async () => {
  test.setTimeout(150_000)
  // The mock build, already onboarded; the Fill card lives on New project.
  const { app, page, dir } = await launchOnboardedMock('fill-tabs', { viewport: VIEWPORT })
  try {
    await stubFavicons(app)
    await page.evaluate(() => {
      window.location.hash = '#/projects/new'
    })
    const form = page.getByRole('form', { name: 'New project' })
    await form.getByLabel('Project name').fill('TextBolt Two')
    await form.getByLabel('Website domain').fill('textbolt.com')
    await form.getByTestId('su').getByRole('button', { name: 'Read my website' }).click()
    const card = page.getByRole('region', { name: 'Suggestions from the website' })
    await expect(card).toBeVisible()
    const tabs = card.getByRole('tablist', { name: 'Suggestion groups' })
    await expect(tabs.getByRole('tab')).toHaveText([
      /Competitors/,
      /Buyers/,
      /Switching from/,
      /Integrations/,
      /Brand & market/
    ])
    // A price per competitor on each row.
    await expect(card.locator('.fill-rival .fill-price').first()).toBeVisible()
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: await e2eArtifact('fill-tabs-competitors.png') })
    await card.screenshot({ path: await e2eArtifact('fill-tabs-competitors-card.png') })

    await tabs.getByRole('tab', { name: /Buyers/ }).click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('fill=buyers')
    await expect(card.getByRole('list', { name: 'Buyer types' })).toBeVisible()
    await card.screenshot({ path: await e2eArtifact('fill-tabs-buyers.png') })

    await tabs.getByRole('tab', { name: /Brand & market/ }).click()
    await expect(card.getByRole('button', { name: 'Add brand' }).first()).toBeVisible()
    await card.screenshot({ path: await e2eArtifact('fill-tabs-brand.png') })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
