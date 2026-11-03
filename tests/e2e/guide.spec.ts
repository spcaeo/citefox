import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
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
 * The guide, every screen's lesson end to end on the seeded TextBolt project, and
 * Ctrl+K "find anything". Each coachmark is screenshotted to
 * test-results/e2e/guide/NN-<step>.png, with the drawer, menu or results a step
 * opens. The guide is driven the way a person would: Start, Got it, the "do it for
 * me" buttons, and the real controls. CiteFox AI is the claude shim with its
 * fixtures; nothing spends a search.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
// The pages read here have only their title, so edits add under it (b1).
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
const HIDE = '[aria-label="CiteFox work console"]{display:none!important}'

let app: ElectronApplication | undefined
let page: Page
let dir: string
let shots = 0

test.beforeAll(async () => {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-guide-'))
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

/** `guide/NN-<name>.png`, numbered in the order taken. */
async function shot(name: string): Promise<void> {
  shots += 1
  await page.screenshot({
    path: await e2eArtifact(`guide/${String(shots).padStart(2, '0')}-${name}.png`)
  })
}

function popover(): Locator {
  return page.locator('.gd-pop')
}

/** The coachmark's step id, once it shows on a real element (its spotlight ring is drawn). */
async function currentStep(): Promise<string> {
  const coach = page.locator('.gd-coach')
  await expect(coach).toBeVisible({ timeout: 30_000 })
  await expect(coach.locator('.gd-ring').first()).toBeVisible({ timeout: 15_000 })
  // Let the popover finish moving beside its element.
  await page.waitForTimeout(450)
  // Nothing is open over the screen, so the rest of it is dimmed.
  await expect(coach).not.toHaveAttribute('data-popup', '')
  return (await coach.getAttribute('data-step')) ?? ''
}

/** The popover is beside its element: it does not cover the spotlight. */
async function expectClear(): Promise<void> {
  const boxes = await page.evaluate(() => {
    const ring = document.querySelector('.gd-coach .gd-ring')?.getBoundingClientRect()
    const pop = document.querySelector('.gd-pop')?.getBoundingClientRect()
    return ring && pop
      ? {
          ring: [ring.left, ring.top, ring.right, ring.bottom],
          pop: [pop.left, pop.top, pop.right, pop.bottom]
        }
      : null
  })
  expect(boxes).not.toBeNull()
  if (!boxes) return
  const [rl, rt, rr, rb] = boxes.ring as [number, number, number, number]
  const [pl, pt, pr, pb] = boxes.pop as [number, number, number, number]
  const overlapW = Math.max(0, Math.min(rr, pr) - Math.max(rl, pl))
  const overlapH = Math.max(0, Math.min(rb, pb) - Math.max(rt, pt))
  const ringArea = Math.max(1, (rr - rl) * (rb - rt))
  // A tall element (a whole list or the sidebar) may hold the popover inside its edge.
  expect(overlapW * overlapH, 'the popover covers its element').toBeLessThan(ringArea * 0.5)
}

async function gotIt(): Promise<void> {
  await popover().getByRole('button', { name: 'Got it' }).click()
}

async function press(): Promise<void> {
  await popover().getByTestId('guide-press').click()
}

async function closeLessonEnd(lesson: string, then: 'close' | 'next' = 'close'): Promise<void> {
  const card = page.getByTestId('guide-lesson-done')
  await expect(card).toBeVisible({ timeout: 30_000 })
  // Over a drawer it stays clear of the drawer's footer buttons.
  const clash = await page.evaluate(() => {
    const card = document
      .querySelector('[data-testid="guide-lesson-done"]')
      ?.getBoundingClientRect()
    const foot = document.querySelector('.ui-drawer-foot')?.getBoundingClientRect()
    return card && foot ? card.bottom > foot.top && card.right > foot.left : false
  })
  expect(clash, 'Lesson done covers the drawer footer').toBe(false)
  await page.waitForTimeout(400)
  await shot(`lesson-done-${lesson.toLowerCase().replace(/\W+/gu, '-')}`)
  if (then === 'next') {
    await card.getByRole('button', { name: 'Next lesson' }).click()
    return
  }
  await card.getByRole('button', { name: /^(Later|Done)$/u }).click()
}

/**
 * Opens the guide drawer and starts a lesson: this screen's lesson by its Start
 * button, any other one from All lessons (it goes to that lesson's screen).
 */
async function startLesson(title: string): Promise<void> {
  // A lesson can end on an open drawer, which covers the top bar: close it first, as a
  // person would, so the Guide button is reachable.
  for (let tries = 0; tries < 3 && (await page.locator('[data-drawer]').count()) > 0; tries += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  await page.getByTestId('guide-pill').click()
  const list = page.getByTestId('guide-checklist')
  await expect(list).toBeVisible()
  const here = list.getByTestId('guide-here')
  if (await here.getByRole('heading', { name: title, exact: true }).isVisible()) {
    await here.getByRole('button', { name: /^(Start lesson|Continue)$/u }).click()
    return
  }
  const all = list.getByRole('button', { name: 'All lessons' })
  if (await all.isVisible()) await all.click()
  await list.getByRole('button', { name: `Open lesson: ${title}`, exact: true }).click()
}

/** Walks the running lesson: each step screenshotted, then done the way a person would. */
async function walk(
  lesson: string,
  act: Record<string, () => Promise<void>>,
  then: 'close' | 'next' = 'close'
): Promise<string[]> {
  const seen: string[] = []
  for (let guard = 0; guard < 20; guard += 1) {
    const ended = await page.getByTestId('guide-lesson-done').isVisible()
    if (ended) break
    const id = await currentStep()
    if (seen.includes(id)) throw new Error(`${lesson}: ${id} showed twice`)
    seen.push(id)
    await expectClear()
    await expect(popover().getByText('This isn’t on the screen right now')).toHaveCount(0)
    await shot(id)
    await (act[id] ?? gotIt)()
    // Wait for this step to go before reading the next one.
    await expect(page.locator(`.gd-coach[data-step="${id}"]`)).toHaveCount(0, { timeout: 30_000 })
    await page
      .locator('.gd-coach, [data-testid="guide-lesson-done"]')
      .first()
      .waitFor({ timeout: 30_000 })
  }
  await closeLessonEnd(lesson, then)
  return seen
}

test('the guide: every lesson, every step on its real element', async () => {
  test.setTimeout(900_000)
  await openHash(page, '#/overview')
  await settle(page)
  await page.addStyleTag({ content: HIDE })

  // The kick-off card after the first results starts this screen's lesson: the Summary.
  const kickoff = page.getByRole('region', { name: 'Your first results are in' })
  await expect(kickoff).toBeVisible({ timeout: 30_000 })
  await shot('kickoff')
  await kickoff.getByRole('button', { name: 'Start the guide' }).click()

  const summary = await walk('Your Summary', {
    'find-anything': async () => {
      const box = page.getByRole('combobox', { name: /^Find anything/u })
      await page.keyboard.press('Control+k')
      await expect(box).toBeFocused()
      await expect(page.getByTestId('search-tips')).toBeVisible()
      await shot('find-anything-tip')
      await box.fill('dark mode')
      await expect(page.getByRole('option', { name: /Switch theme to Dark/u })).toBeVisible()
      await shot('find-anything-dark-mode')
      await page.keyboard.press('Escape')
      await gotIt()
    }
  })
  expect(summary).toEqual(['summary', 'summary-edit', 'sidebar', 'find-anything'])
  // The top bar counts this screen's lesson, not every step.
  await expect(page.getByTestId('guide-pill')).toHaveText('4/4')

  await startLesson('A topic page')
  const topic = await walk('A topic page', {
    'set-target-page': async () => {
      await press()
      await expect(page.locator('.gd-hint').first()).toBeVisible({ timeout: 15_000 })
      await shot('set-target-page-drawer-hint')
      await page.keyboard.press('Escape')
      await currentStep()
      await popover().getByRole('button', { name: 'Skip' }).click()
    },
    'check-now': async () => {
      // Checking spends credits: look, then skip.
      await popover().getByRole('button', { name: 'Skip' }).click()
    },
    'open-question': press
  })
  expect(topic.at(-1)).toBe('open-question')

  await startLesson('A question page')
  await walk('A question page', {
    'sources-tab': press,
    'mark-competitor': async () => {
      await popover().getByRole('button', { name: 'Skip' }).click()
    }
  })

  await startLesson('What to fix')
  // The lesson ends on the open fix, whose drawer covers the top bar: "Next lesson" on the
  // Lesson done card goes on to Fix a page right there.
  const todo = await walk(
    'What to fix',
    {
      'fix-open': async () => {
        // A closed group opens first, then the fix's Get fix brief.
        for (let tries = 0; tries < 3; tries += 1) {
          if ((await page.evaluate(() => location.hash)).includes('pf=')) break
          await press()
          await page.waitForTimeout(500)
        }
        await expect.poll(() => page.evaluate(() => location.hash)).toContain('pf=')
      }
    },
    'next'
  )
  expect(todo).toEqual(['fixes-tabs', 'fix-list', 'fix-kinds', 'fix-open'])

  const fix = await walk('Fix a page', {
    'fix-read-brief': async () => {
      await expect(page.locator('[data-guide="pagefix-copy"]')).toBeEnabled({ timeout: 60_000 })
      await shot('fix-read-brief-written')
      await gotIt()
    },
    'fix-send-brief': async () => {
      await expect(page.locator('[data-guide="pagefix-copy"]')).toBeEnabled({ timeout: 60_000 })
      await press()
    },
    'fix-page-edits': press,
    'fix-review-edits': async () => {
      const drawer = page.getByRole('dialog', { name: /Improve a page/u })
      await drawer.getByRole('button', { name: 'Show page edits' }).click()
      await expect(drawer.getByTestId('page-editor')).toBeVisible({ timeout: 60_000 })
      await page.waitForTimeout(400)
      await shot('fix-review-edits-marked')
      await gotIt()
    },
    'fix-published': async () => {
      const drawer = page.getByRole('dialog', { name: /·/u })
      const publish = drawer.getByRole('button', { name: 'I published this' })
      await expect(publish).toBeEnabled({ timeout: 30_000 })
      await publish.click()
      await expect(drawer.getByTestId('fxt-published')).toBeVisible()
      await shot('fix-published-live-since')
    }
  })
  expect(fix.at(-1)).toBe('fix-published')
  await page.keyboard.press('Escape')

  await startLesson('Did it work?')
  await walk('Did it work?', {})

  // Every other screen: each lesson walked with Got it.
  for (const title of [
    'Your topics',
    'Your questions',
    'Competitors',
    'Citations',
    'Reports',
    'Read a report',
    'Check history',
    'Alerts',
    'Your pages',
    'Report branding'
  ]) {
    await startLesson(title)
    await walk(title, {
      'report-open': press,
      'competitors-add': async () => {
        await popover().getByRole('button', { name: 'Skip' }).click()
      }
    })
  }

  await startLesson('Settings')
  await walk('Settings', {
    theme: async () => {
      await press()
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      // The popover moves below the menu, so both can be read.
      await expect(page.locator('.gd-coach')).toHaveAttribute('data-popup', '')
      await page.waitForTimeout(600)
      await shot('theme-menu-open')
      await menu.locator('[role^="menuitem"]', { hasText: 'Sepia' }).click()
    },
    celebrations: press
  })

  // The guide drawer: this screen's lesson, the overall count, All lessons.
  await page.getByTestId('guide-pill').click()
  await expect(page.getByTestId('guide-checklist')).toBeVisible()
  await page.getByTestId('guide-checklist').getByRole('button', { name: 'All lessons' }).click()
  await shot('checklist-at-the-end')
  await page.keyboard.press('Escape')
  await expect(page.getByText(/Error invoking remote method/u)).toHaveCount(0)
})

test('Ctrl+K finds screens, settings, actions and data in everyday words', async () => {
  test.setTimeout(180_000)
  await openHash(page, '#/overview')
  await settle(page)
  const box = page.getByRole('combobox', { name: /^Find anything/u })
  await shot('search-start')
  const go = async (query: string, option: RegExp, name: string): Promise<void> => {
    await page.keyboard.press('Control+k')
    await expect(box).toBeFocused()
    await box.fill(query)
    // No top bar tooltip sits on the open results.
    await page.getByTestId('guide-pill').hover()
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector('[data-testid="guide-pill"]')!, '::after').display
      )
    ).toBe('none')
    const found = page.getByRole('option', { name: option }).first()
    try {
      await expect(found).toBeVisible({ timeout: 15_000 })
    } catch (error) {
      await shot(`search-${name}-not-found`)
      throw error
    }
    await shot(`search-${name}`)
    await found.click()
  }
  const hash = (): Promise<string> => page.evaluate(() => location.hash)

  await go('keys', /Connections · API keys/u, 'keys')
  await expect.poll(hash).toBe('#/connections')
  await go('rivals', /^Competitors/u, 'rivals')
  await expect.poll(hash).toBe('#/competitors')
  await go('how often', /Project settings · Schedule/u, 'how-often')
  await expect.poll(hash).toBe('#/project-settings?tab=schedule')
  await go('brief', /Fixes · What to fix/u, 'brief')
  await expect.poll(hash).toBe('#/fixes')
  // A drawer action opens over the screen open now.
  await go('check now', /^Check now/u, 'check-now')
  await expect.poll(hash).toBe('#/fixes?drawer=check-now')
  await shot('search-check-now-drawer')
  await page
    .getByRole('dialog', { name: /Check now/u })
    .getByRole('button', { name: /^Close/u })
    .first()
    .click()
  await expect.poll(hash).toBe('#/fixes')
  await go('tour', /Open the guide/u, 'tour')
  await expect(page.getByTestId('guide-checklist')).toBeVisible()
  await page.keyboard.press('Escape')
  // A look switches at once, and back.
  await go('dark mode', /Switch theme to Dark/u, 'dark-mode')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await shot('search-dark-applied')
  await go('sepia', /Switch theme to Sepia/u, 'sepia')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')
  // The project's own fixes and logged changes.
  await page.keyboard.press('Control+k')
  await box.fill('fix')
  const fixes = page.locator('.topbar-group[data-group="fixes"]')
  await expect(fixes).toBeVisible({ timeout: 15_000 })
  await shot('search-fixes-data')
  await fixes.getByRole('option').first().click()
  await expect.poll(hash).toMatch(/drawer=(page-fix|fix)/u)
  await page.keyboard.press('Escape')
})
