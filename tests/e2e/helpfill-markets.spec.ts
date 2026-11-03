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
 * ✦ Help me fill this in both Add market drawers (HelpFill.dc.html panel 7,
 * "Where do you sell?") on the real handlers and sqlite: the two-market TextBolt
 * seed (page-1 in US · en and UK · en). The page's drawer runs Describe it
 * through the `claude` stand-in (`markets.suggest`, its recorded fixture); the
 * project's drawer copies the prompt, opens Perplexity and reads a pasted
 * answer. The first suggestion fills the form; Use fills another; nothing is
 * added until the drawer's own button. The clipboard and `shell.openExternal`
 * are stubbed. Screenshots at 1440 × 900 and 1134 × 770 in both themes go to
 * test-results/e2e/helpfill-markets-*.png; no sideways scroll.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }
const PAGE = 'page-1'

/** A Perplexity-style answer: chatter, a markdown table, a tracked market (GB = UK) and a repeat. */
const ANSWER = `Here are markets where your buyers search Google:

| country | language | city |
|---|---|---|
| Canada | English | Toronto |
| GB | en | |
| Australia | en | Sydney |
| CA | EN | toronto |
| Mexico | Spanish | |

Hope this helps!`

interface Launched {
  app: ElectronApplication
  page: Page
  dir: string
  shimLog: string
}

async function launch(): Promise<Launched> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-helpfill-markets-'))
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
        path: await e2eArtifact(`helpfill-markets-${name}-${size.width}-${scheme}.png`)
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

test('Add market ✦ Help me fill this: Describe it on a page, your own chatbot for the project', async () => {
  test.setTimeout(300_000)
  const { app, page, dir, shimLog } = await launch()
  try {
    await test.step('page drawer · Describe it: Claude suggests, the first fills the form', async () => {
      await openHash(page, `#/pages/${PAGE}/markets?panel=add-market`)
      const drawer = page.getByRole('dialog', { name: 'Add a market' })
      await expect(drawer).toBeVisible()
      const helper = drawer.getByTestId('mk-add-help')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await expect(helper.getByText(/^1 AI call · /u)).toBeVisible()
      await helper
        .getByLabel('Where do you sell?')
        .fill('Offices in other English-speaking countries')
      await helper.getByRole('button', { name: 'Suggest 3 markets' }).click()
      await expect(helper.getByTestId('mh-hf-summary')).toContainText('2 are ready.')
      expect(readFileSync(shimLog, 'utf8')).toContain('markets.suggest')
      const form = drawer.getByRole('form', { name: 'Add a market' })
      await expect(form.getByLabel('Country')).toHaveValue('CA')
      await expect(form.getByLabel('Language')).toHaveValue('en')
      await expect(form.getByLabel(/City or region/u)).toHaveValue('Toronto')
      await expect(helper.getByTestId('mh-in-form')).toBeVisible()
      await shots(page, drawer, 'page-describe', helper.getByTestId('mh-picks'))
      await helper.getByRole('button', { name: 'Use AU · English · Sydney' }).click()
      await expect(form.getByLabel('Country')).toHaveValue('AU')
      await expect(form.getByLabel(/City or region/u)).toHaveValue('Sydney')
      // Nothing was added: closing asks before dropping the filled form, and the page keeps two markets.
      await drawer.getByRole('button', { name: 'Close Add a market' }).click()
      await page
        .getByRole('alertdialog', { name: 'Discard changes?' })
        .getByRole('button', { name: 'Discard' })
        .click()
      await expect(drawer).toHaveCount(0)
      await expect(page.getByTestId('markets-tab')).not.toContainText(/Australia|AU · /u)
      expect(await hashOf(page)).not.toMatch(/mk\.help|panel=/u)
    })

    await test.step('project drawer · your own chatbot: the prompt, Copy and Open Perplexity', async () => {
      await openHash(page, '#/overview?drawer=add-market')
      const drawer = page.getByRole('dialog', { name: 'Add market' })
      await expect(drawer).toBeVisible()
      const helper = drawer.getByTestId('add-market-help')
      await pick(helper.getByRole('radio', { name: /Use your own ChatGPT/u }))
      await expect.poll(() => hashOf(page)).toContain('am.help=chatbot')
      const prompt = helper.getByTestId('hf-prompt')
      await expect(prompt).toContainText('country,language,city')
      await expect(prompt).toContainText('- UK · en')
      expect((await prompt.textContent()) ?? '').not.toMatch(/@|\/Users\/|sk-ant-/u)
      await helper.getByTestId('hf-copy-prompt').click()
      expect((await copied(page)).at(-1)).toContain('country,language,city')
      await pick(helper.getByRole('radio', { name: 'Perplexity', exact: true }))
      await expect.poll(() => hashOf(page)).toContain('am.bot=perplexity')
      await helper.getByRole('button', { name: 'Open Perplexity', exact: true }).click()
      await expect
        .poll(async () => (await opened(app)).at(-1) ?? '')
        .toMatch(/^https:\/\/www\.perplexity\.ai\/(?:search\?q=.+)?$/u)
      await shots(page, drawer, 'project-chatbot', prompt)
    })

    await test.step('project drawer · paste the answer: merged, then the picks fill the form', async () => {
      const drawer = page.getByRole('dialog', { name: 'Add market' })
      const helper = drawer.getByTestId('add-market-help')
      await helper.getByLabel('Paste its answer below').fill(ANSWER)
      await helper.getByRole('button', { name: 'Read the answer' }).click()
      const banner = helper.getByTestId('mh-hf-summary')
      await expect(banner).toHaveText(
        'Read 5 rows. 1 was close to markets you track and was merged. 1 repeated another row and was merged. 3 are ready.'
      )
      await expect(drawer.getByLabel('Country')).toHaveValue('CA')
      await expect(drawer.getByLabel('City', { exact: true })).toHaveValue('Toronto')
      await helper.getByRole('button', { name: 'Use MX · Spanish' }).click()
      await expect(drawer.getByLabel('Country')).toHaveValue('MX')
      await expect(drawer.getByLabel('Language')).toHaveValue('es')
      await expect(drawer.getByLabel('City', { exact: true })).toHaveValue('')
      await shots(page, drawer, 'project-read', helper.getByTestId('mh-picks'))
    })

    await test.step('Back returns to Describe it; Forward to the chatbot way', async () => {
      const drawer = page.getByRole('dialog', { name: 'Add market' })
      const helper = drawer.getByTestId('add-market-help')
      await page.goBack()
      await expect.poll(() => hashOf(page)).not.toContain('am.help=chatbot')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await page.goForward()
      await expect.poll(() => hashOf(page)).toContain('am.help=chatbot')
      await expect(helper.getByTestId('hf-chatbot')).toBeVisible()
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
