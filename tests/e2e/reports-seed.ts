import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuyerPrompt, IntentStage, Market, PageSummary } from '@shared/domain'
import { createIpcHandlers, type IpcHandlerDeps } from '../../src/main/handlers'
import type { EngineHost } from '../../src/main/engine/host'
import { contentHash } from '../../src/main/pipeline/hash'
import type { HttpResponse } from '../../src/main/providers/http'
import { createLogger } from '../../src/main/logging/logger'
import { MemorySecretStore } from '../../src/main/secrets/secret-store'
import { openAppStorage } from '../../src/main/storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot
} from '../../src/main/storage/content-records'
import { insertEngineAnswer, saveEngineSettings } from '../../src/main/storage/engine-records'
import { createFixFollowUp } from '../../src/main/storage/fix-follow-ups'
import {
  insertIndexCheck,
  putPageAiText,
  setLoopOwner
} from '../../src/main/storage/fix-loop-records'
import { insertPageChange } from '../../src/main/storage/page-history'
import { addPageMarket, insertPage } from '../../src/main/storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../src/main/storage/project-files'
import { insertMarket, writeProjectProfile } from '../../src/main/storage/project-profile'
import {
  insertApiKey,
  insertProject,
  writeActiveProjectId,
  writeOnboardingFinished
} from '../../src/main/storage/records'
import { projectDatabaseRelativePath } from '../../src/main/storage/slug'

/**
 * The ready reports' rich project (no live calls, no AI): TextBolt with four tracked
 * pages and 44 questions over five funnel stages, checked three times (Sep 21, Oct 5,
 * Oct 19) through the real check handler against made-up AI Overviews, plus stored
 * ChatGPT and Perplexity answers in the last two checks. It has:
 * - a new page (Outlook) that starts getting cited,
 * - a rewrite (Alerts) that lost ground after Oct 10, with the page change on file,
 * - a rewrite (Pricing) still not cited after 14+ days, and two new pages Google has
 *   not indexed (one too new to judge),
 * - competitors moving (SimpleTexting fades, ClickSend and TextMagic rise),
 * - answers that grow lists, steps and tables, and a second market (UK).
 */

const CHECKS = ['2026-09-21T12:00:00.000Z', '2026-10-05T12:00:00.000Z', '2026-10-19T12:00:00.000Z']
const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const SITE = 'https://textbolt.com'
const FEATURES = `${SITE}/features`

export const REPORTS_SEED = {
  projectId: 'proj-1',
  us: 'mkt-us',
  uk: 'mkt-uk',
  alertsUrl: `${SITE}/blog/how-to-set-up-text-alerts-for-business/`,
  outlookUrl: `${SITE}/email-to-sms-outlook`,
  pricingUrl: `${SITE}/pricing`,
  schoolsUrl: `${SITE}/textbolt-for-schools`,
  guideUrl: `${SITE}/pricing-guide`
} as const

const US: Market = {
  id: REPORTS_SEED.us,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: REPORTS_SEED.uk, country: 'UK' }

type Outcome = 'target' | 'own' | 'rival' | 'none'

interface SeedPage {
  id: string
  label: string
  url: string
  title: string
  questions: readonly string[]
  /** Outcome per question per check. */
  plan: (q: number, check: number) => Outcome
  markets: readonly string[]
}

const STAGES: readonly IntentStage[] = ['problem', 'solution', 'comparison', 'objection', 'trigger']

