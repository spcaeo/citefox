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
 * ✦ Help me fill this on the buyer profile (Page › Audience, HelpFill.dc.html panel
 * 7) on the real handlers and sqlite: the two-market TextBolt seed, whose page-1
 * profile has no segments, triggers or values yet. Describe it runs `audience.sharpen`
 * and `audience.triggers` through the `claude` stand-in (their recorded fixtures);
 * Use your own ChatGPT shows the prompt, copies it and reads a pasted answer. The
 * clipboard and `shell.openExternal` are stubbed. Rows land in the profile's review
 * card and are saved only on "Add to the profile". Screenshots at 1440 × 900 and
 * 1134 × 770 in both themes go to test-results/e2e/helpfill-buyers-*.png; no
 * sideways scroll.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }
const AUDIENCE = '#/pages/page-1/audience'

/** A ChatGPT answer: chatter, a markdown table with a repeated buyer type. */
const ANSWER = `Sure! Here are buyer types for this page:

| who | problem | trigger | need |
| --- | --- | --- | --- |
| Clinic office managers | Shift changes get lost in email | A nurse missed a shift change | Texts from Outlook |
| Field service dispatchers | Crews miss job emails on site | A job email sat unread for hours | Alerts that reach a phone |
| Clinic office managers | Same problem | Same | Same |

Let me know if you want more!`

interface Launched {
  app: ElectronApplication
  page: Page
  dir: string
  shimLog: string
}

async function launch(): Promise<Launched> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-helpfill-buyers-'))
  await seedTwoMarketProject(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)
  const shimLog = path.join(dir, 'claude-shim.log')
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: WIDE,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: shimLog
    }
  })
  await openAllPages(page)
  await stubOutside(app, page)
  return { app, page, dir, shimLog }
}

/** `shell.openExternal` and the clipboard only record what they were given. */
async function stubOutside(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __opened?: string[] }).__opened = opened
    shell.openExternal = (async (url: string) => {
      opened.push(url)
    }) as typeof shell.openExternal
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

async function opened(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [...((globalThis as { __opened?: string[] }).__opened ?? [])])
}

async function copied(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __copied: string[] }).__copied])
}

/**
 * The work console opens over the screen while Claude runs; it stays open after the
 * stand-in's `audience.triggers` answer fails its check (the seed's page lacks the
 * headings the fixture cites). Hide it so the shots show the helper.
 */
async function hideConsole(page: Page): Promise<void> {
  const hide = page.getByRole('button', { name: 'Hide the console, the work keeps running' })
  if (await hide.isVisible()) await hide.click()
}

/** Both sizes and both themes, with no sideways scroll in the window or the main column. */
async function shots(page: Page, name: string, focus: Locator): Promise<void> {
  await hideConsole(page)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size)
      await animationsDone(page)
      await focus.evaluate((node) => node.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(200)
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement
        const main = document.querySelector('main') ?? document.body
        const inner = [...main.querySelectorAll<HTMLElement>('.au-help *, .ui-suggest *')]
          .filter((el) => {
            const x = getComputedStyle(el).overflowX
            return (x === 'auto' || x === 'scroll') && el.scrollWidth - el.clientWidth > 1
          })
          .map((el) => el.className || el.tagName)
        return {
          page: root.scrollWidth - root.clientWidth,
          main: main.scrollWidth - main.clientWidth,
          inner
        }
      })
      expect(overflow.page, `${name} ${size.width} ${scheme}: window`).toBeLessThanOrEqual(0)
      expect(overflow.main, `${name} ${size.width} ${scheme}: main`).toBeLessThanOrEqual(0)
      expect(overflow.inner, `${name} ${size.width} ${scheme}: helper`).toEqual([])
      await page.screenshot({
        path: await e2eArtifact(`helpfill-buyers-${name}-${size.width}-${scheme}.png`)
      })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize(WIDE)
}

/** The radios are visually hidden inside their cards: click the card, as a person does. */
async function pick(radio: Locator): Promise<void> {
  await radio.locator('xpath=..').click()
  await expect(radio).toBeChecked()
}

function hashOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

