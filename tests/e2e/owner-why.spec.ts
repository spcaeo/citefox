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
 * What to fix › Pick which page owns it › Why Google picks, on the seeded TextBolt
 * topic: CiteFox AI (its fixture reply) compares the target with the page Google
 * cites, the verdict leads with the recommended option, and Page edits opens on
 * that page. Saved, so reopening shows it again. CiteFox AI is the claude shim with
 * its fixtures; no search and no paid call.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
// The pages read here have only their title, so every section is "Opening" or a new one.
const OWNER_WHY = {
  verdict: 'target',
  reason:
    'Google quotes the other page because it answers the comparison in its first lines. The target page fits these buyers better, so strengthen it.',
  answerNeeds: [
    'Name the ways to send texts from email now',
    'Compare them on set-up and cost',
    'Say which suits a team that sends alerts'
  ],
  citedHas: [{ section: 'Opening', point: 'A first paragraph that compares the options.' }],
  toChange: [
    {
      section: 'Opening',
      change:
        'Open with two sentences that name the best option for alert emails and who it suits.',
      why: 'Answers the best search before the buyer scrolls.'
    },
    {
      section: 'New section after the opening',
      change: 'Add a short comparison of the three ways to text from email.',
      why: 'Gives the answer the side-by-side view it quotes now.'
    }
  ],
  risk: 'Both pages answer the same searches; link the other page to this one.'
}
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
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-owner-why-'))
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
  const fixtures = path.join(dir, 'fixtures')
  await mkdir(fixtures, { recursive: true })
  await writeFile(path.join(fixtures, 'topic_page_edit.json'), JSON.stringify(PAGE_EDIT))
  await writeFile(path.join(fixtures, 'topic_owner_why.json'), JSON.stringify(OWNER_WHY))
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

test('Why Google picks: compare, lead with the verdict, then edit the owner page', async () => {
  await openHash(page, '#/fixes')
  await settle(page)
  await page.addStyleTag({ content: HIDE })
  const main = page.locator('#main')
  await main.getByRole('button', { name: 'Expand all' }).click()
  await main.getByRole('button', { name: 'Choose owner' }).first().click()
  const drawer = page.getByRole('dialog', { name: /Pick which page owns it/ })
  await expect(drawer).toBeVisible()
  const why = drawer.getByTestId('owner-why')
  await expect(why).toBeVisible()
  await expect(drawer.getByRole('tab', { name: 'Page edits' })).toHaveCount(0)
  await page.screenshot({ path: await e2eArtifact('owner-why/1-before.png') })

  await why.getByRole('button', { name: 'Compare the pages' }).click()
  const result = why.getByTestId('owner-why-result')
  await expect(result).toBeVisible({ timeout: 30_000 })
  await expect(result.getByRole('status')).toContainText('Keep the target and strengthen it')
  await expect(result.getByText('What the answer needs')).toBeVisible()
  await expect(result.getByText(/has that the target lacks$/)).toBeVisible()
  await expect(result.getByText(/^What to change on/)).toBeVisible()
  await expect(why.getByRole('button', { name: 'Compare again' })).toBeVisible()
  const keep = drawer.getByRole('button', { name: /^Keep .*, get its fix brief/ })
  await expect(keep).toHaveClass(/primary/)
  await page.screenshot({ path: await e2eArtifact('owner-why/2-verdict.png'), fullPage: true })
  await result.screenshot({ path: await e2eArtifact('owner-why/3-result.png') })

  // The next step: Page edits on the recommended page, with the comparison as advice.
  await result.getByRole('button', { name: 'Show page edits' }).click()
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('pft=edits')
  await drawer.getByRole('button', { name: 'Show page edits' }).click()
  await expect(drawer.getByTestId('page-editor')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: await e2eArtifact('owner-why/4-page-edits.png') })

  // Saved: closing and reopening shows the comparison again.
  await drawer.getByRole('tab', { name: 'Brief' }).click()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await main.getByRole('button', { name: 'Choose owner' }).first().click()
  await expect(drawer.getByTestId('owner-why-result')).toBeVisible()
  await expect(drawer.getByRole('tab', { name: 'Page edits' })).toBeVisible()
})
