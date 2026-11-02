import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from '../e2e/launch'
import { sidebar } from '../e2e/nav-helpers'
import { installRawMarkdown } from '../e2e/raw-hook'
import { openHash } from '../e2e/screens-app'

/**
 * Marketing media for the README and the download site: seven screenshots and a
 * demo tour on the TextBolt demo project (no live calls, no keys, no AI).
 *
 * Not part of the e2e suite (tests/e2e). Run `npm run media:record`, which runs this
 * inside Docker (scripts/media/record-demo.mjs) and then turns the raw output into
 * docs/media/*.png, demo.mp4 and demo.gif. It refuses to run outside that container,
 * because it opens a visible window (the screencast needs one).
 *
 * Raw output goes to CITEFOX_MEDIA_OUT:
 * - shots/<name>.png at 2× (2880×1800),
 * - frames/NNNNN.jpg plus frames.json (screencast frames and their times),
 * - marks.json (when each tour step starts, for the GIF cut).
 */

const OUT = path.resolve(process.env.CITEFOX_MEDIA_OUT ?? 'test-results/media-out')
const VIEW = { width: 1440, height: 900 }
const TOPIC_ID = 'topic-textbolt-alerts'
const QUESTION = '#/pages/page-outlook/prompt/page-outlook-q0'

test.skip(
  process.env.CITEFOX_MEDIA_DOCKER !== '1',
  'Media recording opens a visible window: run it with npm run media:record (Docker).'
)

/** The rich Reports project (3 checks, 3 engines, fixes) plus the TextBolt topic. */
async function seed(): Promise<string> {
  installRawMarkdown()
  const { seedReportsProject, REPORTS_SEED } = await import('../e2e/reports-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-media-'))
  await seedReportsProject(dir)
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    seedTextboltTopic(db, {
      id: REPORTS_SEED.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    // Nothing is searched while recording: the queue stays paused.
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  return dir
}

/** Opens the seeded app in the default Sepia theme with the guide and its tips off. */
async function open(dir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: VIEW,
    // Visible inside the container's own Xvfb, so the screencast gets frames.
    env: { CITEFOX_DEFAULT_THEME: 'sepia', CITEFOX_E2E_BACKGROUND: undefined }
  })
  await expect(sidebar(page)).toBeVisible()
  await page.evaluate(() =>
    (window as unknown as { citefox: Record<string, (request: unknown) => Promise<unknown>> })
      .citefox['guide:update']!({ projectId: 'proj-1', tipsOff: true, hidden: true })
  )
  await page.reload()
  await expect(sidebar(page)).toBeVisible()
  await go(page, '#/overview', 'Summary')
  return { app, page }
}

async function go(page: Page, hash: string, heading?: string | RegExp): Promise<void> {
  await openHash(page, hash)
  if (heading !== undefined) {
    await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible()
  }
  await settle(page)
}