test('Buyer profile ✦ Help me fill this: Describe it and Use your own ChatGPT', async () => {
  test.setTimeout(300_000)
  const { app, page, dir, shimLog } = await launch()
  const helper = page.getByTestId('au-hf')
  const grid = page.getByRole('grid', { name: 'Buyer profile points' })
  const card = page.getByRole('region', { name: 'Buyer types to add' })
  try {
    await test.step('the AI menu opens the helper on Describe it, with the cost', async () => {
      await openHash(page, AUDIENCE)
      await expect(grid).toBeVisible()
      await page.getByRole('button', { name: 'AI actions for the buyer profile' }).click()
      await page.getByRole('menuitem', { name: /Help me fill this/u }).click()
      await expect.poll(() => hashOf(page)).toContain('au.help=describe')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await expect(helper.getByText(/^2 AI calls · /u)).toBeVisible()
    })

    await test.step('Describe it: Sharpen and Find more trigger events fill the review card', async () => {
      await helper
        .getByLabel('Who are your best customers, and what sends them looking?')
        .fill('Our best customers are clinics and HVAC firms that text crews from Outlook')
      await helper.getByRole('button', { name: 'Draft buyer segments' }).click()
      await expect(helper.getByTestId('au-hf-summary')).toContainText(/ready\.$/u)
      await expect(card).toBeVisible()
      await expect(card.getByText('Segment', { exact: true })).toBeVisible()
      await expect(card.getByText('Nothing new for staff to install')).toBeVisible()
      const log = readFileSync(shimLog, 'utf8')
      expect(log).toContain('audience.sharpen')
      expect(log).toContain('audience.triggers')
      // Nothing is saved before Add.
      await expect(grid.getByText('Nothing new for staff to install')).toHaveCount(0)
      await shots(page, 'describe', helper.getByTestId('au-hf-summary'))
      await card.getByRole('button', { name: 'Add to the profile' }).click()
      await expect(grid.getByText('Nothing new for staff to install')).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
      // The seeded profile's segments, triggers and values were empty: a part is never
      // emptied again, so this add has no Undo.
      await expect(card.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    })

    await test.step('Use your own ChatGPT: the prompt, the bot on the URL, Copy and Open', async () => {
      await pick(helper.getByRole('radio', { name: /Use your own ChatGPT/u }))
      await expect.poll(() => hashOf(page)).toContain('au.help=chatbot')
      const prompt = helper.getByTestId('hf-prompt')
      await expect(prompt).toContainText('who,problem,trigger,need')
      await expect(prompt).toContainText('buyer types who would search for this page')
      const text = (await prompt.textContent()) ?? ''
      expect(text).not.toMatch(/@|\/Users\/|sk-ant-/u)

      await helper.getByTestId('hf-copy-prompt').click()
      await expect(helper.getByTestId('hf-copy-prompt')).toHaveAccessibleName('Copied')
      expect((await copied(page)).at(-1)).toContain('who,problem,trigger,need')

      await pick(helper.getByRole('radio', { name: 'Perplexity', exact: true }))
      await expect.poll(() => hashOf(page)).toContain('au.bot=perplexity')
      await helper.getByRole('button', { name: 'Open Perplexity' }).click()
      await expect
        .poll(async () => (await opened(app)).at(-1) ?? '')
        .toMatch(/^https:\/\/www\.perplexity\.ai\//u)
      await shots(page, 'chatbot', helper.getByTestId('hf-prompt'))
    })

    await test.step('paste the answer back: a repeat merged, points ready to tick', async () => {
      await helper.getByLabel('Paste its answer below').fill(ANSWER)
      await helper.getByRole('button', { name: 'Read the answer' }).click()
      const banner = helper.getByTestId('au-hf-summary')
      await expect(banner).toHaveText(
        'Read 3 rows. 1 repeated another row and was merged. 2 are ready.'
      )
      await expect(card).toContainText('2 segments · 2 trigger events · 2 values')
      await card.getByRole('checkbox', { name: /Alerts that reach a phone/u }).uncheck()
      await shots(page, 'read', card)
      await card.getByRole('button', { name: 'Add to the profile' }).click()
      await expect(grid.getByText('Clinic office managers')).toBeVisible()
      await expect(grid.getByText('A job email sat unread for hours')).toBeVisible()
      await expect(grid.getByText('Alerts that reach a phone')).toHaveCount(0)
      // Every part had points before this add, so Undo takes it back.
      await card.getByRole('button', { name: 'Undo' }).click()
      await expect(grid.getByText('Clinic office managers')).toHaveCount(0)
      await expect(grid.getByText('Nothing new for staff to install')).toBeVisible()
    })

    await test.step('Back returns to Describe it; closing takes the helper off the URL', async () => {
      await page.goBack()
      await expect.poll(() => hashOf(page)).toContain('au.help=describe')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await page.goForward()
      await expect.poll(() => hashOf(page)).toContain('au.help=chatbot')
      await page.getByRole('button', { name: 'Close the helper' }).click()
      await expect.poll(() => hashOf(page)).not.toContain('au.help')
      await expect(helper).toHaveCount(0)
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
