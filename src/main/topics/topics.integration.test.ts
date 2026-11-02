import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { CheckJob } from '@shared/ipc'
import type { TopicDraft, TopicProgressPoint } from '@shared/domain'
import type { CheckEngine } from '../engine/checks/engine'
import type { CheckRequest } from '../engine/checks/prepare'
import { cleanupHarness, harness } from '../handlers/test-harness'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../providers/claude/claude-code'
import {
  finishStoredCheckJob,
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult
} from '../storage/check-records'
import { addPageMarket, getPage, insertPage } from '../storage/pages'
import { readPageProductRow, replaceProductCatalog } from '../storage/products'
import {
  closeProjectDatabase,
  createProjectDatabase,
  openProjectDatabase
} from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { insertSnapshot } from '../storage/snapshot-records'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { OLD_FORMAT_NOTICE } from './claude'
import { staticTopicReplies, topicFixtureReply } from './fixture-replies'
import { planSchedule } from '../scheduler/due'
import { readStoredCheckCatalog, recordStoredCheck } from '../headless/storage-pass'
import { seedTextboltTopic } from './fixture-seed'
import { textboltTopicResults } from '@shared/fixtures/textbolt-topic'
import { normalizeUrl } from '../engine/checks/url'

afterEach(cleanupHarness)

const NOW = '2026-10-19T12:00:00.000Z'
const OFFICIAL_DOMAINS = JSON.parse(
  readFileSync(join(process.cwd(), 'src/main/assist/fixtures/company.officialDomains.json'), 'utf8')
) as unknown
const PRODUCT_COMPETITORS = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src/main/assist/fixtures/project.productCompetitors.json'),
    'utf8'
  )
) as unknown
const HASH = 'a'.repeat(64)

/** A project's own body from before P3: one call wrote every stage. */
const LEGACY_COUNTS_LINE = 'Write exactly these counts per journey stage:'
const LEGACY_JOURNEY_BODY = `Template: topic_journey_questions.md
You are writing buyer journey questions for a topic.
Topic (the buyer's problem): {{ seed }}
${LEGACY_COUNTS_LINE} {{ counts }}
Each question is 15 to 32 words, in full sentences.`
const legacyPrompts: string[] = []

/** A project's own seed body from before P2: seven jobs in one call. */
const LEGACY_SEED_LINE =
  'Also list competitors, switch-from options, integrations and an about line.'
const LEGACY_SEED_BODY = `Template: topic_seed_discover.md
Suggest topic seeds for {{ brand }} from the website below.
${LEGACY_SEED_LINE}
{{ website_text }}`
/** What that body returns: seeds without a product or evidence, and the other jobs. */
const LEGACY_SEED_REPLY = {
  seeds: [{ text: 'Email to SMS', caution: null }],
  segments: [],
  competitors: [{ name: 'SimpleTexting', domain: 'simpletexting.com' }],
  about: 'TextBolt sends texts from email.'
}

/** What an older body returns: the questions of all six stages in one reply. */
function allStageJourneyReply(): { questions: unknown[] } {
  const replies = staticTopicReplies()
  return {
    questions: Object.entries(replies)
      .filter(([key]) => key.startsWith('topic_journey_questions.'))
      .flatMap(([, reply]) => (reply as { questions: unknown[] }).questions)
  }
}

function fakeClaude(calls: string[]): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request: ClaudeCompletionRequest) {
      calls.push(request.prompt.split('\n', 1)[0] ?? '')
      // The small official-domain follow-up (batch 2 row 3) answers from its assist fixture.
      // Batch 2 row 5: the topic's competitor question (web search) answers from its fixture.
      // A project's own older journey body (all six stages per call) gets every stage back.
      const legacy = request.prompt.includes(LEGACY_COUNTS_LINE)
      if (legacy) legacyPrompts.push(request.prompt)
      const json = request.prompt.includes(LEGACY_SEED_LINE)
        ? LEGACY_SEED_REPLY
        : request.prompt.startsWith('Assist: company.officialDomains')
          ? OFFICIAL_DOMAINS
          : request.prompt.startsWith('Assist: project.productCompetitors')
            ? PRODUCT_COMPETITORS
            : legacy
              ? allStageJourneyReply()
              : topicFixtureReply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 10,
        outputTokens: 10,
        durationMs: 5,
        model: 'claude-sonnet-5-5',
        resolvedModel: 'claude-sonnet-5-5',
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0
        }
      } as Awaited<ReturnType<ClaudeProvider['complete']>>
    }
  }
}

