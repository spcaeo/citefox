import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { expectTopicLanding, FIRST_TOPIC, walkSetup, type SetupWalkOptions } from './setup-walk'

/**
 * The production shell on the recorded TextBolt fixtures: Claude is the shim on
 * PATH, Jina and SerpApi answer from fixtures inside the main process, and the
 * keychain is the test Secret Service. Nothing reaches the network.
 */

const ROOT = process.cwd()
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const ACCOUNT_FIXTURE = path.join(ROOT, 'src/main/providers/fixtures/serpapi/account-ok.json')
const JINA_FIXTURE = path.join(ROOT, 'src/main/pipeline/fixtures/textbolt-jina.json')
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')

/** Same ten questions as TEXTBOLT_PROMPTS_EN in src/main/pipeline/textbolt-fixture.ts. */
export const TEXTBOLT_PROMPTS = [
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
export const TEXTBOLT_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const SERP_KEY = 'serp-fixture-key-textbolt'

export interface JourneyApp {
  app: ElectronApplication
  page: Page
  /** SerpApi searches the main process made (the account call is not a search). */
  searches: () => Promise<number>
  close: () => Promise<void>
}

/**
 * Launches the app with the shim and fixtures. `setupRunner` keeps the
 * background setup runner on (launch.ts turns it off for seeded specs).
 */
export async function launchJourneyApp(
  prefix: string,
  options: {
    setupRunner?: boolean
    shimDelayMs?: number
    /** Slows only the named Claude calls: `"<first line>=<ms>;…"` (CITEFOX_SHIM_SLOW). */
    shimSlow?: string
  } = {}
): Promise<JourneyApp> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
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
      // Onboarding's "Read my website" reads fixed TextBolt pages, never the network.
      CITEFOX_E2E_TOPICS: '1',
      ...(options.setupRunner ? { CITEFOX_SETUP_RUNNER: undefined } : {}),
      ...(options.shimDelayMs ? { CITEFOX_SHIM_DELAY_MS: String(options.shimDelayMs) } : {}),
      ...(options.shimSlow ? { CITEFOX_SHIM_SLOW: options.shimSlow } : {})
    }
  })
  await installFixtureFetch(app, TEXTBOLT_PROMPTS)
  return {
    app,
    page,
    searches: () =>
      app.evaluate(() => {
        const store = globalThis as unknown as { __citefoxSearches?: number }
        return store.__citefoxSearches ?? 0
      }),
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/**
 * First-run onboarding v2 for the TextBolt project through the real eight steps
 * (tests/e2e/setup-walk.ts): the read and every ✦ answer come from the Claude shim,
 * the SerpApi key test from the account fixture. Step 6 keeps simpletexting.com and
 * twilio.com among the competitors; step 8 keeps one of the questions Claude wrote on
 * arrival, so Finish's first check makes one search. Finish opens the new topic; waits
 * there until that check is done (the page specs that follow start their own checks).
 */
export async function onboardTextBolt(
  page: Page,
  options: Partial<SetupWalkOptions> = {}
): Promise<void> {
  await walkSetup(page, {
    serpKey: SERP_KEY,
    competitors: ['simpletexting.com', 'twilio.com'],
    keepQuestions: 1,
    ...options
  })
  await expectTopicLanding(page, FIRST_TOPIC)
  await waitForChecksIdle(page)
}

/** Polls `checks:listActive` until no check is queued or running in any project. */
export async function waitForChecksIdle(page: Page, timeout = 120_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const bridge = (
            window as unknown as {
              citefox: {
                'checks:listActive': (request: { projectId: null }) => Promise<readonly unknown[]>
              }
            }
          ).citefox
          return (await bridge['checks:listActive']({ projectId: null })).length
        }),
      { timeout }
    )
    .toBe(0)
}

export async function installFixtureFetch(
  app: ElectronApplication,
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
      const store = globalThis as unknown as { __citefoxSearches?: number }
      store.__citefoxSearches = 0
      const original = globalThis.fetch.bind(globalThis)
      const respond = (status: number, body: string): Response =>
        new Response(body, { status, headers: { 'content-type': 'application/json' } })
      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('https://r.jina.ai/')) {
          // A little time per read, so the live setup steps are visible.
          await new Promise((resolve) => setTimeout(resolve, 1500))
          return respond(200, config.jinaBody)
        }
        if (url.startsWith('https://serpapi.com/account')) {
          return respond(config.accountStatus, config.accountBody)
        }
        if (url.startsWith('https://serpapi.com/')) {
          store.__citefoxSearches = (store.__citefoxSearches ?? 0) + 1
          await new Promise((resolve) => setTimeout(resolve, 200))
          const parsed = new URL(url)
          let name: string
          if (parsed.searchParams.get('engine') === 'google_ai_overview') name = 'serp-01-aio.json'
          else {
            const query = parsed.searchParams.get('q') ?? ''
            const index = config.prompts.indexOf(query)
            if (index === 0) name = 'serp-01-token.json'
            else if (index > 0) name = `serp-${String(index + 1).padStart(2, '0')}.json`
            // Any other question (onboarding's first check) gets one recorded answer.
            else name = 'serp-02.json'
          }
          const file = config.serp[name]
          if (file === undefined) {
            return respond(500, JSON.stringify({ error: 'no serp fixture', url }))
          }
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
