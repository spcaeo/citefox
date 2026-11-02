import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CiteFoxApi, FillFromWebsiteResult } from '../../src/shared/ipc'
import { e2eArtifact } from './artifacts'
import { animationsDone } from './drawer-helpers'
import { installFixtureFetch, waitForChecksIdle } from './journey-app'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'
import { expectSetupStep, expectTopicLanding, setupEngines, setupShapes } from './setup-walk'

/**
 * New project → "How should we set up …?" (HelpFill.dc.html panel 4) on the
 * real handlers: Read my website fills the Fill card (`projects:fillFromWebsite`
 * is stubbed in main, so no site is read and no Claude call runs); Use my own
 * ChatGPT shows the one five-section prompt for the typed site, copies it, opens
 * the chatbot, reads a pasted answer into the found cards, the Fill card and the
 * questions plan; Create project saves the ticked questions as topics. The
 * clipboard and `shell.openExternal` are stubbed. Screenshots at 1440 × 900 and
 * 1134 × 770 in both themes go to test-results/e2e/helpfill-setup-*.png.
 *
 * Onboarding v2 step 3 offers the same ChatGPT way when Claude is not set up:
 * the pasted answer fills steps 4 to 8 (products, buyers, competitors, questions),
 * and "Finish and run the first check" saves the kept questions as the first topic and
 * opens it. Without Claude, step 8 writes nothing on its own.
 */

const SERP_KEY = 'serp-fixture-key-helpfill'
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }

/** What the stubbed website read returns. */
const WEBSITE: FillFromWebsiteResult = {
  domain: 'harbortext.example',
  pagesRead: [{ url: 'https://harbortext.example/', role: 'home', ok: true }],
  summary: 'Harbor Text sends texts from email for small offices.',
  products: [
    {
      id: 'p1',
      name: 'Email to SMS',
      job: 'Send texts from any email client.',
      buyer: 'Office managers at small firms.',
      evidence: { path: '/', quote: 'Text from your inbox' },
      searchNote: null
    }
  ],
  brands: [{ id: 'b1', name: 'Harbor Text', reason: 'The name in the site header.' }],
  competitors: [],
  switchingFrom: [],
  integrations: [],
  suggestedMarket: { country: 'US', language: 'en', location: null, reason: 'Prices in USD.' },
  message: 'Suggestions are ready. Nothing was saved.',
  nextStep: null
}

/** A ChatGPT answer: chatter, five sections in mixed shapes, the site itself, a repeat and a brand row. */
const ANSWER = `Sure! I visited harbortext.example. Here is the setup:

### PRODUCTS
\`\`\`csv
name,url,job
Email to SMS,https://harbortext.example/email-to-text/,Send texts from any email client
Text alerts,/alerts/,Alert a crew by text when a system emails
\`\`\`

### BUYERS
who,problem,trigger,product
Office managers at small firms,Staff miss urgent emails,A carrier gateway shut down,Email to SMS
IT and ops teams,Monitoring alerts go unseen at night,An outage nobody saw,Text alerts

### COMPETITORS
| name | domain | competes_with |
| --- | --- | --- |
| Twilio | twilio.com | Text alerts |
| SimpleTexting | simpletexting.com | Email to SMS |
| Harbor Text | harbortext.example | Email to SMS |

### MARKETS
country,language,city
US,en,
CA,en,

### QUESTIONS
question,stage,product
"My carrier stopped email to text, what can I use now?",Problem,Email to SMS
"My carrier stopped email to text, what can I use now",Problem,Email to SMS
Can a small office text staff from Outlook without an app?,Options,Email to SMS
How do I text the night shift when a freezer alarm emails?,Problem,Text alerts
Is Harbor Text cheaper than Twilio for alerts?,Compare,Text alerts

Let me know if you want more!`

interface Launched {
  app: ElectronApplication
  page: Page
  dir: string
}

async function launch(): Promise<Launched> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-helpfill-setup-'))
  await seedTwoMarketProject(dir)
  // A `claude` on the PATH that is never called: the setup prompt and read need no Claude.
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, '#!/bin/sh\nexit 1\n')
  await chmod(claude, 0o755)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: WIDE,
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }
  })
  await openAllPages(page)
  await stubOutside(app, page)
  return { app, page, dir }
}

/** The website read, `shell.openExternal` and the clipboard only record what they were given. */
async function stubOutside(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ ipcMain, shell }, website) => {
    const opened: string[] = []
    const g = globalThis as { __opened?: string[]; __fills?: number }
    g.__opened = opened
    g.__fills = 0
    shell.openExternal = (async (url: string) => {
      opened.push(url)
    }) as typeof shell.openExternal
    ipcMain.removeHandler('projects:fillFromWebsite')
    ipcMain.handle('projects:fillFromWebsite', async () => {
      g.__fills = (g.__fills ?? 0) + 1
      return website
    })
  }, WEBSITE)
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