/** Waits for loading text and spinners to go, then for charts to finish growing. */
async function settle(page: Page): Promise<void> {
  await expect(page.locator('#main').getByText(/^Loading/)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('#main [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
  await page.waitForTimeout(800)
}

/** Scrolls the nearest scrolling box so `target` sits `offset` px below its top. */
async function scrollIntoTop(page: Page, target: Locator, offset = 96): Promise<void> {
  await target.evaluate((node, gap) => {
    const scrolls = (box: HTMLElement): boolean =>
      box.scrollHeight > box.clientHeight + 4 &&
      ['auto', 'scroll'].includes(getComputedStyle(box).overflowY)
    let scroller: HTMLElement | null = node.parentElement
    while (scroller && !scrolls(scroller)) scroller = scroller.parentElement
    const host = scroller ?? document.scrollingElement
    if (!host) return
    const hostTop = scroller ? scroller.getBoundingClientRect().top : 0
    host.scrollBy({
      top: node.getBoundingClientRect().top - hostTop - gap,
      behavior: 'instant' as ScrollBehavior
    })
  }, offset)
  await page.waitForTimeout(400)
}

// ---- Screenshots -------------------------------------------------------------

test('screenshots', async () => {
  const shots = path.join(OUT, 'shots')
  await mkdir(shots, { recursive: true })
  const dir = await seed()
  const { app, page } = await open(dir)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    ...VIEW,
    deviceScaleFactor: 2,
    mobile: false
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const snap = async (name: string): Promise<void> => {
    await page.mouse.move(VIEW.width - 4, VIEW.height - 4)
    await page.waitForTimeout(700)
    // Straight from CDP: Playwright's own screenshot scales back to its 1× viewport.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'))
  }
  try {
    await go(page, '#/overview', 'Summary')
    await snap('hero')
    await scrollIntoTop(page, page.locator('#main').getByText('Results at a glance').first(), 40)
    await snap('summary')

    await go(page, QUESTION, /send a text message from Outlook/)
    // From the top: the question, its status, the AI Overview and its sources with this page.
    await snap('question')

    await go(page, '#/competitors', 'Competitors')
    await snap('competitors')

    await go(page, '#/fixes', 'Fixes')
    await page.locator('#main').getByText('Improve a page', { exact: true }).first().click()
    await settle(page)
    await snap('fixes')

    await go(page, '#/reports', 'Reports')
    await snap('reports-home')

    await go(page, '#/reports?report=visibility', 'Reports')
    await expect(page.locator('#rv-opp-title')).toBeVisible()
    await scrollIntoTop(page, page.locator('#rv-funnel-title'), 60)
    await snap('report-visibility')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- Demo tour ---------------------------------------------------------------

/** A soft pointer and a caption drawn in the page (the screencast has no system cursor). */
async function installOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('media-pointer')) return
    const style = document.createElement('style')
    style.textContent = `
      #media-pointer { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px;
        border-radius: 50%; background: rgba(30, 30, 30, .28); border: 2px solid rgba(255, 255, 255, .9);
        box-shadow: 0 1px 6px rgba(0, 0, 0, .25); pointer-events: none; z-index: 2147483647;
        transition: transform .7s cubic-bezier(.4, 0, .2, 1), scale .15s ease; }
      #media-pointer.down { scale: .7; }
      #media-caption { position: fixed; left: 50%; bottom: 36px; transform: translate(-50%, 12px);
        padding: 12px 22px; border-radius: 999px; background: rgba(28, 25, 23, .9); color: #fff;
        font: 600 22px/1.2 "Inter Variable", system-ui, sans-serif; letter-spacing: -.01em;
        pointer-events: none; z-index: 2147483646; opacity: 0; transition: opacity .35s, transform .35s; }
      #media-caption.on { opacity: 1; transform: translate(-50%, 0); }`
    document.head.appendChild(style)
    const dot = document.createElement('div')
    dot.id = 'media-pointer'
    dot.style.transform = 'translate(720px, 450px)'
    document.body.appendChild(dot)
    const caption = document.createElement('div')
    caption.id = 'media-caption'
    document.body.appendChild(caption)
  })
}

async function caption(page: Page, text: string | null): Promise<void> {
  await page.evaluate((next) => {
    const node = document.getElementById('media-caption')
    if (!node) return
    if (next === null) {
      node.classList.remove('on')
      return
    }
    node.textContent = next
    node.classList.add('on')
  }, text)
}

async function pointTo(page: Page, target: Locator): Promise<{ x: number; y: number }> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('Nothing to point at')
  const x = Math.round(box.x + Math.min(box.width / 2, 60))
  const y = Math.round(box.y + box.height / 2)
  await page.evaluate(
    ([left, top]) => {
      const dot = document.getElementById('media-pointer')
      if (dot) dot.style.transform = `translate(${left}px, ${top}px)`
    },
    [x, y]
  )
  await page.waitForTimeout(800)
  return { x, y }
}

async function press(page: Page, target: Locator): Promise<void> {
  const { x, y } = await pointTo(page, target)
  await page.evaluate(() => document.getElementById('media-pointer')?.classList.add('down'))
  await page.waitForTimeout(150)
  await page.mouse.click(x, y)
  await page.evaluate(() => document.getElementById('media-pointer')?.classList.remove('down'))
}

/** Smooth scroll of the pane under (900, 500) by `by` pixels over about `ms`. */
async function glide(page: Page, by: number, ms = 1400): Promise<void> {
  const steps = Math.max(1, Math.round(ms / 40))
  await page.mouse.move(900, 500)
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, by / steps)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(300)
}