const PAGES: readonly SeedPage[] = [
  {
    id: 'page-alerts',
    label: 'Alerts',
    url: REPORTS_SEED.alertsUrl,
    title: 'How to set up text alerts for business',
    markets: [REPORTS_SEED.us, REPORTS_SEED.uk],
    questions: [
      'How do I alert my crew by text without a developer?',
      'What is the easiest way to send text alerts to staff?',
      'Can I send SMS alerts from email?',
      'How do schools send emergency text alerts?',
      'Best way to text field teams about schedule changes',
      'How do I set up text alerts for my business?',
      'Can office managers send group texts from Outlook?',
      'Which text alert service works with Gmail?',
      'How much do business text alerts cost?',
      'Are text alerts better than push notifications for staff?',
      'How fast do SMS alerts arrive?'
    ],
    plan: (q, check) => {
      if (q <= 1) return 'target'
      if (q <= 6) {
        if (check < 2) return 'target'
        if (q <= 3) return 'own'
        if (q <= 5) return 'rival'
        return 'none'
      }
      if (q === 9) return check === 0 ? 'none' : 'rival'
      if (q === 10) return check === 2 ? 'target' : 'rival'
      return 'rival'
    }
  },
  {
    id: 'page-pricing',
    label: 'Pricing',
    url: REPORTS_SEED.pricingUrl,
    title: 'Pricing | TextBolt',
    markets: [REPORTS_SEED.us],
    questions: [
      'How much does an email to SMS service cost?',
      'Cheapest bulk SMS plan for small business',
      'Is there a free email to text service?',
      'TextBolt vs SimpleTexting pricing',
      'What does Twilio charge per text?',
      'Pay as you go SMS plans for nonprofits',
      'Do SMS plans charge for replies?',
      'Monthly SMS plan with scheduled texts',
      'Which business texting tool has no setup fee?',
      'How many texts do I need for 50 employees?',
      'SMS pricing for schools'
    ],
    plan: (q, check) => (q <= 2 && check === 0 ? 'none' : 'rival')
  },
  {
    id: 'page-outlook',
    label: 'Outlook',
    url: REPORTS_SEED.outlookUrl,
    title: 'Email to SMS from Outlook',
    markets: [REPORTS_SEED.us, REPORTS_SEED.uk],
    questions: [
      'How do I send a text message from Outlook?',
      'Outlook email to SMS add-in',
      'Can Outlook send texts to phone numbers?',
      'Send SMS from Microsoft 365 without an add-in',
      'How to text a customer from Outlook',
      'Email to SMS gateway for Outlook users',
      'Reply to texts in Outlook',
      'Outlook SMS for healthcare reminders',
      'Bulk SMS from an Outlook contact group',
      'Does Outlook have built-in texting?',
      'Outlook to SMS for real estate agents'
    ],
    plan: (q, check) => {
      if (q <= 3) return check === 0 ? 'rival' : 'target'
      if (q <= 7) return check === 2 ? 'target' : 'rival'
      if (q === 8) return check === 0 ? 'none' : check === 1 ? 'rival' : 'target'
      return 'rival'
    }
  },
  {
    id: 'page-integrations',
    label: 'Integrations',
    url: `${SITE}/integrations`,
    title: 'Integrations',
    markets: [REPORTS_SEED.us],
    questions: [
      'Which SMS tools integrate with Slack?',
      'Send texts from Google Sheets',
      'Zapier email to SMS automation',
      'SMS integration for HubSpot',
      'Connect a CRM to business texting',
      'Text alerts from a monitoring tool',
      'Can I trigger SMS from a webhook?',
      'Send SMS from Salesforce without code',
      'Business texting API for small teams',
      'SMS from Microsoft Teams',
      'Integrate texting with a school information system'
    ],
    plan: (q, check) => {
      if (q <= 1) return 'own'
      if (q <= 5) return 'rival'
      if (check === 0) return 'none'
      if (q <= 7 && check === 2) return 'target'
      return 'rival'
    }
  }
]

/** Competitor sites per check: SimpleTexting fades, ClickSend and TextMagic rise. */
const RIVALS: readonly (readonly [string, string][])[] = [
  [
    ['https://simpletexting.com/blog/text-employees/', 'SimpleTexting'],
    ['https://www.twilio.com/en-us/blog/employee-sms-notifications', 'Twilio'],
    ['https://www.reddit.com/r/smallbusiness/comments/sms_tools/', 'Reddit']
  ],
  [
    ['https://www.twilio.com/en-us/blog/employee-sms-notifications', 'Twilio'],
    ['https://www.clicksend.com/us/sms/email-to-sms/', 'ClickSend'],
    ['https://simpletexting.com/blog/text-employees/', 'SimpleTexting']
  ],
  [
    ['https://www.clicksend.com/us/sms/email-to-sms/', 'ClickSend'],
    ['https://www.textmagic.com/email-to-sms/', 'TextMagic'],
    ['https://www.twilio.com/en-us/blog/employee-sms-notifications', 'Twilio'],
    ['https://www.youtube.com/watch?v=sms-alerts', 'YouTube']
  ]
]

let currentCheck = 0

interface Found {
  page: SeedPage
  q: number
}

const BY_TEXT = new Map<string, Found>()
for (const page of PAGES) {
  page.questions.forEach((text, q) => {
    BY_TEXT.set(text.toLowerCase(), { page, q })
    BY_TEXT.set(`${text} (UK)`.toLowerCase(), { page, q })
  })
}

