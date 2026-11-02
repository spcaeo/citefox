import { expect, test, type ElectronApplication } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAdd } from './nav-helpers'

const JINA_FIXTURE = path.join(process.cwd(), 'src/main/pipeline/fixtures/textbolt-jina.json')
const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const PAGE_TITLE = 'How to Set Up Text Alerts for Business (2026) | TextBolt'

test('the read screen starts the read and shows the fixture result', async () => {
  test.setTimeout(120_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-read-start-'))
  const seeded = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: { TZ: 'America/Toronto' }
  })
  try {
    await expect(
      seeded.page.getByRole('heading', { level: 1, name: /See whether Google/ })
    ).toBeVisible()
  } finally {
    await seeded.app.close()
  }
  const db = new Database(path.join(dir, 'app.sqlite'))
  db.prepare('UPDATE app_state SET onboarding_finished = 1 WHERE id = 1').run()
  db.close()
  await writeFile(
    path.join(dir, 'settings.json'),
    `${JSON.stringify({ schemaVersion: 2, jinaMode: 'always' }, null, 2)}\n`,
    { mode: 0o600 }
  )

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: { TZ: 'America/Toronto' }
  })
  try {
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await page.getByRole('button', { name: /Switch project, No project/ }).click()
    await page
      .getByRole('group', { name: 'Projects' })
      .getByRole('link', { name: 'New project' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible()
    await page.getByLabel('Project name').fill('TextBolt')
    await page.getByLabel('Website domain').fill('textbolt.com')
    await page.getByLabel('Brand names').fill('TextBolt')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByText('TextBolt is ready.')).toBeVisible()
    // Create opens the new project's start screen (an empty project's landing comes back
    // here too), so go on to the Projects screen in the app.
    await expect(
      page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
    ).toBeVisible()
    await page.evaluate(() => {
      window.location.hash = '#/projects'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()

    await openAdd(page, 'Topic')
    await expect(
      page.getByRole('heading', { level: 1, name: 'What do you want to track?' })
    ).toBeVisible()
    await page.getByRole('radio', { name: /A page URL/ }).check()
    await page.getByRole('button', { name: 'Open Add a page' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Add a page to track' })).toBeVisible()
    await page.getByLabel('Page URL').fill(PAGE_URL)
    await installHeldJinaFixture(app, await readFile(JINA_FIXTURE, 'utf8'))
    await page.getByRole('button', { name: 'Add page' }).click()
    // The runner is off in this launch: open the read screen, which starts the read itself.
    await expect(page).toHaveURL(/\/prompts$/)
    await page.evaluate(() => {
      window.location.hash = window.location.hash.replace(/\/prompts$/, '/read')
    })

    await expect(
      page.getByRole('heading', { level: 1, name: 'Check what CiteFox read' })
    ).toBeVisible()
    await expect(page.getByText('Reading the page.')).toBeVisible()
    await expect(page.getByText('CiteFox has not read this page yet.')).toHaveCount(0)
    await expect.poll(() => readStartCount(app)).toBe(1)
    await page.evaluate(() => {
      document.querySelector('#main')?.scrollTo(0, 0)
    })
    await page.screenshot({ path: await e2eArtifact('page-read-in-progress.png') })

    await releaseHeldRead(app)
    await expect(page.getByText(PAGE_TITLE)).toBeVisible()
    const statusLine = page.getByRole('region', { name: 'Read status' })
    await expect(statusLine).toContainText('backup reader')
    await expect(statusLine).toContainText('200 OK')
    await expect(page.getByText('CiteFox has not read this page yet.')).toHaveCount(0)
    expect(await readStartCount(app)).toBe(1)
    const status = plain(await statusLine.innerText())
    const now = Date.now()
    expect(nearbyStamps('America/Toronto', now).some((stamp) => status.includes(stamp))).toBe(true)
    const utcAlsoToronto = nearbyStamps('UTC', now).some((stamp) =>
      nearbyStamps('America/Toronto', now).includes(stamp)
    )
    if (!utcAlsoToronto) {
      expect(nearbyStamps('UTC', now).some((stamp) => status.includes(stamp))).toBe(false)
    }
    await page.evaluate(() => {
      document.querySelector('#main')?.scrollTo(0, 0)
    })
    await page.screenshot({ path: await e2eArtifact('page-read-done.png') })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

async function installHeldJinaFixture(app: ElectronApplication, body: string): Promise<void> {
  await app.evaluate((_electron, fixtureBody: string) => {
    const original = globalThis.fetch.bind(globalThis)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reads = 0
    const bridge = globalThis as typeof globalThis & {
      __citefoxReleaseRead?: () => void
      __citefoxReadStarts?: () => number
    }
    bridge.__citefoxReleaseRead = () => release()
    bridge.__citefoxReadStarts = () => reads
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('https://r.jina.ai/')) {
        reads += 1
        await gate
        return new Response(fixtureBody, {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return original(input, init)
    }
  }, body)
}

async function releaseHeldRead(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const bridge = globalThis as typeof globalThis & { __citefoxReleaseRead?: () => void }
    bridge.__citefoxReleaseRead?.()
  })
}

async function readStartCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => {
    const bridge = globalThis as typeof globalThis & { __citefoxReadStarts?: () => number }
    return bridge.__citefoxReadStarts?.() ?? 0
  })
}

function nearbyStamps(timeZone: string, now: number): string[] {
  const stamps: string[] = []
  for (let delta = -2; delta <= 2; delta += 1) {
    stamps.push(stampIn(new Date(now + delta * 60_000).toISOString(), timeZone))
  }
  return stamps
}

function stampIn(iso: string, timeZone: string): string {
  // The read stamp is formatMoment's: "Oct 29, 3:12 PM" on the computer's clock.
  return plain(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(iso))
  )
}

/** ICU puts a narrow no-break space before AM/PM; compare with plain spaces. */
function plain(text: string): string {
  return text.replace(/\s/g, ' ')
}
