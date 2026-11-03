import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TEXTBOLT_TOPIC_NAME } from '../../src/shared/fixtures/textbolt-topic'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages, sidebar } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * Topics and clusters (Docs/TOPICS-SPEC.md §8) on the real handlers and sqlite: the
 * two-market TextBolt project plus the TextBolt topic (28 questions, two stored
 * checks). The `claude` stand-in answers the cluster templates from
 * src/main/topics/fixtures, and the queue is paused, so nothing is searched.
 * Screenshots at 1440 × 900 and 1134 × 770 go to test-results/e2e/clusters-*.png.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }
const Q1 = /Select Our alarm system only emails when the freezer/
const Q2 = /Select I manage 40 field techs/
const PAGE_Q = /Select Which plan covers scheduled texts\?/

async function launch(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-clusters-'))
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
    // Hold the queue: no due pass may search while the screens are driven.
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
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: WIDE,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log'),
      CITEFOX_E2E_TOPICS: '1'
    }
  })
  await openAllPages(page)
  return { app, page, dir }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300)
  await page.screenshot({ path: await e2eArtifact(`${name}.png`) })
}

/**
 * The same screen at both review sizes, with `focus` (when given) scrolled into view at
 * each; the window goes back to wide after.
 */
async function shots(page: Page, name: string, focus?: Locator): Promise<void> {
  await focus?.scrollIntoViewIfNeeded()
  await shot(page, `${name}-1440`)
  await page.setViewportSize(NARROW)
  await focus?.scrollIntoViewIfNeeded()
  await shot(page, `${name}-1134`)
  await page.setViewportSize(WIDE)
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('#main')
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(
    results.violations.map(
      (item) => `${item.id}: ${item.nodes.map((node) => node.target.join(' ')).join(', ')}`
    )
  ).toEqual([])
}

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

async function go(page: Page, to: string): Promise<void> {
  await page.evaluate((value) => {
    window.location.hash = value
  }, to)
}

function bulk(page: Page): Locator {
  return page.getByRole('region', { name: 'Bulk actions' })
}

/**
 * Opens the drill behind `button` and checks the drawer counts what the button showed,
 * in the drill's own noun (questions, or searches for the KPI strip).
 */
async function expectDrillMatches(
  page: Page,
  button: Locator,
  title: string | RegExp = /questions?$/,
  noun: readonly [string, string] = ['question', 'questions']
): Promise<void> {
  const shown = Number((await button.innerText()).replace(/[^\d]/g, ''))
  await button.click()
  const drawer = page.getByRole('dialog', { name: title })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('heading', { level: 2 })).toContainText(
    `· ${shown} ${shown === 1 ? noun[0] : noun[1]}`
  )
  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await expect(drawer).toHaveCount(0)
}

