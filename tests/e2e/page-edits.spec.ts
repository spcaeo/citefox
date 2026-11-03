import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { settle } from './a11y-helpers'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * What to fix › a page fix › Page edits, on the seeded TextBolt topic: the tab is
 * on the URL, CiteFox AI (its fixture reply) marks the page, the page fills the
 * main column, and the Review card in the rail counts the changes, keeps them
 * all and offers Download as HTML or Markdown, and the footer's Pick another date opens the
 * fix drawer with what changed. CiteFox AI is the claude shim with its fixtures.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const PAGE_EDIT = {
  summary: 'Answers the main search under the title, then gives the set-up steps.',
  changes: [
    {
      op: 'insert',
      block: 'b1',
      kind: 'p',
      text: 'Forward the alert emails your tools already send, and each one arrives as a text.',
      why: 'Answers the best search in the first sentence under the title.'
    },
    {
      op: 'insert',
      block: 'b1',
      kind: 'h2',
      text: 'Set it up in three steps',
      why: 'Gives the buyer the steps under a heading that matches what they ask.'
    }
  ]
}

const HIDE =
  '.gd-float,.gd-pop,.gd-coach,.gd-dim,.gd-mask,.gd-hint-layer,.gd-callout,[aria-label="CiteFox work console"]{display:none!important}'

let app: ElectronApplication | undefined
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
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-page-edits-'))
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
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeClaudeStandIn(path.join(bin, 'claude'), SHIM)
  // The page read here has only its title, so the reply adds under it (b1) and names no other block.
  const fixtures = path.join(dir, 'fixtures')
  await mkdir(fixtures, { recursive: true })
  await writeFile(path.join(fixtures, 'topic_page_edit.json'), JSON.stringify(PAGE_EDIT))
  const launched = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log'),
      CITEFOX_TEMPLATE_FIXTURE_DIRS: [
        fixtures,
        ...['src/main/topics/fixtures', 'src/main/pipeline/fixtures', 'tests/e2e/fixtures'].map(
          (folder) => path.join(ROOT, folder)
        )
      ].join(path.delimiter)
    }
  })
  app = launched.app
  page = launched.page
})

test.afterAll(async () => {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

test('Page edits: the page in the middle, the Review card on the right', async () => {
  await openHash(page, '#/fixes')
  await settle(page)
  await page.addStyleTag({ content: HIDE })
  const main = page.locator('#main')
  await main.getByRole('button', { name: 'Expand all' }).click()
  await main.getByRole('button', { name: 'Get fix brief' }).first().click()
  const drawer = page.getByRole('dialog', { name: /Improve a page/ })
  await expect(drawer).toBeVisible()
  // The promo card sits in the rail.
  await expect(drawer.getByRole('complementary', { name: /1000AIOverviews/ })).toBeVisible()

  await drawer.getByRole('tab', { name: 'Page edits' }).click()
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('pft=edits')
  await drawer.getByRole('button', { name: 'Show page edits' }).click()
  const doc = drawer.getByTestId('page-editor')
  await expect(doc).toBeVisible({ timeout: 30_000 })
  const review = drawer.getByTestId('page-edit-review')
  await expect(review.getByRole('status')).toContainText(/\d+ changes? to review/)
  expect(await doc.locator('.pe-add, .pe-cut').count()).toBeGreaterThan(0)
  await page.screenshot({ path: await e2eArtifact('page-edits/1-review.png') })

  await review.getByRole('button', { name: /^Download/ }).click()
  await expect(page.getByRole('menuitem', { name: 'HTML page' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Markdown (.md)' })).toBeVisible()
  await page.keyboard.press('Escape')

  await review.getByRole('button', { name: /Keep all/ }).click()
  await expect(review.getByRole('status')).toHaveText('All changes reviewed')
  await expect(doc.locator('.pe-add, .pe-cut')).toHaveCount(0)
  await page.screenshot({ path: await e2eArtifact('page-edits/2-kept.png') })

  // The footer's Pick another date opens Log a fix with the kept page edits as its words.
  await drawer.getByRole('button', { name: 'Pick another date' }).click()
  const log = page.getByRole('dialog', { name: /Log a fix/ })
  await expect(log).toBeVisible()
  await expect(log.getByLabel('What changed')).toHaveValue(/Page edits on /)
  await page.screenshot({ path: await e2eArtifact('page-edits/3-log.png') })
})
