import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { animationsDone } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * ✦ Help me fill this in four action places (HelpFill.dc.html panels 5 and 7) on the
 * real handlers and sqlite: the two-market TextBolt seed, plus one other site (g2.com)
 * that Google cites next to SimpleTexting where TextBolt is not cited.
 *
 * - Fix rewrite: Draft it for me (the fix assists through the `claude` stand-in) and
 *   Rewrite with my ChatGPT (the pasted section becomes "What changed").
 * - Outreach pitch: Citations → g2.com → "✦ Draft a pitch", both ways, shown with Copy.
 * - Alert rule: "✦ Describe it" fills a new rule's fields (`alerts.describeRule`).
 * - Report summary: Email preview → "Write it in your own voice with my ChatGPT"; the
 *   report's number check takes out a sentence with a number the report lacks.
 *
 * The clipboard and `shell.openExternal` are stubbed; nothing is sent. Screenshots at
 * 1440 × 900 and 1134 × 770 in both themes go to test-results/e2e/helpfill-actions-*.png,
 * with no sideways scroll.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }

const SECTION = `Sure! Here is the rewritten section:

## Text the crew without a developer

Forward the alerts your tools already email to TextBolt and each one becomes a text in 2 minutes.

1. Sign up.
2. Point your alert emails at your TextBolt address.

Hope this helps!`

const PITCH = `Subject: One more tool for your SMS list

Hi there,

Your SMS software list is one of the pages Google shows for crew alerts. TextBolt turns alert emails into texts with no developer. Would you add it?

Thanks`

let app: ElectronApplication
let page: Page
let dir: string
let shimLog: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-helpfill-actions-'))
  await seedTwoMarketProject(dir)
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    // An other site cited next to SimpleTexting in the overviews that do not cite TextBolt.
    db.prepare(
      `INSERT INTO aio_references
         (id, serp_result_id, position, url, normalized_url, domain, title, classification, untracked, source_type)
       SELECT 'ref-g2-' || id, serp_result_id, position + 1,
              'https://www.g2.com/categories/sms-marketing', 'https://g2.com/categories/sms-marketing',
              'g2.com', 'Best SMS marketing software', 'other', 0, 'review'
       FROM aio_references
       WHERE domain = 'simpletexting.com'
         AND serp_result_id NOT IN (
           SELECT serp_result_id FROM aio_references WHERE domain LIKE '%textbolt.com'
         )`
    ).run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)
  shimLog = path.join(dir, 'claude-shim.log')
  const launched = await launchCiteFox({
    userDataDir: dir,
    viewport: WIDE,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: shimLog
    }
  })
  app = launched.app
  page = launched.page
  await openAllPages(page)
  await stubOutside()
})

test.afterAll(async () => {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

/** `shell.openExternal` and the clipboard only record what they were given. */
async function stubOutside(): Promise<void> {
  await app.evaluate(({ shell }) => {
    shell.openExternal = (async () => undefined) as typeof shell.openExternal
  })
  await page.evaluate(() => {
    const copied: string[] = []
    ;(window as unknown as { __copied: string[] }).__copied = copied
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text)
        }
      }
    })
  })
}

async function copied(): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __copied: string[] }).__copied])
}

function shim(): string {
  try {
    return readFileSync(shimLog, 'utf8')
  } catch {
    return ''
  }
}

function hashOf(): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

/** The radios are visually hidden inside their cards: click the card, as a person does. */
async function pick(radio: Locator): Promise<void> {
  await radio.locator('xpath=..').click()
  await expect(radio).toBeChecked()
}