/** Both sizes and both themes, with no sideways scroll anywhere on the page. */
async function shots(page: Page, name: string, focus: Locator): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size)
      await animationsDone(page)
      await focus.evaluate((node) => node.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(200)
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement
        const main = document.querySelector('#main')
        const inner = [...document.querySelectorAll<HTMLElement>('#main *')]
          .filter((el) => {
            const x = getComputedStyle(el).overflowX
            return (x === 'auto' || x === 'scroll') && el.scrollWidth - el.clientWidth > 1
          })
          .map((el) => el.className || el.tagName)
        return {
          page: root.scrollWidth - root.clientWidth,
          main: main === null ? 0 : main.scrollWidth - main.clientWidth,
          inner
        }
      })
      expect(overflow.page, `${name} ${size.width} ${scheme}: window`).toBeLessThanOrEqual(0)
      expect(overflow.main, `${name} ${size.width} ${scheme}: main`).toBeLessThanOrEqual(0)
      expect(overflow.inner, `${name} ${size.width} ${scheme}: inside`).toEqual([])
      await page.screenshot({
        path: await e2eArtifact(`helpfill-setup-${name}-${size.width}-${scheme}.png`)
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

test('New project: Read my website, Use my own ChatGPT, and the questions saved on Create', async () => {
  test.setTimeout(300_000)
  const { app, page, dir } = await launch()
  const form = page.getByRole('form', { name: 'New project' })
  const helper = form.getByTestId('su')
  try {
    await test.step('three ways; Claude is set up, so it opens on Read my website', async () => {
      await openHash(page, '#/projects/new')
      await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible()
      await expect(
        helper.getByRole('heading', { name: 'How should we set up your site?' })
      ).toBeVisible()
      await expect(helper.getByRole('radio', { name: /Read my website/u })).toBeChecked()
      await expect(helper.getByText('Up to 5 AI calls · on your AI plan')).toBeVisible()
      await expect(helper.getByRole('radio', { name: /Use my own ChatGPT/u })).not.toBeChecked()
      await expect(helper.getByRole('radio', { name: /I’ll fill it in/u })).not.toBeChecked()
    })

    await test.step('Read my website fills the Fill card', async () => {
      await form.getByLabel('Project name').fill('Harbor Text')
      await form.getByLabel('Website domain').fill('harbortext.example')
      await form.getByLabel('Brand names').fill('Harbor Text')
      await expect(
        helper.getByRole('heading', { name: 'How should we set up harbortext.example?' })
      ).toBeVisible()
      await helper.getByRole('button', { name: 'Read my website' }).click()
      const card = form.getByRole('region', { name: 'Suggestions from the website' })
      await expect(card).toContainText('Harbor Text sends texts from email')
      await expect(card).toContainText('reads your site')
      expect(await app.evaluate(() => (globalThis as { __fills?: number }).__fills ?? 0)).toBe(1)
      await shots(page, 'website', helper)
    })

    await test.step('Use my own ChatGPT: the five-section prompt for the typed site, Copy and Open', async () => {
      await pick(helper.getByRole('radio', { name: /Use my own ChatGPT/u }))
      await expect.poll(() => hashOf(page)).toContain('help=chatbot')
      const prompt = helper.getByTestId('hf-prompt')
      await expect(prompt).toContainText(
        'You help set up AI-search tracking for harbortext.example.'
      )
      await expect(prompt).toContainText('### QUESTIONS')
      await expect(prompt).toContainText('Never name Harbor Text.')
      const text = (await prompt.textContent()) ?? ''
      for (const block of ['PRODUCTS', 'BUYERS', 'COMPETITORS', 'MARKETS', 'QUESTIONS']) {
        expect(text).toContain(`### ${block}`)
      }
      expect(text).not.toMatch(/@|\/Users\/|sk-ant-|not given|none saved|Already tracked/u)

      await helper.getByTestId('hf-copy-prompt').click()
      await expect(helper.getByTestId('hf-copy-prompt')).toHaveAccessibleName('Copied')
      expect((await copied(page)).at(-1)).toContain('### PRODUCTS')

      await pick(helper.getByRole('radio', { name: 'Perplexity', exact: true }))
      await expect.poll(() => hashOf(page)).toContain('bot=perplexity')
      await helper.getByRole('button', { name: 'Open Perplexity' }).click()
      await expect.poll(async () => (await opened(app)).at(-1) ?? '').toMatch(/perplexity\.ai/u)
      await shots(page, 'chatbot', helper.getByTestId('hf-prompt'))
    })

    await test.step('paste the answer back: found cards, the Fill card and the questions plan', async () => {
      await helper.getByLabel('Paste its answer below').fill(ANSWER)
      await helper.getByRole('button', { name: 'Read the answer' }).click()
      const summary = helper.getByTestId('su-summary')
      await expect(summary).toHaveText(
        'Read your answer. Here’s what we found; open any card to review it. 1 repeat was merged. 1 named Harbor Text and was set aside.'
      )
      const count = (id: string): Locator =>
        helper.getByTestId(`su-found-${id}`).locator('.su-card-count')
      await expect(count('products')).toHaveText('2')
      await expect(count('buyers')).toHaveText('2')
      await expect(count('competitors')).toHaveText('2')
      await expect(count('markets')).toHaveText('2')
      await expect(helper.getByTestId('su-found-markets')).toContainText('Markets: US, CA')
      await expect(count('questions')).toHaveText('3')
      await expect(count('topics')).toHaveText('2')

      const card = form.getByRole('region', { name: 'Suggestions from the website' })
      await expect(card).toContainText('from your chatbot’s answer')
      await helper.getByTestId('su-found-buyers').click()
      await expect.poll(() => hashOf(page)).toContain('fill=buyers')
      await expect(card.getByRole('list', { name: 'Buyer types' })).toContainText(
        'IT and ops teams'
      )
      await shots(page, 'read', summary)

      const plan = helper.getByTestId('su-plan')
      await plan
        .getByRole('checkbox', {
          name: 'Can a small office text staff from Outlook without an app?'
        })
        .uncheck()
      await expect(plan).toContainText('2 ticked in 2 topics')
      await shots(page, 'plan', plan)
    })

    await test.step('Back returns to Read my website; Forward to the chatbot way', async () => {
      const back = async (): Promise<void> => {
        await page.goBack()
      }
      // Leave the fill tab entry, then step back over the chatbot way.
      while ((await hashOf(page)).includes('help=chatbot')) await back()
      await expect(helper.getByRole('radio', { name: /Read my website/u })).toBeChecked()
      await page.goForward()
      await expect.poll(() => hashOf(page)).toContain('help=chatbot')
      await expect(helper.getByTestId('hf-chatbot')).toBeVisible()
    })

    await test.step('Create project saves the ticked questions as topics', async () => {
      await form.getByRole('button', { name: 'Create project' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
      ).toBeVisible()
      const topics = await page.evaluate(async () => {
        const api = (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox
        const list = await api['projects:list']()
        const project = list.projects.find((item) => item.domain === 'harbortext.example')
        if (!project) return null
        const found = await api['topics:list']({ projectId: project.id })
        return found.topics.map((topic) => ({ name: topic.name, questions: topic.questions }))
      })
      // The unticked question stays out: one question each.
      expect([...(topics ?? [])].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: 'Email to SMS', questions: 1 },
        { name: 'Text alerts', questions: 1 }
      ])
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Onboarding step 3: your own ChatGPT fills the steps, and Finish saves the kept questions', async () => {
  test.setTimeout(300_000)
  installRawMarkdown()
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-helpfill-onboarding-'))
  // No `claude` on the PATH: step 2 finds none and step 3 offers the ChatGPT way.
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: WIDE
  })
  try {
    await stubOutside(app, page)
    // The SerpApi key test and Finish's first check answer from recorded fixtures.
    await installFixtureFetch(app, [])
    await test.step('step 2 finds no Claude; step 3 picks Use my own ChatGPT', async () => {
      await page.getByRole('button', { name: 'Get started' }).click()
      await page.getByLabel(/Your website/).fill('harbortext.example')
      await page.getByLabel(/Where are your buyers/).selectOption('US')
      await page.getByLabel(/^Language/).selectOption('en')
      await page.getByLabel(/Your name/).fill('Rakesh')
      await page.getByRole('button', { name: 'Continue' }).click()
      await expectSetupStep(page, 'claude')
      await page
        .getByRole('button', { name: 'Skip and use your own ChatGPT instead' })
        .click({ timeout: 30_000 })
      await expectSetupStep(page, 'read')
      await expect(page.getByRole('radio', { name: /Read my website/u })).toBeDisabled()
      await expect(page.getByRole('radio', { name: /Use my own ChatGPT/u })).toBeChecked()
    })

    const chatbot = page.getByTestId('hf-chatbot')
    await test.step('Get the prompt: the five-section prompt for the typed site, Copy, paste the answer', async () => {
      await page.getByRole('button', { name: 'Get the prompt' }).click()
      await expect.poll(() => hashOf(page)).toContain('paste=1')
      const prompt = chatbot.getByTestId('hf-prompt')
      await expect(prompt).toContainText(
        'You help set up AI-search tracking for harbortext.example.'
      )
      const text = (await prompt.textContent()) ?? ''
      for (const block of ['PRODUCTS', 'BUYERS', 'COMPETITORS', 'MARKETS', 'QUESTIONS']) {
        expect(text).toContain(`### ${block}`)
      }
      await chatbot.getByTestId('hf-copy-prompt').click()
      expect((await copied(page)).at(-1)).toContain('### PRODUCTS')
      await chatbot.getByLabel('Paste its answer below').fill(ANSWER)
      await shots(page, 'onboarding-chatbot', prompt)
      await chatbot.getByRole('button', { name: 'Read the answer' }).click()
      await expectSetupStep(page, 'brand')
    })

    await test.step('steps 4 to 6 hold the answer’s products, buyers and competitors', async () => {
      const products = page.getByTestId('section-products')
      await expect(products.getByRole('checkbox', { name: 'Keep Email to SMS' })).toBeChecked()
      await expect(products.getByRole('checkbox', { name: 'Keep Text alerts' })).toBeChecked()
      // The answer has no summary or brand row: the person types them.
      const summary = page.getByTestId('section-summary')
      await summary.getByRole('button', { name: 'Edit' }).click()
      await summary
        .getByRole('textbox')
        .fill('Harbor Text sends texts from email for small offices.')
      await summary.getByRole('button', { name: 'Save' }).click()
      const brands = page.getByTestId('section-brands')
      await brands.getByRole('button', { name: '+ Add' }).click()
      await brands.getByLabel('Add a name').fill('Harbor Text')
      await brands.getByLabel('Add a name').press('Enter')
      await expect(brands.getByRole('button', { name: 'Remove Harbor Text' })).toBeVisible()
      await page.getByRole('button', { name: 'Looks right, continue' }).click()

      await expectSetupStep(page, 'buyers')
      await expect(page.getByTestId('section-buyers')).toContainText('IT and ops teams')
      await page.getByRole('button', { name: 'Continue' }).click()

      await expectSetupStep(page, 'competitors')
      const competitors = page.getByTestId('section-competitors')
      await expect(competitors).toContainText('twilio.com')
      await expect(competitors).toContainText('simpletexting.com')
      await page.getByRole('button', { name: 'Continue' }).click()
      await setupEngines(page, { serpKey: SERP_KEY })
      // Step 8 with no Claude: the mix is kept, and step 9 shows the answer's questions.
      await setupShapes(page, { serpKey: SERP_KEY })
    })

    await test.step('step 9: the answer’s questions, one unticked, a typed topic, then Finish', async () => {
      const questions = page.getByTestId('section-questions')
      // The repeat was merged. Step 3 does not know the brand yet, so the question that
      // names Harbor Text is not set aside as on New project; the person unticks it.
      await expect(questions.getByRole('checkbox', { name: /^Keep / })).toHaveCount(4)
      for (const question of [
        'Can a small office text staff from Outlook without an app?',
        'Is Harbor Text cheaper than Twilio for alerts?'
      ]) {
        await questions.getByRole('checkbox', { name: `Keep ${question}` }).uncheck()
      }
      const topic = page.getByTestId('section-topic')
      await topic.getByRole('button', { name: 'Edit Topic' }).click()
      await topic.getByRole('textbox').fill('Texting staff from email')
      await topic.getByRole('button', { name: 'Save' }).click()
      await expect(page.locator('.ui-wizard-note')).toContainText(/First check: 2 prompts × /)
      await shots(page, 'onboarding-questions', questions)
      await page.getByRole('button', { name: 'Finish and run the first check' }).click()
      // Finish opens the new topic, its first check running.
      await expectTopicLanding(page, 'Texting staff from email')
      await waitForChecksIdle(page)
      const topics = await page.evaluate(async () => {
        const api = (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox
        const list = await api['projects:list']()
        const project = list.projects.find((item) => item.domain === 'harbortext.example')
        if (!project) return null
        const found = await api['topics:list']({ projectId: project.id })
        return found.topics.map((topic) => ({ name: topic.name, questions: topic.questions }))
      })
      // The unticked question stays out.
      expect(topics).toEqual([{ name: 'Texting staff from email', questions: 2 }])
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
