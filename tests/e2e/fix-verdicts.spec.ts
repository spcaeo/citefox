import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { settle } from './a11y-helpers'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * Did my fix work? (phase 2a), on two seeds:
 * - the TextBolt topic: a page fix's "I published this" logs it live today in one
 *   click, Undo takes it back, the drawer says "Live since … · measuring, 14 days
 *   left" in Fixes and over another screen, and "Pick another date" opens Log a fix
 *   with the topic questions ticked;
 * - the Progress seed (Fix 1 live Oct 8, checks Oct 5 and Oct 19): the Changes grid's
 *   verdict and before → now, the change drawer's "Did it work?", and a count that
 *   opens its searches in a drawer over the screen.
 * CiteFox AI is the claude shim; nothing spends a search.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const HIDE =
  '.gd-float,.gd-pop,.gd-coach,.gd-dim,.gd-mask,.gd-hint-layer,.gd-callout,[aria-label="CiteFox work console"],[data-testid="guide-explainer"]{display:none!important}'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`verdicts/${name}.png`) })
}

async function openTopicSeed(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-verdicts-'))
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
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log'),
      CITEFOX_TEMPLATE_FIXTURE_DIRS: [
        'src/main/topics/fixtures',
        'src/main/pipeline/fixtures',
        'tests/e2e/fixtures'
      ]
        .map((folder) => path.join(ROOT, folder))
        .join(path.delimiter)
    }
  })
  return { app, page, dir }
}

function hashParam(page: Page, name: string): Promise<string | null> {
  return page.evaluate((key) => {
    const hash = location.hash
    const at = hash.indexOf('?')
    return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1)).get(key)
  }, name)
}

test('I published this: one click, Undo, Live since, here and over another screen', async () => {
  test.setTimeout(180_000)
  const { app, page, dir } = await openTopicSeed()
  try {
    await openHash(page, '#/fixes')
    await settle(page)
    await page.addStyleTag({ content: HIDE })
    const main = page.locator('#main')
    await main.getByRole('button', { name: 'Expand all' }).click()
    // Open the first improve fix's drawer from its row (no brief is written).
    await main.getByRole('button', { name: 'Get fix brief' }).first().click()
    const drawer = page.getByRole('dialog', { name: /Improve a page/ })
    await expect(drawer).toBeVisible()
    const pageFixId = await hashParam(page, 'pf')
    expect(pageFixId).toBeTruthy()
    const publish = drawer.getByRole('button', { name: 'I published this' })
    await expect(publish).toBeEnabled({ timeout: 30_000 })
    await expect(drawer.getByRole('button', { name: 'Pick another date' })).toBeVisible()
    await shot(page, '1-page-fix-buttons')

    // Pick another date opens Log a fix with the page and its topic questions ticked.
    await drawer.getByRole('button', { name: 'Pick another date' }).click()
    const form = page.getByRole('dialog', { name: 'Log a fix' })
    await expect(form).toBeVisible()
    await expect(form.getByText(/^From the topic /).first()).toBeVisible({ timeout: 30_000 })
    expect(await form.locator('.fxd-also input[type="checkbox"]:checked').count()).toBeGreaterThan(
      0
    )
    await shot(page, '4-log-a-fix-topic-questions')
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await openHash(page, `#/fixes?pf=${pageFixId}`)
    await expect(publish).toBeEnabled({ timeout: 30_000 })

    await publish.click()
    const live = drawer.getByTestId('fxt-published')
    await expect(
      live.getByRole('heading', { name: /^Live since .* · measuring, 14 days left$/ })
    ).toBeVisible()
    await expect(page.getByText('Logged Fix 1 as live today.')).toBeVisible()
    await expect(publish).toHaveCount(0)
    await shot(page, '2-live-since-undo')

    // Undo takes it back.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(drawer.getByRole('button', { name: 'I published this' })).toBeVisible()
    await expect(live).toHaveCount(0)

    // Publish again, then open the same fix over another screen: it says Live since there too.
    await drawer.getByRole('button', { name: 'I published this' }).click()
    await expect(live).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await openHash(page, `#/pages?drawer=page-fix&pfx.id=${pageFixId}`)
    const over = page.getByRole('dialog', { name: /Improve a page/ })
    await expect(over.getByTestId('fxt-published')).toBeVisible({ timeout: 30_000 })
    await shot(page, '3-live-since-over-pages')
    await page.keyboard.press('Escape')

    // What to fix reads Logged for it.
    await openHash(page, '#/fixes')
    await settle(page)
    await expect(main.getByRole('button', { name: /^Logged \d+$/ })).toBeVisible()
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Did it work? on Changes: the verdict, before → now, and drills over the screen', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-verdicts-changes-'))
  await seedProgressProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  try {
    await openAllPages(page)
    await openHash(page, '#/fixes?view=changes')
    await settle(page)
    await page.addStyleTag({ content: HIDE })
    const main = page.locator('#main')
    const ledger = main.getByRole('grid', { name: 'Changes you made' })
    await expect(ledger.getByRole('row')).toHaveCount(2)
    const verdict = ledger.locator('[data-verdict]').first()
    await expect(verdict).toBeVisible()
    await shot(page, '5-changes-verdict')

    // A before → now count opens its searches in a drawer over the grid.
    const now = ledger.getByRole('button', { name: /: Cited now · / }).first()
    await now.click()
    const drill = page.getByRole('dialog', { name: /Cited now · / })
    await expect(drill).toBeVisible()
    await expect(page).toHaveURL(/#\/fixes\?view=changes.*drawer=drill/)
    await shot(page, '6-cited-now-drill')
    // Every column of the drawer's list shows its whole header (nothing is covered).
    const heads = await drill.getByRole('columnheader').evaluateAll((cells) =>
      cells.map((cell) => {
        const box = cell.getBoundingClientRect()
        const text = cell.textContent ?? ''
        const top = document.elementFromPoint(box.left + 3, box.top + box.height / 2)
        const style = getComputedStyle(cell)
        return {
          covered: top === cell || cell.contains(top) ? null : (top?.className ?? null),
          padding: style.paddingLeft,
          gap: getComputedStyle(cell.parentElement!).columnGap,
          template: getComputedStyle(cell.parentElement!).gridTemplateColumns,
          text,
          left: box.left,
          right: box.right,
          scroll: cell.scrollWidth,
          width: cell.clientWidth
        }
      })
    )
    await writeFile(
      await e2eArtifact('verdicts/drill-columns.json'),
      JSON.stringify(heads, null, 2)
    )
    expect(heads.filter((head) => head.covered !== null)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(drill).toHaveCount(0)

    // The change drawer leads with Did it work?.
    await ledger.getByRole('row').nth(1).getByRole('gridcell').first().click()
    const work = page.getByTestId('did-it-work')
    await expect(work).toBeVisible()
    await shot(page, '7-did-it-work')
    const won = work.getByRole('button', { name: /^Open the \d+ won search/ })
    if ((await won.count()) > 0) {
      await won.click()
      await expect(page.getByRole('dialog', { name: /Searches won · / })).toBeVisible()
      await expect(page).toHaveURL(/view=changes&row=.*drawer=drill/)
      await shot(page, '8-won-searches')
    }
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