/** Both sizes and both themes, with no sideways scroll in the window or the drawer. */
async function shots(drawer: Locator, name: string, focus: Locator): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size)
      await animationsDone(page)
      await focus.evaluate((node) => node.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(200)
      const overflow = await drawer.evaluate((node) => {
        const body = node.querySelector('.ui-drawer-body') ?? node
        const root = document.scrollingElement ?? document.documentElement
        const inner = [...node.querySelectorAll<HTMLElement>('*')]
          .filter((el) => {
            const x = getComputedStyle(el).overflowX
            return (x === 'auto' || x === 'scroll') && el.scrollWidth - el.clientWidth > 1
          })
          .map((el) => el.className || el.tagName)
        // What sticks out past the drawer's right edge, to name it when the check fails.
        const style = getComputedStyle(body)
        const edge =
          body.getBoundingClientRect().left +
          body.clientLeft +
          body.clientWidth -
          parseFloat(style.paddingRight)
        const out = [...body.querySelectorAll<HTMLElement>('*')]
          .filter((el) => el.getBoundingClientRect().right > edge + 1)
          .slice(0, 5)
          .map((el) => `${el.tagName}.${String(el.className)}`)
        return {
          page: root.scrollWidth - root.clientWidth,
          body: body.scrollWidth - body.clientWidth,
          inner,
          out
        }
      })
      expect(overflow.page, `${name} ${size.width} ${scheme}: window`).toBeLessThanOrEqual(0)
      expect(
        overflow.body,
        `${name} ${size.width} ${scheme}: drawer (${overflow.out.join(', ')})`
      ).toBeLessThanOrEqual(0)
      expect(overflow.inner, `${name} ${size.width} ${scheme}: inside the drawer`).toEqual([])
      await page.screenshot({
        path: await e2eArtifact(`helpfill-actions-${name}-${size.width}-${scheme}.png`)
      })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize(WIDE)
}

/** The prompt shown, checked for what a prompt must never carry. */
async function promptText(helper: Locator): Promise<string> {
  const prompt = helper.getByTestId('hf-prompt')
  await expect(prompt).not.toBeEmpty()
  // Slow runners show the placeholder for a moment before the prompt arrives.
  await expect(prompt).not.toHaveText(/Writing the prompt/u, { timeout: 30_000 })
  const text = (await prompt.textContent()) ?? ''
  expect(text).not.toMatch(/@|\/Users\/|\/root\/|sk-ant-/u)
  return text
}

test('Fix rewrite: Draft it for me, then Rewrite with my ChatGPT', async () => {
  test.setTimeout(180_000)
  const drawer = page.getByRole('dialog', { name: 'Log a fix' })
  const helper = drawer.getByTestId('fxd-hf')
  const what = drawer.getByLabel('What changed', { exact: true })
  await openHash(page, '#/fixes?drawer=fix&fix=new&fix.page=page-1&fix.prompts=prompt-1')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByTestId('fxd-help')).toContainText('without a developer')

  await test.step('Draft it for me: the fix assists write the section into What changed', async () => {
    await expect(helper.getByRole('radio', { name: /Draft it for me/u })).toBeChecked()
    await helper.getByRole('button', { name: 'Draft it for me' }).click()
    await expect(what).not.toHaveValue('', { timeout: 30_000 })
    expect(shim()).toMatch(/gaps\.draftFix|progress\.draftFix/u)
    await shots(drawer, 'fix-describe', drawer.getByTestId('fxd-what'))
  })

  await test.step('Rewrite with my ChatGPT: the prompt has the question; the paste replaces the draft', async () => {
    await pick(helper.getByRole('radio', { name: /Rewrite with my ChatGPT/u }))
    await expect.poll(hashOf).toContain('fix.help=chatbot')
    const text = await promptText(helper)
    expect(text).toContain('without a developer')
    await helper.getByTestId('hf-copy-prompt').click()
    await expect.poll(async () => (await copied()).at(-1) ?? '').toContain('without a developer')
    await helper.getByLabel('Paste its answer below').fill(SECTION)
    await helper.getByRole('button', { name: 'Read the answer' }).click()
    await expect(what).toHaveValue(/^## Text the crew without a developer/u)
    await expect(what).not.toHaveValue(/Hope this helps/u)
    await expect(drawer.getByText('The draft replaced your text.')).toBeVisible()
    await shots(drawer, 'fix-chatbot', drawer.getByTestId('fxd-what'))
  })
  await page.keyboard.press('Escape')
})

