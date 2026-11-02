import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TEXTBOLT_TOPIC_ID } from '../../src/shared/fixtures/textbolt-topic'
import { settle } from './a11y-helpers'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash, shot } from './screens-app'

/**
 * No grid scrolls sideways on the main screens at 1134, 1321 and 1440 px wide:
 * every element inside #main that scrolls on x and holds a grid or table has
 * scrollWidth ≤ clientWidth + 1 once the layout settles (narrow grids drop
 * columns instead). The seed is the two-market TextBolt project plus the
 * TextBolt topic as stored checks; nothing here searches. Each overflow found
 * is listed in test-results/e2e/grid-fit-<width>.json with a screenshot.
 */
const WIDTHS = [
  { width: 1134, height: 770 },
  { width: 1321, height: 876 },
  { width: 1440, height: 900 }
] as const

const SCREENS: readonly { screen: string; hash: string }[] = [
  { screen: 'overview', hash: '#/overview' },
  { screen: 'questions', hash: '#/questions' },
  { screen: 'topics', hash: '#/topics' },
  { screen: 'topic', hash: `#/topics/${TEXTBOLT_TOPIC_ID}` },
  { screen: 'competitors', hash: '#/competitors' },
  { screen: 'citations', hash: '#/citations' },
  { screen: 'fixes', hash: '#/fixes' },
  { screen: 'all-pages', hash: '#/pages' },
  { screen: 'history', hash: '#/history' },
  { screen: 'reports', hash: '#/reports?tab=emails' },
  { screen: 'page-results', hash: '#/pages/page-1/results' }
]

interface Overflow {
  screen: string
  grid: string
  scrollWidth: number
  clientWidth: number
}

let app: ElectronApplication
let page: Page
let dir: string

test.beforeAll(async () => {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-grid-fit-'))
  await seedTwoMarketProject(dir)
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    seedTextboltTopic(db, {
      id: SEED.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    // Hold the queue so the seeded topic is not checked (offline) in the first due pass.
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const launched = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  app = launched.app
  page = launched.page
  await openAllPages(page)
})

test.afterAll(async () => {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

/** Every visible x-scroller in #main that holds a grid or table, with its widths. */
async function scrollers(): Promise<Omit<Overflow, 'screen'>[]> {
  return page.evaluate(() => {
    const main = document.querySelector('#main')
    if (!main) return []
    const out: { grid: string; scrollWidth: number; clientWidth: number }[] = []
    for (const element of main.querySelectorAll<HTMLElement>('*')) {
      const { overflowX } = getComputedStyle(element)
      if (overflowX !== 'auto' && overflowX !== 'scroll') continue
      if (element.clientWidth === 0 || element.clientHeight === 0) continue
      const grid = element.matches('[role="grid"], [role="table"], table')
        ? element
        : element.querySelector<HTMLElement>('[role="grid"], [role="table"], table')
      if (!grid) continue
      const named = grid.closest<HTMLElement>('[aria-label]')
      const label = named?.getAttribute('aria-label') ?? ''
      out.push({
        grid: `${label || grid.className || grid.tagName} (${element.className || element.tagName})`,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      })
    }
    return out
  })
}

/** The scrollers once two reads 250ms apart agree (fit hooks re-measure after a resize). */
async function settledScrollers(): Promise<Omit<Overflow, 'screen'>[]> {
  let last = JSON.stringify(await scrollers())
  for (let tries = 0; tries < 20; tries += 1) {
    await page.waitForTimeout(250)
    const next = JSON.stringify(await scrollers())
    if (next === last) break
    last = next
  }
  return JSON.parse(last) as Omit<Overflow, 'screen'>[]
}

for (const viewport of WIDTHS) {
  test(`no grid scrolls sideways at ${viewport.width}`, async () => {
    await page.setViewportSize(viewport)
    const overflows: Overflow[] = []
    const seen: Record<string, number> = {}
    for (const { screen, hash } of SCREENS) {
      await openHash(page, hash)
      await expect(page.locator('#main h1').first()).toBeVisible()
      await settle(page)
      const found = await settledScrollers()
      seen[screen] = found.length
      const wide = found.filter((item) => item.scrollWidth > item.clientWidth + 1)
      if (wide.length > 0) await shot(page, `grid-fit-${screen}-${viewport.width}`)
      overflows.push(...wide.map((item) => ({ screen, ...item })))
    }
    await writeFile(
      await e2eArtifact(`grid-fit-${viewport.width}.json`),
      JSON.stringify({ viewport, scrollers: seen, overflows }, null, 2)
    )
    expect(overflows).toEqual([])
  })
}