function overviewBody(found: Found | undefined, check: number): unknown {
  const outcome = found ? found.page.plan(found.q, check) : 'rival'
  const q = found?.q ?? 0
  const rivals = RIVALS[check] ?? RIVALS[0]!
  const references: { title: string; link: string; source: string; index: number }[] = []
  const position = 1 + ((q + check) % 4)
  const push = (link: string, source: string, title: string): void => {
    references.push({ title, link, source, index: references.length })
  }
  rivals.slice(0, Math.max(0, position - 1)).forEach(([link, source]) => push(link, source, source))
  if (outcome === 'target' && found) push(found.page.url, 'TextBolt', found.page.title)
  if (outcome === 'own') push(FEATURES, 'TextBolt', 'Features')
  rivals.slice(Math.max(0, position - 1)).forEach(([link, source]) => push(link, source, source))
  const named = outcome === 'target' || outcome === 'own'
  const blocks: unknown[] = [
    {
      type: 'paragraph',
      snippet: `${named ? 'TextBolt and other tools' : 'Several tools'} turn email into text messages for teams. Pick one that works with the email you already use and lets people reply.`
    }
  ]
  if (check >= 1 && q % 3 !== 1) {
    blocks.push({
      type: 'paragraph',
      snippet:
        'Most teams start with email to SMS because nobody has to install an app or learn a new tool. You write an email to a special address, and every person on the list gets a text a few seconds later. Replies come back to the same inbox, so the thread stays in one place. Look for scheduled sends, contact groups and a clear price per text. Check that the service supports your country, keeps an opt-out list for you and shows delivery reports. Schools, clinics and field crews use the same setup for reminders, closures and shift changes, and most services offer a free trial so you can test with your own team first before you pay for a monthly plan.'
    })
  }
  if (check >= 1 && q % 2 === 0) {
    blocks.push({
      type: 'list',
      list: [
        { title: 'Email to SMS', snippet: 'Send from your inbox.' },
        { title: 'Scheduled texts', snippet: 'Plan alerts ahead.' },
        { title: 'Two-way replies', snippet: 'Answers come back by email.' }
      ]
    })
  }
  if (check === 2 && q % 3 === 0) {
    blocks.push({
      type: 'list',
      list: [
        { snippet: '1. Sign up and verify your number.' },
        { snippet: '2. Add your contacts.' },
        { snippet: '3. Send a test text.' }
      ]
    })
  }
  if (check === 2 && q % 4 === 1) {
    blocks.push({
      type: 'table',
      table: [
        ['Tool', 'Starts at', 'Email to SMS'],
        ['TextBolt', '$19', 'Yes'],
        ['ClickSend', '$25', 'Yes']
      ]
    })
  }
  return {
    search_metadata: { status: 'Success', id: `seed-${check}-${q}` },
    ai_overview: { text_blocks: blocks, references }
  }
}

function fixture(name: string): { status: number; body: Record<string, unknown> } {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: Record<string, unknown>
  }
}