test('demo tour', async () => {
  test.setTimeout(600_000)
  const framesDir = path.join(OUT, 'frames')
  await mkdir(framesDir, { recursive: true })
  const dir = await seed()
  const { app, page } = await open(dir)
  const cdp = await page.context().newCDPSession(page)
  const frames: { file: string; at: number }[] = []
  const writes: Promise<void>[] = []
  cdp.on('Page.screencastFrame', (frame) => {
    const file = `${String(frames.length).padStart(5, '0')}.jpg`
    frames.push({ file, at: frame.metadata.timestamp ?? Date.now() / 1000 })
    writes.push(writeFile(path.join(framesDir, file), Buffer.from(frame.data, 'base64')))
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined)
  })
  const marks: Record<string, number> = {}
  const mark = (name: string): void => {
    marks[name] = Date.now() / 1000
  }
  const m = page.locator('#main')
  const nav = sidebar(page)
  try {
    await installOverlay(page)
    await page.waitForTimeout(500)
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: VIEW.width,
      maxHeight: VIEW.height,
      everyNthFrame: 1
    })
    mark('start')

    // 1. Summary
    await page.waitForTimeout(400)
    await caption(page, 'See if AI cites you')
    await page.waitForTimeout(2200)
    await glide(page, 520, 1100)
    await page.waitForTimeout(1000)
    await glide(page, -520, 900)
    await caption(page, null)

    // 2. A topic, then a question
    mark('topic')
    await press(page, nav.getByRole('link', { name: /^Topics\b/ }))
    await settle(page)
    await page.waitForTimeout(300)
    const topicLink = m
      .getByRole('link', { name: /^Text alerts for teams without a developer/ })
      .first()
    if ((await topicLink.count()) > 0) await press(page, topicLink)
    else await openHash(page, `#/topics/${TOPIC_ID}`)
    await expect(page.getByRole('region', { name: 'Topic summary' })).toBeVisible()
    await settle(page)
    await page.waitForTimeout(1800)
    await glide(page, 300, 900)
    await page.waitForTimeout(700)

    mark('question')
    await press(page, nav.getByRole('link', { name: /^Questions\b/ }))
    await settle(page)
    await page.waitForTimeout(500)
    const row = m.getByText('How do I send a text message from Outlook?', { exact: true }).first()
    if ((await row.count()) > 0 && (await row.isVisible())) {
      await press(page, row)
      await page.waitForTimeout(300)
    }
    if (!(await page.evaluate(() => location.hash)).includes('/prompt/page-outlook-q0')) {
      await openHash(page, QUESTION)
    }
    await expect(page.getByRole('heading', { level: 1, name: /send a text message/ })).toBeVisible()
    await settle(page)
    await page.waitForTimeout(1400)
    await glide(page, 380)
    await page.waitForTimeout(1800)

    // 3. Competitors
    mark('competitors')
    await press(page, nav.getByRole('link', { name: /^Competitors\b/ }))
    await settle(page)
    await caption(page, 'Find who wins instead')
    await page.waitForTimeout(2200)
    await glide(page, 420)
    await page.waitForTimeout(1000)
    await caption(page, null)

    // 4. Fixes
    mark('fixes')
    await press(page, nav.getByRole('link', { name: /^Fixes\b/ }))
    await settle(page)
    await caption(page, 'Fix the right page')
    await page.waitForTimeout(1000)
    await press(page, m.getByText('Improve a page', { exact: true }).first())
    await page.waitForTimeout(2000)
    await caption(page, null)

    // 5. Reports: By goal, then the Visibility report and a drill
    mark('reports')
    await press(page, nav.getByRole('link', { name: /^Reports\b/ }))
    await settle(page)
    await caption(page, 'Prove it with reports')
    await page.waitForTimeout(2200)
    await caption(page, null)
    mark('visibility')
    await openHash(page, '#/reports?report=visibility')
    await expect(page.locator('#rv-opp-title')).toBeVisible()
    await settle(page)
    await page.waitForTimeout(1000)
    await glide(page, 560, 1200)
    await page.waitForTimeout(800)
    mark('drill')
    const figure = m.locator('.rv-panel').filter({ has: page.locator('#rv-opp-title') })
    await press(page, figure.locator('.rv-fig').first())
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await page.waitForTimeout(2800)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    // 6. End on the Reports home
    mark('home')
    await openHash(page, '#/reports')
    await settle(page)
    await page.waitForTimeout(2600)
    mark('end')
    await cdp.send('Page.stopScreencast')
    await Promise.all(writes)
    await writeFile(path.join(OUT, 'frames.json'), JSON.stringify(frames))
    await writeFile(path.join(OUT, 'marks.json'), JSON.stringify(marks))
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