test('Outreach pitch: Citations → an other site → ✦ Draft a pitch, both ways', async () => {
  test.setTimeout(180_000)
  await openHash(page, '#/citations?cit.whose=other')
  const grid = page.getByRole('grid', { name: 'Cited pages' })
  await expect(grid).toBeVisible()
  await grid.getByText('Best SMS marketing software').click()
  const button = page.getByTestId('cit-pitch').first()
  await expect(button).toBeVisible()
  await button.click()
  await expect.poll(hashOf).toContain('drawer=pitch')
  const drawer = page.getByRole('dialog', { name: 'Draft a pitch' })
  const helper = drawer.getByTestId('pitch-hf')
  await expect(drawer.getByTestId('pitch-facts')).toContainText('simpletexting.com')
  await expect(drawer.getByTestId('pitch-facts')).toContainText('g2.com')
  // Nothing is sent: no green primary, only Close.
  await expect(drawer.locator('.ui-btn-primary')).toHaveCount(0)

  await test.step('Draft it for me: citations.pitch writes the email, shown with Copy', async () => {
    await helper.getByRole('button', { name: 'Draft the pitch' }).click()
    const draft = drawer.getByTestId('pitch-draft')
    await expect(draft).toContainText('Subject:', { timeout: 30_000 })
    expect(shim()).toContain('citations.pitch')
    await draft.getByRole('button', { name: 'Copy pitch email' }).click()
    await expect.poll(async () => (await copied()).at(-1) ?? '').toContain('Subject:')
    await shots(drawer, 'pitch-describe', draft)
  })

  await test.step('Write it with my ChatGPT: the prompt has the site and the question', async () => {
    await pick(helper.getByRole('radio', { name: /Write it with my ChatGPT/u }))
    await expect.poll(hashOf).toContain('pitch.help=chatbot')
    const text = await promptText(helper)
    expect(text).toContain('g2.com')
    expect(text).toContain('without a developer')
    await helper.getByLabel('Paste its answer below').fill(PITCH)
    await helper.getByRole('button', { name: 'Read the answer' }).click()
    await expect(drawer.getByTestId('pitch-draft')).toContainText('Would you add it?')
    await shots(drawer, 'pitch-chatbot', drawer.getByTestId('pitch-draft'))
  })
  await page.keyboard.press('Escape')
})

test('Alert rule: ✦ Describe it fills a new rule for review', async () => {
  test.setTimeout(120_000)
  await openHash(page, '#/alerts?drawer=alert-rule&rule.id=new')
  const drawer = page.getByTestId('alert-rule-drawer')
  const box = drawer.getByTestId('rule-describe')
  await expect(box).toBeVisible()
  await expect(box.getByRole('radio', { name: /ChatGPT/u })).toHaveCount(0)
  await box
    .getByLabel('What should this rule tell you?')
    .fill('Tell me when a competitor overtakes us on pricing questions')
  await box.getByRole('button', { name: 'Fill in the rule' }).click()
  await expect(drawer.getByTestId('rule-described')).toContainText('Check each field', {
    timeout: 30_000
  })
  expect(shim()).toContain('alerts.describeRule')
  // The place's own note only, without the kit's "Read 1 row" banner.
  await expect(drawer.getByTestId('rule-described')).toContainText(
    'Filled in below. Check each field, then Save rule.'
  )
  await expect(box.getByTestId('rule-hf-summary')).toHaveCount(0)
  await expect(drawer.getByRole('textbox', { name: 'Rule name' })).toHaveValue(
    'Competitor cited on tracked pages'
  )
  await expect(drawer.getByRole('radio', { name: 'Competitor is cited instead' })).toBeChecked()
  await shots(drawer, 'alert-rule', box)
  await page.keyboard.press('Escape')
  const discard = page.getByRole('button', { name: /Discard/u })
  if (await discard.isVisible().catch(() => false)) await discard.click()
})

test('Report summary: in your own voice with my ChatGPT, number-checked', async () => {
  test.setTimeout(120_000)
  await openHash(page, '#/reports?drawer=schedule&schedule.id=new')
  const drawer = page.getByTestId('schedule-drawer')
  const preview = drawer.getByRole('region', { name: 'Email preview' })
  await expect(preview).toContainText('Latest check of', { timeout: 30_000 })
  await preview.getByRole('button', { name: 'AI actions for the summary' }).click()
  await page.getByRole('menuitem', { name: /Write it in your own voice with my ChatGPT/u }).click()
  await expect.poll(hashOf).toContain('schedule.help=chatbot')
  const own = preview.getByTestId('rpt-own')
  const text = await promptText(own)
  expect(text).toContain('use only these numbers')
  await own
    .getByLabel('Paste its answer below')
    .fill('Here is your summary:\n\nWe track TextBolt in Google. Visits rose 4321% this month.')
  await own.getByRole('button', { name: 'Read the answer' }).click()
  await expect(own.getByTestId('rpt-own-hf-summary')).toContainText('not in the report: 4321')
  await expect(own.getByTestId('rpt-own-result')).toContainText('We track TextBolt in Google.')
  await expect(own.getByTestId('rpt-own-result')).not.toContainText('4321')
  await shots(drawer, 'report-summary', own.getByTestId('rpt-own-result'))
})