function search(query: string): HttpResponse {
  const found = BY_TEXT.get(query.toLowerCase())
  if (found && found.page.plan(found.q, currentCheck) === 'none') {
    const empty = fixture('google-no-aio.json')
    return { status: empty.status, body: JSON.stringify(empty.body) }
  }
  const parsed = fixture('google-page-token-extras.json')
  ;(parsed.body.ai_overview as { page_token: string }).page_token = query
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function seedPage(page: SeedPage, index: number): PageSummary {
  return {
    id: page.id,
    projectId: REPORTS_SEED.projectId,
    url: page.url,
    title: page.title,
    label: page.label,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: page.questions.length,
    defaultMarketId: REPORTS_SEED.us,
    pinned: index === 0,
    score: null,
    promptSetVersion: null
  }
}

function prompts(page: SeedPage): BuyerPrompt[] {
  return page.questions.map((text, q) => ({
    id: `${page.id}-q${q}`,
    position: q + 1,
    label: text.slice(0, 40),
    source: 'title_meta_h1',
    intentStage: STAGES[q % STAGES.length] ?? 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [
      { marketId: REPORTS_SEED.us, language: 'en', text, originalText: null },
      { marketId: REPORTS_SEED.uk, language: 'en', text: `${text} (UK)`, originalText: null }
    ]
  }))
}

function snapshot(
  id: string,
  pageId: string,
  at: string,
  body: string,
  title: string
): Parameters<typeof insertSnapshot>[1] {
  return {
    id,
    pageId,
    fetchedAt: at,
    method: 'jina' as const,
    httpStatus: 200,
    durationMs: 4,
    title,
    metaDescription: null,
    h1: title,
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 2,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    contentHash: contentHash(body),
    summary: null
  }
}

const DAY = 86_400_000

export async function seedReportsProject(userDataDir: string): Promise<void> {
  const storage = openAppStorage(userDataDir)
  const db = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  let host: EngineHost | undefined
  try {
    insertProject(storage.db, {
      id: REPORTS_SEED.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    writeProjectProfile(db, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: ['simpletexting.com', 'twilio.com', 'clicksend.com', 'textmagic.com'],
      market: US
    })
    insertMarket(db, UK)
    PAGES.forEach((page, index) => {
      insertPage(db, seedPage(page, index))
      for (const marketId of page.markets) {
        addPageMarket(db, { pageId: page.id, marketId, addedAt: CHECKS[0]!, baselineRunId: null })
      }
      const body = `${page.title}. TextBolt turns email into text messages for teams.`
      insertSnapshot(db, snapshot(`snap-${page.id}`, page.id, CHECKS[0]!, body, page.title))
      insertBuyerProfile(db, {
        id: `icp-${page.id}`,
        pageId: page.id,
        snapshotId: `snap-${page.id}`,
        who: 'Office managers and team leads.',
        environment: 'They live in email.',
        segments: [],
        triggers: [],
        values: [],
        poorFit: [],
        templateId: 'tpl-buyer-profile',
        templateName: 'Buyer profile',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        createdAt: CHECKS[0]!,
        promptsStale: false
      })
      insertPromptSet(
        db,
        {
          id: `pset-${page.id}`,
          pageId: page.id,
          version: 1,
          savedAt: CHECKS[0]!,
          icpId: `icp-${page.id}`,
          templateId: 'tpl-buyer-prompts',
          templateName: 'CiteFox default',
          templateHash: contentHash('template'),
          templateUpdatedAt: null,
          prompts: prompts(page)
        },
        ['TextBolt']
      )
    })
    const secret = 'fixture-serpapi-secret-reports'
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'My plan',
      keychainRef: 'citefox.serpapi.reports-key-1',
      hint: 'ab12',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: { used: 40, planLimit: 2500, plan: 'Developer' }
    })
    const secrets = new MemorySecretStore()
    secrets.set('citefox.serpapi.reports-key-1', secret)
    let clock = Date.parse(CHECKS[0]!)
    let sequence = 0
    const handlers = createIpcHandlers({
      appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
      storage,
      secrets,
      logger: createLogger({ write: () => undefined, secrets: () => [secret] }),
      http: {
        async request(request) {
          const url = new URL(request.url)
          if (url.searchParams.get('engine') === 'google') {
            return search(url.searchParams.get('q') ?? '')
          }
          const token = url.searchParams.get('page_token') ?? ''
          return {
            status: 200,
            body: JSON.stringify(overviewBody(BY_TEXT.get(token.toLowerCase()), currentCheck))
          }
        }
      },
      claudeCommand: {
        async run() {
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null }
        }
      },
      claudeProbe: { exists: () => false, searchPath: () => null },
      emitCheckupProgress: () => undefined,
      emit: () => undefined,
      knownSecrets: () => [secret],
      now: () => new Date(clock),
      createId: () => {
        sequence += 1
        clock += 1000
        return `seed-${sequence}`
      },
      onHost: (opened) => {
        host = opened
      }
    } satisfies IpcHandlerDeps)
    for (const [index, at] of CHECKS.entries()) {
      currentCheck = index
      clock = Date.parse(at)
      const job = await handlers['checks:start']({
        projectId: REPORTS_SEED.projectId,
        pageIds: PAGES.map((page) => page.id) as [string, ...string[]],
        marketIds: null,
        promptIds: null
      })
      if (job.status !== 'finished') {
        throw new Error(job.message ?? `Seed check ended as ${job.status}`)
      }
    }
    seedEngines(db)
    seedChanges(db)
    writeOnboardingFinished(storage.db, true)
    writeActiveProjectId(storage.db, REPORTS_SEED.projectId)
  } finally {
    host?.email.close()
    closeProjectDatabase(db)
    storage.close()
  }
}

type Db = ReturnType<typeof createProjectDatabase>

