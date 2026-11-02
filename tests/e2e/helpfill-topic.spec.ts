import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * New topic → "A buyer problem" with the ✦ Help me fill look (HelpFill.dc.html panel 7)
 * on the real handlers and sqlite (the two-market TextBolt seed). Describe it is the box
 * as before: the footer's Write questions runs `topics:generateQuestions` through the
 * `claude` stand-in (src/main/topics/fixtures). Use your own ChatGPT shows the topic
 * prompt with the typed problem, copies it, opens the chatbot, and reads a pasted answer
 * into the draft: the topic name, the questions with stage, and each one's target page.
 * The topic is saved only on Create topic. The clipboard and `shell.openExternal` are
 * stubbed. Screens at 1440 × 900 and 1134 × 770 in both themes go to
 * test-results/e2e/helpfill-topic-*.png; no sideways scroll.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }
const OWN_PAGE = '/blog/how-to-set-up-text-alerts-for-business/'
const NAME = 'Carrier gateway shutdown'

/** A ChatGPT answer: chatter, a markdown table with a repeat, a brand row and two pages. */
const ANSWER = `Sure! Here is one topic for TextBolt:

| question | stage | page | topic |
| --- | --- | --- | --- |
| Our carrier shut down email to text, how do the night alarms reach us now? | Problem | ${OWN_PAGE} | ${NAME} |
| What can replace a carrier email-to-text gateway for a small office? | Options | ${OWN_PAGE} | ${NAME} |
| What can replace a carrier email to text gateway for a small office | Options | ${OWN_PAGE} | ${NAME} |
| Do email-to-SMS services work with old alarm panels? | Doubts | /guides/carrier-gateway-shutdown/ | ${NAME} |
| Is TextBolt cheaper than a carrier gateway? | Compare | /pricing/ | ${NAME} |

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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-helpfill-topic-'))
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
      CITEFOX_SHIM_LOG: shimLog,
      CITEFOX_E2E_TOPICS: '1'
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

/** Waits for running animations; one cancelled on the way (a re-render) is not an error. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished))
  })
}

/** Both sizes and both themes, with no sideways scroll in the window or the drawer. */
async function shots(page: Page, drawer: Locator, name: string, focus: Locator): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size)
      await settled(page)
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
        const edge = body.getBoundingClientRect().right
        // What sticks out past the drawer body, named for the failure message.
        const wide = [...body.querySelectorAll<HTMLElement>('*')]
          .filter((el) => el.getBoundingClientRect().right > edge + 1)
          .map((el) => `${el.tagName}.${el.className}`)
          .slice(0, 5)
        return {
          page: root.scrollWidth - root.clientWidth,
          body: body.scrollWidth - body.clientWidth,
          inner,
          wide
        }
      })
      await page.screenshot({
        path: await e2eArtifact(`helpfill-${name}-${size.width}-${scheme}.png`)
      })
      expect(overflow.page, `${name} ${size.width} ${scheme}: window`).toBeLessThanOrEqual(0)
      expect(
        overflow.body,
        `${name} ${size.width} ${scheme}: drawer (${overflow.wide.join(', ')})`
      ).toBeLessThanOrEqual(0)
      expect(overflow.inner, `${name} ${size.width} ${scheme}: inside the drawer`).toEqual([])
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

test('New topic ✦ A buyer problem: Describe it and Use your own ChatGPT', async () => {
  test.setTimeout(300_000)
  const { app, page, dir, shimLog } = await launch()
  const drawer = page.getByRole('dialog', { name: 'New topic' })
  const helper = drawer.getByTestId('nt-help')
  try {
    await test.step('A buyer problem opens on Describe it: the box, as before', async () => {
      await openHash(page, '#/topics?drawer=new-topic')
      await expect(drawer).toBeVisible()
      await expect(drawer.getByRole('radio', { name: /A buyer problem/u })).toBeChecked()
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await expect(drawer.getByText(/CiteFox AI · about \d+ s/u)).toBeVisible()
    })

    await test.step('Describe it: Write questions fills the preview through Claude', async () => {
      await helper
        .getByLabel('The buyer’s situation')
        .fill('Clinics whose carrier email-to-text gateway shut down overnight')
      await drawer.getByRole('button', { name: 'Write questions' }).click()
      const preview = drawer.getByRole('region', { name: 'Preview' })
      await expect(preview).toBeVisible({ timeout: 60_000 })
      await expect(preview).toContainText('Written from your buyer profile')
      expect(readFileSync(shimLog, 'utf8')).toContain('topic-topic_journey_questions')
      await shots(page, drawer, 'topic-describe', preview)
    })

    await test.step('Use your own ChatGPT: the prompt carries the problem; Copy and Open', async () => {
      await pick(helper.getByRole('radio', { name: /Use your own ChatGPT/u }))
      await expect.poll(() => hashOf(page)).toContain('nt.help=chatbot')
      await expect(drawer.getByRole('button', { name: 'Review questions' })).toBeEnabled()
      const prompt = helper.getByTestId('hf-prompt')
      await expect(prompt).toContainText('question,stage,page,topic')
      await expect(prompt).toContainText(
        'Buyer problem: Clinics whose carrier email-to-text gateway shut down overnight'
      )
      await expect(prompt).toContainText('Never name TextBolt')
      await expect(prompt).toContainText(OWN_PAGE)
      expect((await prompt.textContent()) ?? '').not.toMatch(/@|\/Users\/|sk-ant-/u)

      await helper.getByTestId('hf-copy-prompt').click()
      await expect(helper.getByTestId('hf-copy-prompt')).toHaveAccessibleName('Copied')
      expect((await copied(page)).at(-1)).toContain('question,stage,page,topic')

      await pick(helper.getByRole('radio', { name: 'Perplexity', exact: true }))
      await expect.poll(() => hashOf(page)).toContain('nt.bot=perplexity')
      await helper.getByRole('button', { name: 'Open Perplexity' }).click()
      await expect
        .poll(async () => (await opened(app)).at(-1) ?? '')
        .toMatch(/^https:\/\/www\.perplexity\.ai\//u)
      await shots(page, drawer, 'topic-chatbot', prompt)
    })

    await test.step('Back returns to Describe it; Forward to the chatbot way', async () => {
      await page.goBack()
      await expect.poll(() => hashOf(page)).not.toContain('nt.help=chatbot')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await page.goForward()
      await expect.poll(() => hashOf(page)).toContain('nt.help=chatbot')
      await expect(helper.getByTestId('hf-chatbot')).toBeVisible()
    })

    await test.step('paste the answer: the preview, the name and the pages; nothing saved', async () => {
      await helper.getByLabel('Paste its answer below').fill(ANSWER)
      await helper.getByRole('button', { name: 'Read the answer' }).click()
      const banner = helper.getByTestId('nt-help-summary')
      await expect(banner).toHaveText(
        'Read 5 rows. 1 repeated another row and was merged. 1 named TextBolt and was set aside. 3 are ready.'
      )
      const preview = drawer.getByRole('region', { name: 'Preview' })
      await expect(preview).toContainText('From your chatbot’s answer, no searches used')
      await expect(preview).toContainText('night alarms reach us')
      await shots(page, drawer, 'topic-read', banner)

      await drawer.getByRole('button', { name: 'Review questions' }).click()
      const list = drawer.getByRole('list', { name: 'Questions' })
      await expect(list.getByRole('listitem')).toHaveCount(3)
      await expect(drawer.getByLabel('Topic name')).toHaveValue(NAME)
      await drawer.getByRole('button', { name: /Target pages/u }).click()
      const targets = drawer.getByRole('list', { name: 'Target pages' })
      await expect(targets).toBeVisible()
      await expect(drawer.getByLabel('Target page for question 1')).toHaveValue(
        `https://textbolt.com${OWN_PAGE}`
      )
      await shots(page, drawer, 'topic-pages', targets)
    })

    await test.step('Create topic saves it and opens it on Topics', async () => {
      await drawer.getByRole('button', { name: 'Create topic' }).click()
      await expect(drawer).toHaveCount(0)
      await expect.poll(() => hashOf(page)).toMatch(/#\/topics\?row=/u)
      await expect(page.getByText(NAME).first()).toBeVisible()
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
