import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { animationsDone } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * ✦ Help me write in Add questions (HelpFill.dc.html panels 1–3) on the real
 * handlers and sqlite: the two-market TextBolt seed. Describe it runs the
 * `prompts.more` assist through the `claude` stand-in (its recorded fixture);
 * Use your own ChatGPT shows the prompt, copies it, opens the chatbot and reads a
 * pasted ChatGPT-style answer. The clipboard and `shell.openExternal` are
 * stubbed, so nothing leaves the app. Screenshots at 1440 × 900 and 1134 × 770 in
 * both themes go to test-results/e2e/helpfill-*.png; no sideways scroll.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }
const PAGE = 'page-1'

/** A ChatGPT answer: chatter, a fenced CSV with a tracked near-copy, a repeat and a brand row. */
const ANSWER = `Sure! Here are 5 new questions your buyers might type:

\`\`\`csv
question,stage,page
"Our freezer alarm only emails the office at night, how can the manager get a text?",Problem,/
"How do I alert crew without a developer, 2026?",Problem,/
"Can a small clinic text staff from Outlook without an app?",Options,/
"Can a small clinic text staff from Outlook without an app",Options,/
"Is TextBolt cheaper than building on Twilio?",Compare,/
\`\`\`

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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-helpfill-'))
  await seedTwoMarketProject(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeClaudeStandIn(path.join(bin, 'claude'), SHIM)
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

/** Both sizes and both themes, with no sideways scroll in the window or the drawer. */
async function shots(page: Page, drawer: Locator, name: string, focus: Locator): Promise<void> {
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
        // Any box inside the drawer that scrolls sideways (a list, the drafted rows).
        const inner = [...node.querySelectorAll<HTMLElement>('*')]
          .filter((el) => {
            const x = getComputedStyle(el).overflowX
            return (x === 'auto' || x === 'scroll') && el.scrollWidth - el.clientWidth > 1
          })
          .map((el) => el.className || el.tagName)
        return {
          page: root.scrollWidth - root.clientWidth,
          body: body.scrollWidth - body.clientWidth,
          inner
        }
      })
      expect(overflow.page, `${name} ${size.width} ${scheme}: window`).toBeLessThanOrEqual(0)
      expect(overflow.body, `${name} ${size.width} ${scheme}: drawer`).toBeLessThanOrEqual(0)
      expect(overflow.inner, `${name} ${size.width} ${scheme}: inside the drawer`).toEqual([])
      await page.screenshot({
        path: await e2eArtifact(`helpfill-${name}-${size.width}-${scheme}.png`)
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

test('Add questions ✦ Help me write: Describe it and Use your own ChatGPT', async () => {
  test.setTimeout(300_000)
  const { app, page, dir, shimLog } = await launch()
  const add = page.getByRole('dialog', { name: 'Add questions' })
  const helper = add.getByTestId('aq-hf')
  try {
    await test.step('the tab is "Help me write" and opens on Describe it with the cost', async () => {
      await openHash(page, `#/overview?drawer=add-questions&page=${PAGE}&tab=suggest`)
      await expect(add).toBeVisible()
      await expect(add.getByRole('tab', { name: 'Help me write' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await expect(helper.getByText(/^1 AI call · /u)).toBeVisible()
    })

    await test.step('Describe it: Claude drafts rows that come in ticked', async () => {
      await helper
        .getByLabel("Who is searching, and what's their problem?")
        .fill('Night managers whose alarm panels only send email')
      await helper.getByRole('button', { name: 'Write 10 questions' }).click()
      await expect(helper.getByTestId('aq-hf-summary')).toContainText(/are ready\.$/u)
      const drafted = add.getByRole('list', { name: 'Drafted · tick the ones to keep' })
      await expect(drafted.getByRole('listitem').first()).toBeVisible()
      const log = readFileSync(shimLog, 'utf8')
      expect(log).toContain('prompts.more')
      await shots(page, add, 'describe', helper.getByTestId('aq-hf-summary'))
      const count = await drafted.getByRole('listitem').count()
      await add.getByRole('button', { name: `Add ${count} to the rows` }).click()
      await expect(drafted).toHaveCount(0)
      await expect(add.getByLabel('Question 1', { exact: true })).not.toHaveValue('')
    })

    await test.step('Use your own ChatGPT: the prompt, the bot on the URL, Copy and Open', async () => {
      await pick(helper.getByRole('radio', { name: /Use your own ChatGPT/u }))
      await expect.poll(() => hashOf(page)).toContain('help=chatbot')
      const prompt = helper.getByTestId('hf-prompt')
      await expect(prompt).toContainText('question,stage,page')
      await expect(prompt).toContainText('Never name TextBolt')
      const text = (await prompt.textContent()) ?? ''
      expect(text).not.toMatch(/@|\/Users\/|sk-ant-/u)
      // No filler lines for context the project has not filled in.
      expect(text).not.toMatch(/: (?:not (?:set|given|known)|none (?:given|saved|noted))\b/u)

      await helper.getByTestId('hf-copy-prompt').click()
      await expect(helper.getByTestId('hf-copy-prompt')).toHaveAccessibleName('Copied')
      await expect(helper.getByTestId('hf-copy-prompt')).toHaveAccessibleName('Copy prompt', {
        timeout: 4000
      })
      expect((await copied(page)).at(-1)).toContain('question,stage,page')

      // Gemini has no prefill link: Open copies the prompt and opens its home page.
      await pick(helper.getByRole('radio', { name: 'Gemini', exact: true }))
      await expect.poll(() => hashOf(page)).toContain('bot=gemini')
      await helper.getByRole('button', { name: 'Open Gemini' }).click()
      await expect.poll(() => opened(app)).toContain('https://gemini.google.com/app')
      await expect(helper.getByText('Prompt copied. Paste it into Gemini.')).toBeVisible()

      // ChatGPT reads ?q= when the link is short enough; else it opens the home page.
      await pick(helper.getByRole('radio', { name: 'ChatGPT', exact: true }))
      await helper.getByRole('button', { name: 'Open ChatGPT', exact: true }).click()
      await expect
        .poll(async () => (await opened(app)).at(-1) ?? '')
        .toMatch(/^https:\/\/chatgpt\.com\/(?:\?q=.+)?$/u)
      await shots(page, add, 'chatbot', helper.getByTestId('hf-prompt'))
    })

    await test.step('paste the answer back: merged, set aside and ready', async () => {
      await helper.getByLabel('Paste its answer below').fill(ANSWER)
      await helper.getByRole('button', { name: 'Read the answer' }).click()
      const banner = helper.getByTestId('aq-hf-summary')
      await expect(banner).toHaveText(
        'Read 5 rows. 1 was close to questions you track and was merged. 1 repeated another row and was merged. 1 named TextBolt and was set aside. 2 are ready.'
      )
      const drafted = add.getByRole('list', { name: 'Drafted · tick the ones to keep' })
      await expect(drafted.getByRole('listitem')).toHaveCount(2)
      await expect(drafted).toContainText('freezer alarm')
      await shots(page, add, 'read', banner)
      await add.getByRole('button', { name: 'Add 2 to the rows' }).click()
      await expect(add.getByText('freezer alarm', { exact: false }).first()).toBeVisible()
    })

    await test.step('Back returns to Describe it; Forward to the chatbot way', async () => {
      await page.goBack()
      await expect.poll(() => hashOf(page)).not.toContain('help=chatbot')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await page.goForward()
      await expect.poll(() => hashOf(page)).toContain('help=chatbot')
      await expect(helper.getByTestId('hf-chatbot')).toBeVisible()
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