/** ChatGPT and Perplexity answers to every US question in the last two checks. */
function seedEngines(db: Db): void {
  saveEngineSettings(
    db,
    { engines: ['google_aio', 'chatgpt', 'perplexity'], provider: 'cloro' },
    CHECKS[2]!
  )
  let sequence = 0
  const id = (prefix: string): string => {
    sequence += 1
    return `${prefix}-${sequence}`
  }
  for (const page of PAGES) {
    const runs = db
      .prepare<[string, string], { id: string; finished_at: string }>(
        `SELECT id, finished_at FROM runs WHERE page_id = ? AND market_id = ? ORDER BY started_at`
      )
      .all(page.id, REPORTS_SEED.us)
    runs.slice(1).forEach((run, offset) => {
      const check = offset + 1
      page.questions.forEach((_, q) => {
        const google = page.plan(q, check)
        for (const engine of ['chatgpt', 'perplexity'] as const) {
          const cites =
            engine === 'chatgpt'
              ? google === 'target' && q % 3 !== 2
              : (google === 'target' && q % 2 === 0) || (check === 2 && q === 9)
          const none = engine === 'perplexity' && google === 'none'
          const markdown = none
            ? null
            : [
                cites
                  ? 'TextBolt sends texts from your email, and replies come back to your inbox.'
                  : 'ClickSend and Twilio both turn email into SMS.',
                '',
                ...(q % 2 === 0 ? ['- Works with Outlook and Gmail', '- Scheduled texts', ''] : []),
                ...(engine === 'chatgpt' && check === 2 && q % 3 === 0
                  ? ['1. Sign up', '2. Verify your number', '3. Send a test', '']
                  : []),
                ...(engine === 'perplexity' && q % 5 === 0
                  ? [
                      '| Tool | Price |',
                      '| --- | --- |',
                      '| TextBolt | $19 |',
                      '| ClickSend | $25 |'
                    ]
                  : [])
              ].join('\n')
          insertEngineAnswer(db, {
            id: id('ans'),
            runId: run.id,
            promptId: `${page.id}-q${q}`,
            sampleNo: 1,
            engine,
            keyId: null,
            status: none ? 'no_answer' : cites ? 'cited' : 'not_cited',
            citedUrl: cites ? page.url : null,
            position: cites ? 1 + (q % 3) : null,
            named: cites,
            answerText: markdown,
            answerMarkdown: markdown,
            errorCode: null,
            message: null,
            searches: 1,
            credits: 7,
            costMicros: 5_600,
            rawJson: null,
            checkedAt: run.finished_at,
            sources: none
              ? []
              : [
                  ...(cites
                    ? [
                        {
                          url: page.url,
                          domain: 'textbolt.com',
                          title: page.title,
                          kind: 'target' as const
                        }
                      ]
                    : []),
                  {
                    url: 'https://www.clicksend.com/us/sms/email-to-sms/',
                    domain: 'clicksend.com',
                    title: 'ClickSend',
                    kind: 'competitor' as const
                  },
                  {
                    url: 'https://www.twilio.com/docs/sms',
                    domain: 'twilio.com',
                    title: 'Twilio',
                    kind: 'competitor' as const
                  }
                ].map((source, index) => ({
                  id: id('src'),
                  position: index + 1,
                  url: source.url,
                  normalizedUrl: source.url,
                  domain: source.domain,
                  title: source.title,
                  classification: source.kind
                }))
          })
        }
      })
    })
  }
}