test('Topics: open from the sidebar, Tree first, drill a number, suggest topics, the Grid', async () => {
  test.setTimeout(300_000)
  const { app, page, dir } = await launch()
  try {
    await sidebar(page)
      .getByRole('link', { name: /^Topics \d/ })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'Topics' })).toBeVisible()
    expect(await hash(page)).toBe('#/topics')
    // The dashboard opens on the List.
    const views = page.getByRole('tablist', { name: 'Topics views' })
    await expect(views.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('grid', { name: 'Topics' }).getByText(TEXTBOLT_TOPIC_NAME)
    ).toBeVisible()
    // The Tree: with no folder made it is a flat list of the topics (no repeated
    // folder and All rows), each count opening its topic.
    await views.getByRole('tab', { name: 'Tree' }).click()
    await expect.poll(() => hash(page)).toContain('view=tree')
    const tree = page.getByRole('grid', { name: 'All topics' })
    await expect(
      tree.getByRole('link', {
        name: new RegExp(`^${TEXTBOLT_TOPIC_NAME}: open its \\d+ searches$`)
      })
    ).toBeVisible()
    // No "How it fits" explainer: the screen reads by itself.
    await expect(page.getByRole('region', { name: 'How it fits' })).toHaveCount(0)
    await shots(page, 'clusters-topics')
    await expectAccessible(page)

    // Every count opens exactly what it counts: the KPI strip (in searches)…
    await expectDrillMatches(
      page,
      page
        .getByRole('region', { name: 'Right page cited', exact: true })
        .getByRole('button', { name: /^\d+ searches?: Right page cited$/ }),
      'Right page cited',
      ['search', 'searches']
    )
    // …and the List view's per-topic counts. The view is kept in the URL.
    await page
      .getByRole('tablist', { name: 'Topics views' })
      .getByRole('tab', { name: 'List' })
      .click()
    await expect.poll(() => hash(page)).toContain('view=list')
    const grid = page.getByRole('grid', { name: 'Topics' })
    await expect(grid.getByText(TEXTBOLT_TOPIC_NAME)).toBeVisible()
    await expectDrillMatches(
      page,
      grid.getByRole('button', { name: `Show the 28 questions in ${TEXTBOLT_TOPIC_NAME}` })
    )

    // Suggest topics: Claude's ideas, two ticked, created with draft questions.
    // It sits under the header's ⋯.
    await page.locator('.screen-header').getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Suggest topics' }).click()
    const section = page.getByRole('region', { name: 'Suggested topics for textbolt.com' })
    await expect(section.getByText('Text alerts from monitoring tools')).toBeVisible({
      timeout: 60_000
    })
    await expect.poll(() => hash(page)).toContain('suggest=1')
    await shots(page, 'clusters-suggest', section)
    // The work console covers the section's foot while it runs; minimise it, as a person would.
    const workConsole = page.getByRole('dialog', { name: 'CiteFox work console' })
    if (await workConsole.isVisible()) {
      await workConsole.getByRole('button', { name: 'Minimise the console' }).click()
    }
    // The page's "What is Topics?" card (hidden while the console was open) sits over the
    // section's foot; close it, as a person would.
    const explainer = page.getByTestId('guide-explainer')
    await explainer.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined)
    if (await explainer.isVisible()) {
      await explainer.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(explainer).toBeHidden()
    }
    await section.getByRole('button', { name: 'Create 2 topics' }).click()
    await expect(section.getByText(/Nothing is checked until you press Check now/)).toBeVisible()
    await expect(grid.getByText('10DLC registration for small senders')).toBeVisible()
    await expect(grid.getByRole('row')).toHaveCount(4)

    // The Grid (folder × result, it replaced Results by) is kept in the URL; a count
    // opens Questions with its searches in a drawer, a list as long as the number.
    await page
      .getByRole('tablist', { name: 'Topics views' })
      .getByRole('tab', { name: 'Grid' })
      .click()
    await expect.poll(() => hash(page)).toContain('view=grid')
    const byResult = page.getByRole('region', { name: 'Folders by result' })
    const notCited = byResult.getByRole('link', {
      name: /^All topics · Not cited: open these \d+ searches$/
    })
    await expect(notCited).toBeVisible()
    await shots(page, 'clusters-results', byResult)
    const count = Number(
      /(\d+) searches/.exec((await notCited.getAttribute('aria-label')) ?? '')?.[1]
    )
    expect(count).toBeGreaterThan(0)
    await notCited.click()
    await expect
      .poll(() => hash(page))
      .toMatch(/^#\/questions\?.*drawer=search-drill.*d\.result=not_cited/)
    await expect(page.getByRole('dialog').getByText(`Showing all ${count}`)).toBeVisible()
    await page.goBack()
    await expect.poll(() => hash(page)).toContain('view=grid')
    await expect(byResult).toBeVisible()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Questions: a topic from selected questions, then a question moved into it', async () => {
  test.setTimeout(300_000)
  const { app, page, dir } = await launch()
  try {
    await go(page, '#/questions')
    await expect(page.getByRole('heading', { level: 1, name: 'Questions' })).toBeVisible()
    await expect(page.getByRole('grid', { name: 'Questions' })).toBeVisible()
    await shots(page, 'clusters-questions')

    // Tick two topic questions and make a new topic from them.
    await page.getByRole('checkbox', { name: Q1 }).check()
    await page.getByRole('checkbox', { name: Q2 }).check()
    await bulk(page).getByRole('button', { name: 'Move to topic' }).click()
    await page.getByRole('menuitem', { name: 'New topic from these 2…' }).click()
    const dialog = page.getByRole('dialog', { name: 'New topic' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Topic name')).toHaveValue('Text alerts from monitoring tools', {
      timeout: 60_000
    })
    await shots(page, 'clusters-new-topic')
    await dialog.getByRole('button', { name: 'Create topic' }).click()
    await expect(dialog.getByText(/^Topic created\./)).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Topics' })).toBeVisible()
    // The new topic shows on the Tree, in "No folder"…
    await go(page, '#/topics?view=tree')
    await expect(
      page
        .getByRole('grid', { name: 'All topics' })
        .getByRole('link', { name: /^Text alerts from monitoring tools: open its \d+ searches?$/ })
    ).toBeVisible()
    // …and the List counts its questions, each count opening exactly those.
    await go(page, '#/topics?view=list')
    const grid = page.getByRole('grid', { name: 'Topics' })
    const made = grid.getByRole('button', {
      name: 'Show the 2 questions in Text alerts from monitoring tools'
    })
    await expect(made).toBeVisible()
    await expectDrillMatches(page, made)
    await expect(
      grid.getByRole('button', { name: `Show the 26 questions in ${TEXTBOLT_TOPIC_NAME}` })
    ).toBeVisible()

    // Move the page's question into the new topic; it keeps its history.
    await go(page, '#/questions')
    await expect(page.getByRole('heading', { level: 1, name: 'Questions' })).toBeVisible()
    // The topic's 146 rows come first; find the page's question by its words.
    await page
      .getByRole('searchbox', { name: /^Search \d+ questions( and keywords)?$/ })
      .fill('scheduled texts')
    await page.getByRole('checkbox', { name: PAGE_Q }).check()
    await bulk(page).getByRole('button', { name: 'Move to topic' }).click()
    await page.getByRole('menuitem', { name: /^Text alerts from monitoring tools/ }).click()
    await expect(
      page.getByText(/Moved 1 question to Text alerts from monitoring tools/)
    ).toBeVisible()
    const group = page.getByRole('button', {
      name: 'Text alerts from monitoring tools',
      exact: true
    })
    await expect(group).toBeVisible()
    await expect(page.getByRole('checkbox', { name: PAGE_Q })).toBeVisible()
    await shots(page, 'clusters-moved')

    await go(page, '#/topics?view=list')
    await expect(
      page
        .getByRole('grid', { name: 'Topics' })
        .getByRole('button', { name: 'Show the 3 questions in Text alerts from monitoring tools' })
    ).toBeVisible()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
