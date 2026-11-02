import { expect, test, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { leaveFirstRun } from './first-run-helpers'
import { onboardThroughBridge } from './onboarded'
import { sidebarLink } from './nav-helpers'

/**
 * Check now is the queue screen (`#/check`), not the page's First check step.
 * The page is clicked through the production shell. The test does not call IPC.
 * Numbers match src/main/pipeline/textbolt.integration.test.ts: score 56, 11 searches.
 */

const ROOT = process.cwd()
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const ACCOUNT_FIXTURE = path.join(ROOT, 'src/main/providers/fixtures/serpapi/account-ok.json')
const JINA_FIXTURE = path.join(ROOT, 'src/main/pipeline/fixtures/textbolt-jina.json')
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const PROMPTS = [
  'How can I send text alerts to my employees without hiring a developer or learning a new app?',
  'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
  'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
  "My email-to-text through txt.att.net stopped working. What's the best replacement for business alerts?",
  'Verizon is shutting down vtext.com. What should a small business switch to so our automated alerts keep reaching phones?',
  "What's the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?",
  'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
  "What's a cheap alternative to Twilio for sending business text alerts if we don't have developers?",
  "How do I send a text to my field techs early Saturday morning when I'm writing the update Friday afternoon?",
  'Can employees reply to an automated business text alert and have the reply come back to my email?'
]
const TEXTBOLT_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const SERP_KEY = 'serp-fixture-key-textbolt'

test('Check now runs a prompt set and leaves a page with no prompts unqueued', async () => {
  test.setTimeout(300_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-first-check-'))
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log'),
      // The page is due at the 08:00 default check time. A zone where it is
      // midday now keeps "Check now" from waiting hours for that slot.
      TZ: middayZone()
    }
  })

  try {
    await installFixtureFetch(app, PROMPTS)
    await onboard(page)
    await addAndRead(page)

    await test.step('a page with no prompts is not queued', async () => {
      await openCheckNow(page)
      await expect(page.getByText('0 pages due', { exact: true })).toBeVisible()
      await expect(page.getByText('1 page due', { exact: true })).toHaveCount(0)
      // Nothing due: Check now is disabled with the reason, never "Check started for 0 pages".
      await expect(page.getByRole('button', { name: 'Check due pages now' })).toBeDisabled()
      await expect(page.getByText(/Nothing is due right now/)).toBeVisible()
      await expect(page.getByRole('link', { name: 'Choose pages in All pages' })).toBeVisible()
      await expect(page.getByText(/Check started for/)).toHaveCount(0)
      await openAllPages(page)
      await expect(
        page.getByRole('meter', { name: /^0( · no cap| of [\d,]+) searches used this month$/ })
      ).toBeVisible()
    })

    let pageId = ''
    await test.step('setup writes the buyer profile and the prompt set', async () => {
      // The runner is off in this launch; Start setup runs this page now (owner feedback 5).
      await page.locator('a.page-title').click()
      await page.getByRole('tab', { name: 'Questions', exact: true }).click()
      const setup = page.getByRole('region', { name: 'Setting up this page' })
      await setup.getByRole('button', { name: 'Start setup' }).click()
      const grid = page.getByRole('grid', { name: 'Buyer questions' })
      await expect(grid.locator('.ui-lg-row')).toHaveCount(10, { timeout: 90_000 })
      await expect(page.getByText(PROMPTS[0] ?? '')).toBeVisible()
      pageId = await page.evaluate(() => window.location.hash.split('/')[2] ?? '')
    })

    await test.step('the first check waits for the user, then records results and usage', async () => {
      await openCheckNow(page)
      // Set up, but no search until Start first check.
      await expect(page.getByText('0 pages due', { exact: true })).toBeVisible()
      await page.evaluate((id) => {
        window.location.hash = `#/pages/${id}/results`
      }, pageId)
      await page.getByRole('button', { name: /^Start first check · / }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Check finished' })).toBeVisible({
        timeout: 180_000
      })
      await page.reload()
      await openAllPages(page)
      await expect(
        page.getByRole('meter', { name: /^11( · no cap| of [\d,]+) searches used this month$/ })
      ).toBeVisible()
      // The score cell is a drill button named for the page; its visible text is the score.
      await expect(
        page.getByRole('grid', { name: 'Pages' }).getByRole('button', { name: /^Score 56 for / })
      ).toHaveText('56')
      await page.evaluate((id) => {
        window.location.hash = `#/pages/${id}/results`
      }, pageId)
      const results = page.locator('#m3-results-top')
      // Scoped: the report headline also says "of your 10 buyer prompts".
      await expect(results.locator('.m3-scope').getByText(/10 buyer questions?/)).toBeVisible()
      await expect(results.getByRole('button', { name: /^Visibility score \d/ })).toContainText(
        '56'
      )
      await expect(
        page.getByRole('grid', { name: /Buyer questions from the/ }).locator('.ui-lg-row')
      ).toHaveCount(10)
      await expect(page.getByText(PROMPTS[0] ?? '')).toBeVisible()
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

/** Already onboarded (no setup wizard): the real handlers save the profile and the key. */
async function onboard(page: Page): Promise<void> {
  await onboardThroughBridge(page, {
    profile: {
      brandNames: ['TextBolt', 'Text Bolt'],
      competitors: ['simpletexting.com', 'twilio.com']
    },
    serpKey: SERP_KEY,
    cap: 250,
    jinaMode: 'always'
  })
  await leaveFirstRun(page)
}

async function addAndRead(page: Page): Promise<void> {
  await page.getByLabel('Page URL').fill(TEXTBOLT_URL)
  await page.getByRole('button', { name: 'Add page' }).click()
  await expect(page).toHaveURL(/\/prompts$/)
  await expect(page.getByRole('region', { name: 'Setting up this page' })).toBeVisible()
}

async function openCheckNow(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/check'
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Check now' })).toBeVisible()
}

async function openAllPages(page: Page): Promise<void> {
  await (await sidebarLink(page, 'Your site', /^Pages/)).click()
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible()
}

async function installFixtureFetch(
  app: Awaited<ReturnType<typeof launchCiteFox>>['app'],
  prompts: readonly string[]
): Promise<void> {
  const serp: Record<string, { status: number; body: string }> = {}
  for (const name of readdirSync(FIXTURE_DIR)) {
    if (!name.startsWith('serp-')) continue
    const file = JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) as {
      status: number
      body: unknown
    }
    serp[name] = { status: file.status, body: JSON.stringify(file.body) }
  }
  const account = JSON.parse(readFileSync(ACCOUNT_FIXTURE, 'utf8')) as {
    status: number
    body: unknown
  }
  await app.evaluate(
    async (
      _electron,
      config: {
        jinaBody: string
        accountStatus: number
        accountBody: string
        serp: Record<string, { status: number; body: string }>
        prompts: readonly string[]
      }
    ) => {
      const original = globalThis.fetch.bind(globalThis)
      const respond = (status: number, body: string): Response =>
        new Response(body, { status, headers: { 'content-type': 'application/json' } })
      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('https://r.jina.ai/')) return respond(200, config.jinaBody)
        if (url.startsWith('https://serpapi.com/account')) {
          return respond(config.accountStatus, config.accountBody)
        }
        if (url.startsWith('https://serpapi.com/')) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          const parsed = new URL(url)
          let name: string | null = null
          if (parsed.searchParams.get('engine') === 'google_ai_overview') name = 'serp-01-aio.json'
          else {
            const query = parsed.searchParams.get('q') ?? ''
            const index = config.prompts.indexOf(query)
            if (index === 0) name = 'serp-01-token.json'
            else if (index > 0) name = `serp-${String(index + 1).padStart(2, '0')}.json`
          }
          const file = name === null ? undefined : config.serp[name]
          if (file === undefined) return respond(500, JSON.stringify({ error: 'no serp fixture' }))
          return respond(file.status, file.body)
        }
        return original(input, init)
      }
    },
    {
      jinaBody: readFileSync(JINA_FIXTURE, 'utf8'),
      accountStatus: account.status,
      accountBody: JSON.stringify(account.body),
      serp,
      prompts
    }
  )
}

/** An `Etc/GMT` zone where the local time is about noon right now (offsets -11 to +12). */
function middayZone(): string {
  const offset = 12 - new Date().getUTCHours()
  if (offset === 0) return 'UTC'
  // Etc/GMT names invert the sign: Etc/GMT-5 is five hours ahead of UTC.
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`
}