/** Logged changes, index checks, an anchor, an owner and the Alerts page change. */
function seedChanges(db: Db): void {
  const ids = (page: SeedPage): string[] => page.questions.map((_, q) => `${page.id}-q${q}`)
  const [alerts, pricing, outlook] = PAGES as [SeedPage, SeedPage, SeedPage, SeedPage]
  const now = Date.now()
  createFixFollowUp(db, {
    id: 'fix-outlook',
    pageId: outlook.id,
    description: 'New page: email to SMS from Outlook',
    goLiveAt: '2026-09-28T00:00:00.000Z',
    rule: 'after_7_days',
    promptIds: ids(outlook),
    marketIds: [REPORTS_SEED.us],
    kind: 'new_page'
  })
  createFixFollowUp(db, {
    id: 'fix-pricing',
    pageId: pricing.id,
    description: 'Rewrote the pricing page with a plan table',
    goLiveAt: '2026-09-10T00:00:00.000Z',
    rule: 'after_7_days',
    promptIds: ids(pricing),
    marketIds: [REPORTS_SEED.us],
    kind: 'rewrite'
  })
  createFixFollowUp(db, {
    id: 'fix-alerts',
    pageId: alerts.id,
    description: 'Shortened the alerts guide and removed the Who uses it section',
    goLiveAt: '2026-10-10T00:00:00.000Z',
    rule: 'after_7_days',
    promptIds: ids(alerts),
    marketIds: [REPORTS_SEED.us],
    kind: 'rewrite'
  })
  // Two new pages found on the site but not tracked: their changes and index checks are theirs.
  for (const [id, url, title] of [
    ['page-guide', REPORTS_SEED.guideUrl, 'SMS pricing guide'],
    ['page-schools', REPORTS_SEED.schoolsUrl, 'TextBolt for schools']
  ] as const) {
    insertPage(db, {
      ...seedPage(pricing, 1),
      id,
      url,
      title,
      label: null,
      status: 'not_tracked',
      promptCount: 5,
      pinned: false
    })
    addPageMarket(db, {
      pageId: id,
      marketId: REPORTS_SEED.us,
      addedAt: CHECKS[0]!,
      baselineRunId: null
    })
  }
  createFixFollowUp(db, {
    id: 'fix-guide',
    pageId: 'page-guide',
    description: 'New page: SMS pricing guide',
    goLiveAt: '2026-10-01T00:00:00.000Z',
    rule: 'after_7_days',
    promptIds: ids(pricing).slice(0, 4),
    marketIds: [REPORTS_SEED.us],
    kind: 'new_page'
  })
  createFixFollowUp(db, {
    id: 'fix-schools',
    pageId: 'page-schools',
    description: 'New page: TextBolt for schools',
    goLiveAt: new Date(now - 5 * DAY).toISOString(),
    rule: 'after_7_days',
    promptIds: ids(alerts).slice(0, 4),
    marketIds: [REPORTS_SEED.us],
    kind: 'new_page'
  })
  const index = (id: string, pageId: string, url: string, state: 'indexed' | 'not_indexed'): void =>
    insertIndexCheck(db, {
      id,
      pageId,
      url,
      state,
      checkedAt: new Date(now - DAY).toISOString(),
      searches: 1,
      message: null
    })
  index('idx-outlook', outlook.id, outlook.url, 'indexed')
  index('idx-alerts', alerts.id, alerts.url, 'indexed')
  index('idx-pricing', pricing.id, pricing.url, 'indexed')
  index('idx-guide', 'page-guide', REPORTS_SEED.guideUrl, 'not_indexed')
  index('idx-schools', 'page-schools', REPORTS_SEED.schoolsUrl, 'not_indexed')
  putPageAiText(db, {
    pageId: pricing.id,
    kind: 'anchor',
    inputKey: 'seed',
    text: 'email to SMS pricing',
    edited: false,
    savedAt: CHECKS[2]!
  })
  setLoopOwner(db, 'publish', 'Dana (web team)')
  const before = [
    '# How to set up text alerts for business',
    'TextBolt sends text alerts from email. No developer required.',
    '## How it works',
    'Write an email to your alert address and TextBolt texts everyone on the list.',
    '## Who uses it',
    'Office managers, school offices and field teams use it for daily alerts.',
    '## Questions',
    'Does it work with Gmail? Yes, and with Outlook.'
  ].join('\n\n')
  const after = [
    '# Text alerts for business',
    'TextBolt sends text alerts from email.',
    '## Setup',
    'Write an email to your alert address.',
    '## Questions',
    'Does it work with Gmail? Yes.'
  ].join('\n\n')
  insertSnapshot(
    db,
    snapshot('snap-alerts-a', alerts.id, '2026-10-06T09:00:00.000Z', before, alerts.title)
  )
  insertSnapshot(
    db,
    snapshot(
      'snap-alerts-b',
      alerts.id,
      '2026-10-11T09:00:00.000Z',
      after,
      'Text alerts for business'
    )
  )
  insertPageChange(db, {
    id: 'chg-alerts',
    pageId: alerts.id,
    fromSnapshotId: 'snap-alerts-a',
    toSnapshotId: 'snap-alerts-b',
    detectedAt: '2026-10-11T09:00:00.000Z',
    changedAt: '2026-10-10T08:00:00.000Z',
    modifiedAt: null,
    previousModifiedAt: null,
    counts: { sectionsAdded: 0, sectionsRemoved: 1, headingsChanged: 2, textChanged: 3 },
    sections: ['Who uses it', 'How it works', 'Questions'],
    dismissedAt: null
  })
}