function fakeChecks(started: CheckRequest[]): CheckEngine {
  const job = (request: CheckRequest): CheckJob =>
    ({
      id: `job-${started.length}`,
      projectId: request.projectId,
      status: 'running',
      message: null,
      nextStep: null
    }) as unknown as CheckJob
  return {
    start: async (request: CheckRequest) => {
      started.push(request)
      return job(request)
    }
  } as unknown as CheckEngine
}

const SITE: Record<string, string> = {
  'https://textbolt.com/':
    '# Email to text for business\n## Send alerts from Gmail\n## How it works\nTextBolt turns emails into texts.',
  'https://textbolt.com/pricing': '# Pricing\n## Plans from $29\nPlans for small teams.',
  'https://textbolt.com/features':
    '# Features\n## Works with monitoring tools that send email\nWIN-911 alarm software sends its alarms through TextBolt as texts.',
  'https://www.simpletexting.com/sms-alerts-for-business/':
    '# Send SMS alerts your team actually reads\n## What are SMS alerts?\n## Types of business alerts you can send\n## Send alerts from email and other tools\n## Delivery reports\n## Integrations\nSend urgent alerts with [SimpleTexting](https://simpletexting.com).',
  'https://textbolt.com/faq':
    '# FAQ\n## What happens when a carrier gateway shuts down?\nAT&T shut down its email-to-text gateway in 2025, and Verizon is retiring vtext.com.\n## How is TextBolt different from Text-Em-All or SimpleTexting?\nCompare: Text-Em-All sells call and text credits ([text-em-all.com](https://www.text-em-all.com)); SimpleTexting is a marketing texting app.'
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup() {
  const claudeCalls: string[] = []
  const started: CheckRequest[] = []
  const reads: string[] = []
  const h = harness({
    claude: fakeClaude(claudeCalls),
    checkEngine: fakeChecks(started),
    // Fake DNS: every competitor domain resolves.
    pageDns: { lookup: async () => ['93.184.216.34'] },
    readWebsitePage: async (url: string) => {
      reads.push(url)
      const text = SITE[url]
      return text === undefined ? null : { title: 'TextBolt', text }
    }
  })
  insertProject(h.storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(h.storage.paths.projectsDirectory, 'textbolt')
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt', 'Text Bolt'],
    competitors: ['simpletexting.com', 'twilio.com'],
    market: {
      id: 'mkt-us',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  insertPage(db, {
    id: 'page-setup',
    projectId: 'proj-1',
    url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    title: 'How to set up text alerts',
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  addPageMarket(db, { pageId: 'page-setup', marketId: 'mkt-us', addedAt: NOW, baselineRunId: null })
  insertSnapshot(db, {
    id: 'snap-setup',
    pageId: 'page-setup',
    fetchedAt: NOW,
    method: 'direct',
    httpStatus: 200,
    durationMs: 5,
    title: 'How to set up text alerts for business',
    metaDescription: null,
    h1: 'Text alerts',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [{ level: 'h2', text: 'Send from Gmail', table: false }],
    faqs: [],
    h2Count: 1,
    h3Count: 0,
    tableCount: 0,
    bodyText: 'Set up text alerts from Gmail.',
    wordCount: 6,
    contentHash: HASH,
    summary: null
  })
  closeProjectDatabase(db)
  return { ...h, claudeCalls, started, reads }
}

describe('topics service (seed path, fake Claude, no searches)', () => {
  test('with a saved catalog, discover ties each seed to a product and asks no web search', async () => {
    const { handlers, claudeCalls, storage } = setup()
    const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    replaceProductCatalog(db, {
      products: [
        {
          id: 'prod-email',
          name: 'Email to SMS gateway',
          job: 'monitoring alerts and email turned into texts',
          buyer: 'IT teams without a developer',
          evidencePath: '/features/email-to-sms/'
        },
        {
          id: 'prod-inbox',
          name: 'Business texting inbox',
          job: 'two-way texting with customers from a shared number',
          buyer: 'clinics and offices',
          evidencePath: null
        }
      ],
      competitors: [
        {
          name: 'Notifyre',
          domain: 'notifyre.com',
          productId: 'prod-email',
          tier: 'direct',
          startingPrice: '$9/mo',
          sources: [{ url: 'https://notifyre.com/pricing', biased: false }]
        },
        {
          name: 'Podium',
          domain: 'podium.com',
          productId: 'prod-inbox',
          tier: 'direct',
          startingPrice: null,
          sources: []
        }
      ]
    })
    closeProjectDatabase(db)
    const draft = await handlers['topics:createDraft']({
      projectId: 'proj-1',
      path: 'seed',
      seed: 'Monitoring alerts that never reach on-call phones'
    })
    const discovered = await handlers['topics:discoverSeed']({
      projectId: 'proj-1',
      draftId: draft.id
    })
    expect(claudeCalls).toContain('Template: topic_seed_discover.md')
    expect(claudeCalls).not.toContain('Assist: project.productCompetitors')
    const ids = new Set(['prod-email', 'prod-inbox'])
    expect(
      discovered.seeds.every((seed) => seed.productId === null || ids.has(seed.productId))
    ).toBe(true)
    expect(discovered.seeds[0]?.productId).toBe('prod-email')
    // The typed seed is about the email product: its saved competitors, not the inbox's.
    expect(discovered.competitors.map((item) => [item.name, item.tier, item.product])).toEqual([
      ['Notifyre', 'direct', 'prod-email']
    ])
    expect(discovered.products?.map((item) => item.id)).toEqual(['prod-email', 'prod-inbox'])
    expect(discovered.about).toContain('textbolt.com sells Email to SMS gateway')
  })

  test('an old saved seed body falls back to the built-in one, with a notice', async () => {
    const { handlers, claudeCalls } = setup()
    await handlers['templates:saveOverride']({
      projectId: 'proj-1',
      kind: 'topic_seed_discover',
      body: LEGACY_SEED_BODY,
      settings: { model: null, language: null, promptCount: null, tone: null }
    })
    const draft = await handlers['topics:createDraft']({
      projectId: 'proj-1',
      path: 'seed',
      seed: 'Monitoring alerts that never reach on-call phones'
    })
    const discovered = await handlers['topics:discoverSeed']({
      projectId: 'proj-1',
      draftId: draft.id
    })
    // The old body is asked twice (the reply check retries once), then the shipped body once.
    expect(claudeCalls.filter((line) => line === 'Template: topic_seed_discover.md')).toHaveLength(
      3
    )
    expect(discovered.seeds.length).toBeGreaterThan(0)
    expect(discovered.seeds.every((seed) => seed.text !== 'Email to SMS')).toBe(true)
    expect(discovered.info?.notice).toBe(OLD_FORMAT_NOTICE)
  })

  test('a seed draft runs every wizard step and starts a topic with a first check', async () => {
    const { handlers, claudeCalls, started, reads, storage } = setup()
    const base = { projectId: 'proj-1' }
    let draft: TopicDraft = await handlers['topics:createDraft']({
      ...base,
      path: 'seed',
      seed: 'Text alerts for teams without a developer'
    })
    expect(draft.brandNames).toEqual(['TextBolt', 'Text Bolt'])
    expect(draft.marketIds).toEqual(['mkt-us'])
    const ids = { ...base, draftId: draft.id }

    const discovered = await handlers['topics:discoverSeed'](ids)
    expect(discovered.seeds.length).toBeGreaterThan(0)
    // Batch 2 row 5: the topic's own competitor question (web search), tiers kept apart;
    // with no products saved yet, it runs for a product built from the seed.
    expect(
      discovered.competitors.map((item) => [item.name, item.domain, item.domainSource, item.tier])
    ).toEqual([
      ['TXTImpact', 'txtimpact.com', 'search', 'direct'],
      ['Notifyre', 'notifyre.com', 'search', 'direct'],
      ['Textmagic', 'textmagic.com', 'search', 'direct'],
      ['ClickSend', 'clicksend.com', 'search', 'direct'],
      ['SimpleTexting', 'simpletexting.com', 'search', 'partial'],
      ['Twilio', 'twilio.com', 'search', 'partial']
    ])
    expect(discovered.products?.[0]?.job).toBe('Text alerts for teams without a developer')
    expect(
      discovered.competitors.every((item) => item.product === discovered.products?.[0]?.id)
    ).toBe(true)
    // P2: switch-from options and integrations are the project's saved notes (none
    // here), never asked again; with no products saved, no seed has a product.
    expect(discovered.switchingFrom).toEqual([])
    expect(discovered.integrations).toEqual([])
    expect(discovered.seeds.every((seed) => seed.productId === null)).toBe(true)
    expect(reads).toContain('https://textbolt.com/')
    // A second discover reuses the cached site reads.
    const readCount = reads.length
    await handlers['topics:discoverSeed'](ids)
    expect(reads.length).toBe(readCount)

    await handlers['topics:updateDraft']({
      ...ids,
      patch: { generate: 'both', segments: ['Clinics'] }
    })
    draft = await handlers['topics:writeProfile'](ids)
    expect(draft.profile?.current).toBe(1)
    expect(draft.profile?.versions[0]?.points.length).toBeGreaterThan(6)

    const fill = await handlers['topics:discoverProfileSection']({
      ...ids,
      section: null,
      action: 'discover'
    })
    // The fixture repeats one point already in the profile; code leaves it out.
    expect(fill.suggestions.map((item) => item.text)).toEqual(['MSP owners routing client alerts'])
    expect(fill.toVerify).toBe(0)
    // foundIn is checked against the evidence: /use-cases could not be read, so it is null.
    expect(fill.suggestions[0]?.foundIn).toBeNull()
    // Applying suggestions makes version 2; switching back keeps both.
    draft = await handlers['topics:updateDraft']({
      ...ids,
      patch: {
        profile: {
          note: 'filled_gaps',
          points: [...(draft.profile?.versions[0]?.points ?? []), ...fill.suggestions].map(
            (point) => ({
              section: point.section,
              text: point.text,
              foundIn: point.foundIn,
              verify: point.verify
            })
          )
        }
      }
    })
    expect(draft.profile?.versions).toHaveLength(2)
    // Only the one suggestion is new.
    expect(draft.profile?.versions[1]?.points.filter((point) => point.isNew)).toHaveLength(1)

    draft = await handlers['topics:generateQuestions'](ids)
    const questions = draft.prompts.filter((prompt) => prompt.kind === 'question')
    expect(questions.length).toBeGreaterThanOrEqual(25)
    expect(questions.every((prompt) => prompt.stage !== null)).toBe(true)
    // Standard depth caps each stage.
    expect(questions.filter((prompt) => prompt.stage === 'problem').length).toBeLessThanOrEqual(
      draft.depth.questions.perStage.problem
    )

    // One call per stage (Docs/PROMPT-AUDIT.md, P3 item 3). The fit and compare fixtures
    // hold 4 of the 5 questions asked, so those two stages ask once more, naming the gap,
    // then make one top-up call for the question still missing (no retry of its own).
    expect(
      claudeCalls.filter((line) => line === 'Template: topic_journey_questions.md')
    ).toHaveLength(10)
    const written = questions.map((prompt) => `${prompt.stage}:${prompt.text}`).sort()

    // A project's own older journey body writes every stage in each call: each
    // single-stage call keeps only its own stage, so the result is the same.
    await handlers['templates:saveOverride']({
      projectId: 'proj-1',
      kind: 'topic_journey_questions',
      body: LEGACY_JOURNEY_BODY,
      settings: { model: null, language: null, promptCount: null, tone: null }
    })
    draft = await handlers['topics:generateQuestions'](ids)
    expect(legacyPrompts.length).toBeGreaterThanOrEqual(6)
    expect(legacyPrompts.some((prompt) => prompt.includes(`${LEGACY_COUNTS_LINE} fit: `))).toBe(
      true
    )
    expect(
      draft.prompts
        .filter((prompt) => prompt.kind === 'question')
        .map((prompt) => `${prompt.stage}:${prompt.text}`)
        .sort()
    ).toEqual(written)
    await handlers['templates:resetOverride']({
      projectId: 'proj-1',
      kind: 'topic_journey_questions'
    })

    const before = claudeCalls.length
    const gaps = await handlers['topics:findJourneyGaps'](ids)
    expect(gaps.gaps).toHaveLength(2)
    expect(gaps.headline).toMatch(/^2 gaps/u)
    // One call finds the gaps; one discover call per stage with a gap writes its question.
    expect(claudeCalls.length - before).toBe(3)
    expect(gaps.suggestions.map((item) => item.stage).sort()).toEqual(['decide', 'fit'])

    const terms = await handlers['topics:discoverTerms'](ids)
    draft = await handlers['topics:updateDraft']({ ...ids, patch: { keywordTerms: terms.terms } })
    const keywords = await handlers['topics:generateKeywords'](ids)
    expect(keywords.fromPatterns).toBeGreaterThan(0)
    expect(keywords.fromClaude).toBeGreaterThan(0)
    expect(keywords.summary.keywords).toBeLessThanOrEqual(draft.depth.keywords.maxKeywords)
    expect(keywords.draft.prompts.some((prompt) => /textbolt/iu.test(prompt.text))).toBe(false)
    // P4: the vs groups come from their own call and each names a listed competitor;
    // no other group names one.
    expect(claudeCalls).toContain('Template: topic_keyword_competitor.md')
    // P4 follow-up: coverage uses the patterns from the core-terms step, never "ai … software".
    expect(terms.patterns).toContain('{X} service')
    const coverage = keywords.draft.prompts.filter((prompt) => prompt.kwGroupKind === 'coverage')
    expect(coverage.some((prompt) => prompt.text.endsWith(' service'))).toBe(true)
    expect(coverage.some((prompt) => /\bai\b|automated|ai-powered/u.test(prompt.text))).toBe(false)
    const named = (text: string): boolean => /simpletexting|twilio/u.test(text)
    const vs = keywords.draft.prompts.filter(
      (prompt) => prompt.kwFamily === 'alternatives_vs' || prompt.kwFamily === 'competitor_vs'
    )
    expect(vs.length).toBeGreaterThan(0)
    expect(vs.every((prompt) => named(prompt.text))).toBe(true)
    expect(
      keywords.draft.prompts
        .filter((prompt) => prompt.kind === 'keyword' && !vs.includes(prompt))
        .some((prompt) => named(prompt.text))
    ).toBe(false)

    const merge = await handlers['topics:mergeNearDuplicates']({ ...ids, apply: false })
    expect(Array.isArray(merge.pairs)).toBe(true)

    const matched = await handlers['topics:matchPages'](ids)
    expect(matched.matched + matched.noPage).toBeGreaterThan(0)
    draft = matched.draft
    const firstQuestion = draft.prompts.find((prompt) => prompt.kind === 'question')
    if (firstQuestion === undefined) throw new Error('no question')
    const set = await handlers['topics:setTarget']({
      ...base,
      draftId: draft.id,
      promptIds: [firstQuestion.id],
      target: { pageId: 'page-setup', url: null }
    })
    expect(set.draft?.prompts.find((prompt) => prompt.id === firstQuestion.id)?.matchStatus).toBe(
      'confirmed'
    )

    const estimate = await handlers['topics:estimate'](ids)
    expect(estimate.prompts).toBe(estimate.questions + estimate.keywords)
    expect(estimate.searchesHi).toBe(estimate.searchesLo * 2)
    expect(estimate.plans.map((plan) => plan.plan)).toEqual([
      'likeliest',
      'stage_first',
      'stagger',
      'all_now'
    ])
    expect(estimate.plans.filter((plan) => plan.suggested)).toHaveLength(1)

    // Prompt audit PC: the product picked on the Seed step is pinned on the topic.
    await handlers['products:save']({
      projectId: 'proj-1',
      products: [
        { id: 'prod-gw', name: 'Email-to-SMS gateway', job: 'SMS from email', buyer: 'IT' }
      ],
      competitors: []
    })
    const picked = await handlers['topics:updateDraft']({
      ...ids,
      patch: { product: { mode: 'pick', productId: 'prod-gw' } }
    })
    expect(picked.productId).toBe('prod-gw')

    const result = await handlers['topics:start']({ ...ids, plan: 'stagger' })
    expect(result.jobId).toMatch(/^job-/u)
    expect(started[0]?.jobId).toBe(result.jobId)
    expect(result.batches.length).toBeGreaterThan(0)
    expect(started[0]?.pageIds).toEqual([result.topicId])
    expect(started[0]?.promptIds).toHaveLength(10)

    const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    const page = getPage(db, result.topicId, 'proj-1')
    expect(page?.kind).toBe('topic')
    expect(readPageProductRow(db, result.topicId)).toMatchObject({
      productId: 'prod-gw',
      pinned: true
    })
    expect(page?.url).toBeNull()
    closeProjectDatabase(db)

    // The rest waits as daily batches in the check catalog; the due planner makes
    // each one a due item once its day comes (window and --check-due alike).
    const { catalog } = readStoredCheckCatalog(storage)
    expect(catalog.topicBatches).toHaveLength(result.batches.length)
    const later = Date.parse(NOW) + 3 * 24 * 60 * 60 * 1000
    const plan = planSchedule(catalog, later, 'UTC')
    const batchItems = plan.due.pages.filter((item) => item.topicBatchId !== undefined)
    // Start ran only what it asked for: no full interval check of the topic, at
    // launch (now) or on the following days, until one interval has passed.
    const fullChecks = (at: number): number =>
      planSchedule(readStoredCheckCatalog(storage).catalog, at, 'UTC').due.pages.filter(
        (item) => item.pageId === result.topicId && item.topicBatchId === undefined
      ).length
    expect(fullChecks(Date.parse(NOW))).toBe(0)
    expect(fullChecks(later)).toBe(0)
    expect(fullChecks(Date.parse(NOW) + 15 * 24 * 60 * 60 * 1000)).toBe(1)
    expect(batchItems.length).toBeGreaterThanOrEqual(2)
    expect(
      batchItems.every((item) => (item.promptIds?.length ?? 0) > 0 && item.reason === 'scheduled')
    ).toBe(true)
    // A batch whose check succeeded is recorded and leaves the catalog.
    const first = batchItems[0]
    if (first === undefined || first.topicBatchId === undefined) throw new Error('no batch')
    recordStoredCheck(
      storage,
      {
        id: 'due-job-1',
        projectId: 'proj-1',
        pageId: first.pageId,
        marketIds: first.marketIds,
        reason: 'scheduled',
        promptIds: first.promptIds,
        topicBatchId: first.topicBatchId,
        partial: true,
        needsClaude: false,
        maxSearches: 4,
        startedAt: NOW,
        cancelRequested: false
      },
      NOW
    )
    expect(readStoredCheckCatalog(storage).catalog.topicBatches).toHaveLength(
      result.batches.length - 1
    )
    const batchJobs = [first]

    const listed = await handlers['topics:list'](base)
    expect(listed.topics.map((topic) => topic.id)).toEqual([result.topicId])
    expect(listed.topics[0]?.pendingBatches).toBe(result.batches.length - batchJobs.length)
    // Topics never show up as pages.
    const pages = await handlers['pages:list']({ projectId: 'proj-1' })
    expect(pages.pages.map((item) => item.id)).toEqual(['page-setup'])

    const results = await handlers['topics:results']({
      ...base,
      topicId: result.topicId,
      marketId: null,
      runId: null
    })
    expect(results.rows.every((row) => row.state === 'not_checked')).toBe(true)
    expect(results.topic.domain).toBe('textbolt.com')
    expect(results.topic.brand).toEqual({ name: 'TextBolt', aliases: ['Text Bolt'] })
    expect(results.rows.find((row) => row.stableKey === firstQuestion.id)?.targetPageId).toBe(
      'page-setup'
    )

    // Every Claude call was a topic template or the domain follow-up; no search happened here.
    expect(
      claudeCalls.every(
        (line) =>
          line.startsWith('Template: topic_') ||
          line === 'Assist: company.officialDomains' ||
          line === 'Assist: project.productCompetitors'
      )
    ).toBe(true)
  })

  test('results read a stored check: match states, goals and drill ids agree', async () => {
    const { handlers, storage } = setup()
    const base = { projectId: 'proj-1' }
    const draft = await handlers['topics:createDraft']({
      ...base,
      path: 'questions',
      name: 'Sales questions'
    })
    const ids = { ...base, draftId: draft.id }
    const imported = await handlers['topics:importQuestions']({
      ...ids,
      text: [
        'How do I text staff from Outlook when the alarm emails at night?',
        'how do i text staff from outlook when the alarm emails at night',
        'Does TextBolt work with Gmail for alerts to my whole crew?',
        'sms alerts',
        'Our monitoring tool only emails. How do we get those alerts as texts?'
      ].join('\n')
    })
    expect(imported.stats).toEqual({
      lines: 5,
      kept: 4,
      duplicatesMerged: 1,
      brandFlagged: 1,
      shortFlagged: 1
    })
    const rows = imported.rows
    const target = rows[0]
    if (target === undefined) throw new Error('no rows')
    await handlers['topics:setTarget']({
      ...base,
      draftId: draft.id,
      promptIds: [target.id],
      target: { pageId: 'page-setup', url: null }
    })
    const started = await handlers['topics:start']({ ...ids, plan: 'all_now' })
    // The brand-flagged line is left out of the topic.
    expect(
      (
        await handlers['topics:results']({
          ...base,
          topicId: started.topicId,
          marketId: null,
          runId: null
        })
      ).rows
    ).toHaveLength(3)

    const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    const promptRows = db
      .prepare<unknown[], { prompt_id: string; stable_key: string; snapshot_id: string }>(
        `SELECT tp.prompt_id, tp.stable_key, (SELECT id FROM snapshots WHERE page_id = tp.page_id) AS snapshot_id
           FROM topic_prompts tp ORDER BY tp.rowid`
      )
      .all()
    const setId =
      db
        .prepare<unknown[], { id: string }>('SELECT id FROM prompt_sets WHERE page_id = ?')
        .get(started.topicId)?.id ?? ''
    insertStoredCheckJob(db, {
      id: 'job-x',
      startedAt: NOW,
      status: 'running',
      pageIds: [started.topicId],
      marketIds: null,
      promptIds: null,
      reason: 'manual',
      message: null,
      nextStep: null
    })
    insertStoredRun(db, {
      id: 'run-x',
      jobId: 'job-x',
      pageId: started.topicId,
      promptSetId: setId,
      snapshotId: promptRows[0]?.snapshot_id ?? '',
      marketId: 'mkt-us',
      startedAt: NOW,
      kind: 'baseline',
      partial: false,
      samples: 1,
      contentHash: HASH
    })
    const ref = (
      n: number,
      url: string,
      domain: string,
      classification: 'own' | 'competitor' | 'other'
    ): Parameters<typeof insertStoredSerpResult>[1]['references'][number] => ({
      id: `ref-${n}`,
      position: n,
      url,
      normalizedUrl: normalizeUrl(url) ?? url,
      domain,
      title: null,
      classification,
      untracked: false,
      sourceType: 'web' as const
    })
    const serp = (
      n: number,
      promptId: string,
      status: 'other_own_page' | 'not_cited' | 'no_aio',
      references: ReturnType<typeof ref>[]
    ): void =>
      insertStoredSerpResult(db, {
        id: `serp-${n}`,
        runId: 'run-x',
        promptId,
        sampleNo: 1,
        keyId: null,
        hasAio: status !== 'no_aio',
        neededFollowup: false,
        searches: 1,
        status,
        named: status === 'no_aio' ? null : false,
        citedUrl: null,
        position: null,
        aioText: status === 'no_aio' ? null : 'Overview text',
        errorCode: null,
        message: null,
        nextStep: null,
        rawSearchJson: null,
        rawAioJson: null,
        references: references.map((item) => ({ ...item, id: `${item.id}-${n}` }))
      })
    const [p1, p2, p3] = promptRows
    serp(1, p1?.prompt_id ?? '', 'other_own_page', [
      ref(1, 'https://simpletexting.com/a', 'simpletexting.com', 'competitor'),
      ref(
        2,
        'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
        'textbolt.com',
        'own'
      )
    ])
    serp(2, p2?.prompt_id ?? '', 'not_cited', [
      ref(1, 'https://simpletexting.com/b', 'simpletexting.com', 'competitor')
    ])
    serp(3, p3?.prompt_id ?? '', 'no_aio', [])
    finishStoredRun(db, 'run-x', '2026-10-19T12:30:00.000Z', 'finished')
    finishStoredCheckJob(db, 'job-x', '2026-10-19T12:30:00.000Z', 'finished', 3, null, null)
    closeProjectDatabase(db)

    const results = await handlers['topics:results']({
      ...base,
      topicId: started.topicId,
      marketId: 'mkt-us',
      runId: null
    })
    const byKey = new Map(results.rows.map((row) => [row.stableKey, row]))
    expect(byKey.get(p1?.stable_key ?? '')?.state).toBe('right_page')
    expect(byKey.get(p2?.stable_key ?? '')?.state).toBe('no_page')
    expect(byKey.get(p2?.stable_key ?? '')?.competitorCitedNotYou).toBe(true)
    expect(byKey.get(p3?.stable_key ?? '')?.state).toBe('no_aio')
    expect(results.goals.questions).toMatchObject({
      withAio: 2,
      cited: 1,
      rate: 50,
      noAio: 1,
      toReachBand: 0
    })
    expect(results.todo.find((group) => group.state === 'no_page')?.promptIds).toEqual([
      p2?.prompt_id
    ])
    expect(results.progress.map((point: TopicProgressPoint) => point.questions?.rate)).toEqual([50])
    expect(results.competitorCitedNotYou).toEqual([p2?.prompt_id])
    const pinned = await handlers['topics:results']({
      ...base,
      topicId: started.topicId,
      marketId: 'mkt-us',
      runId: 'run-x'
    })
    expect(pinned.goals.questions.cited).toBe(1)

    const why = await handlers['topics:whyNotCited']({
      ...base,
      topicId: started.topicId,
      promptId: p2?.prompt_id ?? ''
    })
    expect(why.reasons.length).toBeGreaterThan(0)
    const explain = await handlers['topics:explainCitation']({
      ...base,
      topicId: started.topicId,
      promptId: p1?.prompt_id ?? '',
      marketId: null,
      runId: 'run-x'
    })
    expect(explain.facts.length).toBeGreaterThan(0)
    const summary = await handlers['topics:topicSummary']({
      ...base,
      topicId: started.topicId,
      marketId: null
    })
    expect(summary.nextActions).toHaveLength(3)
    const again = await handlers['topics:results']({
      ...base,
      topicId: started.topicId,
      marketId: null,
      runId: null
    })
    expect(again.savedSummary?.text).toBe(summary.line)

    // A user target on a started topic persists.
    const set = await handlers['topics:setTarget']({
      ...base,
      topicId: started.topicId,
      promptIds: [p2?.prompt_id ?? ''],
      target: { pageId: 'page-setup', url: null }
    })
    expect(set.rows[0]?.targetPageId).toBe('page-setup')
    const after = await handlers['topics:results']({
      ...base,
      topicId: started.topicId,
      marketId: null,
      runId: null
    })
    expect(after.rows.find((row) => row.stableKey === p2?.stable_key)?.state).toBe('not_cited')
  })

  test("a competitor's page: questions and claims in two calls, checked in code (P4)", async () => {
    const { handlers, claudeCalls } = setup()
    const base = { projectId: 'proj-1' }
    const draft = await handlers['topics:createDraft']({
      ...base,
      path: 'competitor',
      seed: 'Text alerts for teams without a developer'
    })
    const ids = { ...base, draftId: draft.id }
    const read = await handlers['topics:readCompetitorPage']({
      ...ids,
      url: 'https://www.simpletexting.com/sms-alerts-for-business/'
    })
    expect(read.page.ok).toBe(true)
    const result = await handlers['topics:competitorQuestions']({ ...ids, marketId: null })
    expect(claudeCalls).toContain('Template: competitor_page_questions_v2.md')
    expect(claudeCalls).toContain('Template: competitor_page_claims.md')
    expect(claudeCalls).not.toContain('Template: competitor_page_questions.md')
    const questions = result.draft.prompts.filter((prompt) => prompt.source === 'competitor')
    expect(questions).toHaveLength(4)
    expect(questions.map((prompt) => prompt.sourceNote)).toContain(
      'From their section: Delivery reports'
    )
    // Claims: "no" first; evidence only for a page that was read.
    expect(
      result.claims.map((claim) => [claim.onYourSite, claim.section, claim.yourEvidence])
    ).toEqual([
      ['no', 'Delivery reports', null],
      ['partly', 'Integrations', '/']
    ])
  })

  test('a malformed request is rejected with the channel name', async () => {
    const { handlers } = setup()
    await expect(
      handlers['topics:createDraft']({ projectId: 'proj-1', path: 'url' } as never)
    ).rejects.toThrow('topics:createDraft')
    await expect(
      handlers['topics:getDraft']({ projectId: 'proj-1', draftId: 'missing' })
    ).rejects.toThrow('That draft was not found')
  })
})

describe('TextBolt topic seed (e2e and previews)', () => {
  test('the seeded checks read back with the fixture goals', async () => {
    const { handlers, storage } = setup()
    const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    const seeded = seedTextboltTopic(
      db,
      {
        id: 'proj-1',
        name: 'TextBolt',
        slug: 'textbolt',
        domain: 'textbolt.com',
        dbPath: projectDatabaseRelativePath('textbolt'),
        clientName: null,
        status: 'active'
      },
      { now: () => new Date('2026-10-19T12:00:00.000Z') }
    )
    closeProjectDatabase(db)
    const results = await handlers['topics:results']({
      projectId: 'proj-1',
      topicId: seeded.topicId,
      marketId: null,
      runId: null
    })
    const expected = textboltTopicResults()
    expect(results.goals.questions).toMatchObject({
      cited: expected.goals.questions.cited,
      withAio: expected.goals.questions.withAio
    })
    expect(results.goals.keywords).toMatchObject({
      cited: expected.goals.keywords.cited,
      withAio: expected.goals.keywords.withAio
    })
    expect(results.progress.map((point) => point.finishedAt)).toEqual(
      expected.progress.map((point) => point.finishedAt)
    )
    expect(results.keywords.byGroup).toHaveLength(22)
    // The seeded topic is not due at seed time: last checked Oct 19, every 14 days,
    // and it has no waiting batches. It is due again from Nov 2.
    const { catalog } = readStoredCheckCatalog(storage)
    expect(catalog.topicBatches).toEqual([])
    const dueAt = (iso: string): string[] =>
      planSchedule(catalog, Date.parse(iso), 'UTC')
        .due.pages.filter((item) => item.pageId === seeded.topicId)
        .map((item) => item.pageId)
    expect(dueAt('2026-10-21T12:00:00.000Z')).toEqual([])
    expect(dueAt('2026-11-02T12:00:00.000Z')).toEqual([seeded.topicId])
    // Seeded later (Dec 1), it is still not due at seed time, and results keep
    // the fixture's check dates.
    const late = setup()
    const lateDb = openProjectDatabase(late.storage.paths.projectsDirectory, 'textbolt')
    seedTextboltTopic(
      lateDb,
      {
        id: 'proj-1',
        name: 'TextBolt',
        slug: 'textbolt',
        domain: 'textbolt.com',
        dbPath: projectDatabaseRelativePath('textbolt'),
        clientName: null,
        status: 'active'
      },
      { now: () => new Date('2026-12-01T09:00:00.000Z') }
    )
    closeProjectDatabase(lateDb)
    const lateCatalog = readStoredCheckCatalog(late.storage).catalog
    const lateDue = (iso: string): number =>
      planSchedule(lateCatalog, Date.parse(iso), 'UTC').due.pages.filter(
        (item) => item.pageId === seeded.topicId
      ).length
    expect(lateDue('2026-12-01T12:00:00.000Z')).toBe(0)
    expect(lateDue('2026-12-15T12:00:00.000Z')).toBe(1)
    const lateResults = await late.handlers['topics:results']({
      projectId: 'proj-1',
      topicId: seeded.topicId,
      marketId: null,
      runId: null
    })
    expect(lateResults.topic.checkedAt).toBe('2026-10-19T09:14:00.000Z')
  })
})
