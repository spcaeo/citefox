import { afterEach, describe, expect, test } from 'vitest'
import type {
  AssistProgress,
  FinishSetupRequest,
  SetupSectionRequest,
  SetupSectionRunRequest
} from '@shared/ipc'
import { runWithProgress } from '../assist/progress'
import type { CheckEngine, CheckRequest } from '../engine/checks/engine'
import { NO_SEARCH_KEY_MESSAGE } from '../onboarding/finish-setup'
import { WEB_SEARCH_TIMEOUT } from '../onboarding/sections/service'
import { ProviderError } from '../providers/errors'
import { row, textboltContext } from '../onboarding/sections/test-context.test-helper'
import { listProducts, listProductCompetitors } from '../storage/products'
import { openProjectDatabase, closeProjectDatabase } from '../storage/project-files'
import { listPages } from '../storage/pages'
import { getLatestBuyerProfile } from '../storage/content-records'
import { insertLlmCall } from '../storage/llm-calls'
import { insertClaudeCheckup, listProjects, readOnboardingFinished } from '../storage/records'
import { cleanupHarness, harness, keyRequest, profile, sectionClaude } from './test-harness'

afterEach(cleanupHarness)

const PROMPT_TEXT = 'Their gateway shut down.'

function runRequest(overrides: Partial<SetupSectionRunRequest> = {}): SetupSectionRunRequest {
  return {
    section: 'buyers',
    context: textboltContext(),
    mode: 'redo',
    instruction: null,
    current: [],
    prompt: null,
    ...overrides
  }
}

function promptRequest(section: SetupSectionRequest['section']): SetupSectionRequest {
  return { section, context: textboltContext(), mode: 'more', instruction: null, current: [] }
}

function fakeChecks(started: CheckRequest[]): CheckEngine {
  return {
    start: async (request: CheckRequest) => {
      started.push(request)
      return { id: request.jobId ?? 'job', projectId: request.projectId } as never
    }
  } as unknown as CheckEngine
}

function finishRequest(overrides: Partial<FinishSetupRequest> = {}): FinishSetupRequest {
  return {
    summary: 'TextBolt sells an email-to-SMS gateway to small US businesses.',
    products: [row('Email-to-SMS gateway', { detail: 'Turns emails into texts.', url: '/' })],
    competitors: [
      row('TXTImpact', { url: 'txtimpact.com', tag: 'Email-to-SMS gateway', tier: 'direct' }),
      row('Twilio', { url: 'twilio.com', tag: null, tier: 'partial' })
    ],
    buyers: [row('IT managers at small businesses', { detail: 'Their gateway shut down.' })],
    triggers: ['A carrier shuts down its email-to-text gateway'],
    topic: 'Replacing a shut-down email-to-text gateway',
    questions: [
      row('Our carrier shut down its email-to-text gateway. How do we keep alerts going?', {
        tag: 'problem'
      }),
      row('Which email-to-SMS gateway works best for a small IT team?', { tag: 'compare' }),
      row('Which email-to-SMS gateway works best for a small IT team?', { tag: 'compare' })
    ],
    runFirstCheck: true,
    ...overrides
  }
}

describe('IPC handlers: onboarding v2 sections', () => {
  test('sectionEstimate: no Claude means the ChatGPT way, never a dead button', async () => {
    const { handlers } = harness()
    const estimate = await handlers['onboarding:sectionEstimate']({ section: 'buyers' })
    expect(estimate).toEqual({
      kind: 'buyers',
      available: false,
      calls: 1,
      costText: '1 AI call',
      reason: 'CiteFox AI is not set up. Use your own ChatGPT for this section.'
    })
  })

  test('sectionEstimate: a Claude Code reply since the last checkup counts as connected', async () => {
    const { handlers, storage } = harness()
    const call = (startedAt: string, ok: boolean): void =>
      insertLlmCall(
        storage.db,
        {
          id: `call-${startedAt}`,
          connection: 'claude-code',
          model: null,
          source: 'assist',
          templateKind: null,
          templateId: null,
          templateHash: null,
          assistId: null,
          startedAt,
          durationMs: 1000,
          tokensIn: 1,
          tokensOut: 1,
          ok,
          error: ok ? null : 'failed'
        },
        { table: 'app', projectId: null }
      )
    // A failed call alone is not enough; setup's site read that got a reply is.
    call('2026-10-31T23:00:00.000Z', false)
    await expect(
      handlers['onboarding:sectionEstimate']({ section: 'summary' })
    ).resolves.toMatchObject({ available: false })
    call('2026-10-31T23:05:00.000Z', true)
    await expect(
      handlers['onboarding:sectionEstimate']({ section: 'summary' })
    ).resolves.toMatchObject({ available: true, reason: null })
    // A checkup that failed after that call hides ✦ again.
    insertClaudeCheckup(storage.db, {
      id: 'checkup-failed',
      ranAt: '2026-10-31T23:10:00.000Z',
      result: {
        binaryPath: null,
        version: null,
        login: 'skipped',
        plan: null,
        roundTrip: 'skipped',
        durationMs: null,
        resolvedModel: null,
        ready: false,
        message: 'Claude Code was not found.',
        nextStep: 'Install Claude Code, then check again.',
        rows: {
          binary: {
            state: 'warning',
            statusLabel: 'Not found on PATH',
            detail: 'CiteFox looked on your PATH.',
            nextStep: 'Install Claude Code, then check again.'
          },
          login: { state: 'skipped', statusLabel: 'Skipped', detail: 'Later', nextStep: null },
          roundTrip: { state: 'skipped', statusLabel: 'Skipped', detail: 'Later', nextStep: null }
        }
      }
    })
    await expect(
      handlers['onboarding:sectionEstimate']({ section: 'summary' })
    ).resolves.toMatchObject({ available: false })
  })

  test('sectionEstimate: on the Claude plan, and web search named for competitors', async () => {
    const { handlers } = harness({ claude: sectionClaude() })
    await expect(
      handlers['onboarding:sectionEstimate']({ section: 'summary' })
    ).resolves.toMatchObject({
      available: true,
      costText: '1 AI call · on your AI plan',
      reason: null
    })
    await expect(
      handlers['onboarding:sectionEstimate']({ section: 'competitors' })
    ).resolves.toMatchObject({ costText: '1 AI call with web search · on your AI plan' })
    await expect(
      handlers['onboarding:sectionEstimate']({ section: 'nope' } as never)
    ).rejects.toThrow(/not known/u)
  })

  test('sectionPrompt returns the exact prompt, its columns and the web search flag', async () => {
    const { handlers } = harness()
    const prompt = await handlers['onboarding:sectionPrompt']({
      section: 'competitors',
      context: textboltContext(),
      mode: 'more',
      instruction: null,
      current: [row('Notifyre', { url: 'notifyre.com' })]
    })
    expect(prompt.columns).toEqual(['name', 'domain', 'product', 'tier', 'why'])
    expect(prompt.webSearch).toBe(true)
    expect(prompt.prompt).toContain("Already listed, don't repeat: 1 competitor.")
    expect(
      prompt.prompt.endsWith(
        'Reply with CSV only, this header:\nname,domain,product,tier,why\nIf there is nothing new to add, reply with the header line only.'
      )
    ).toBe(true)
  })

  test('sectionRun: one call, rows merged, nothing of the prompt or reply in the log', async () => {
    const claude = sectionClaude()
    const { handlers, logs } = harness({ claude })
    const result = await handlers['onboarding:sectionRun'](
      runRequest({ current: [row('IT managers at small businesses')] })
    )
    expect(result.section).toBe('buyers')
    expect(result.rows.map((item) => item.name)).toEqual([
      'Office managers at clinics',
      'Operations leads at field service companies'
    ])
    expect(claude.requests).toHaveLength(1)
    expect(claude.requests[0]?.prompt.split('\n')[0]).toBe('Assist: setup.buyers')
    expect(claude.requests[0]?.webSearch).toBeUndefined()
    expect(claude.requests[0]?.trace?.assistId).toBe('setup.buyers')
    const log = logs.join('\n')
    expect(log).toContain('setup section run')
    expect(log).not.toContain(PROMPT_TEXT)
    expect(log).not.toContain('Office managers at clinics')
  })

  test('sectionRun ends with a done result step, so the activity panel stops counting it', async () => {
    const { handlers } = harness({ claude: sectionClaude() })
    const events: AssistProgress[] = []
    await runWithProgress(
      { channel: 'onboarding:sectionRun', emit: (event) => events.push(event) },
      () => handlers['onboarding:sectionRun'](runRequest())
    )
    const last = events.at(-1)
    expect(last?.kind).toBe('result')
    expect(last?.state).toBe('done')
    expect(last?.label).toMatch(/^\d+ buyers? ready$/u)
  })

  test('sectionRun: ✦ Find more reads new rows; competitors search the web', async () => {
    const claude = sectionClaude()
    const { handlers } = harness({ claude })
    const more = await handlers['onboarding:sectionRun'](
      runRequest({
        section: 'competitors',
        mode: 'more',
        current: [row('TXTImpact', { url: 'txtimpact.com' })]
      })
    )
    expect(more.rows.map((item) => item.name)).toEqual(['EZ Texting', 'SlickText'])
    expect(claude.requests[0]?.webSearch).toBe(true)
  })

  test('sectionRun: a competitor web search that times out keeps the list with a plain warning', async () => {
    const claude = sectionClaude(() => {
      throw new ProviderError('Claude Code timed out after 180 s', {
        code: 'timeout',
        state: 'warning',
        nextStep: null
      })
    })
    const { handlers } = harness({ claude })
    const result = await handlers['onboarding:sectionRun'](
      runRequest({ section: 'competitors', mode: 'more', current: [row('TXTImpact')] })
    )
    expect(result).toEqual({
      section: 'competitors',
      rows: [],
      text: null,
      warnings: [WEB_SEARCH_TIMEOUT]
    })
    // Other sections still say the call failed.
    await expect(handlers['onboarding:sectionRun'](runRequest())).rejects.toThrow(/timed out/u)
  })

  test('sectionRun: an edited prompt replaces the task and keeps main’s reply rules', async () => {
    const claude = sectionClaude()
    const { handlers } = harness({ claude })
    await handlers['onboarding:sectionRun'](
      runRequest({
        section: 'topic',
        prompt: 'Name a topic about alarm alerts.\n\nReply with the text only: whatever',
        instruction: 'short please'
      })
    )
    expect(claude.requests[0]?.prompt).toBe(
      'Assist: setup.topic\nName a topic about alarm alerts.\n\nThe user asks for this: short please\n\nReply with two lines only: the topic name, then the path on the site it comes from. No heading, no quote marks.'
    )
  })

  test('products: the prompt shows the site menu, read once from the home page', async () => {
    const read: string[] = []
    const claude = sectionClaude()
    const { handlers } = harness({
      claude,
      readWebsitePage: async (url) => {
        read.push(url)
        return url === 'https://textbolt.com/'
          ? {
              title: 'TextBolt · Email to text',
              text: 'Email to text for business.',
              links: ['https://textbolt.com/use-case/', 'https://textbolt.com/blog/'],
              anchors: [
                { text: 'Use cases', url: 'https://textbolt.com/use-case/' },
                { text: 'Blog', url: 'https://textbolt.com/blog/' }
              ]
            }
          : null
      }
    })
    const request = runRequest({ section: 'products', mode: 'more' })
    const shown = await handlers['onboarding:sectionPrompt'](promptRequest('products'))
    expect(shown.prompt).toContain(
      'Site paths (page titles or menu words; no other paths exist):\n- /: TextBolt · Email to text\n- /use-case/: Use cases\n'
    )
    expect(shown.webSearch).toBe(false)
    await handlers['onboarding:sectionRun'](request)
    expect(read).toEqual(['https://textbolt.com/'])
    expect(claude.requests[0]?.prompt).toContain('- /use-case/: Use cases')
    expect(claude.requests[0]?.prompt).not.toContain('/blog/')
    expect(claude.requests[0]?.webSearch).toBeUndefined()
  })

  test('products: a site that cannot be read leaves the menu out', async () => {
    const { handlers } = harness({ readWebsitePage: async () => null })
    const shown = await handlers['onboarding:sectionPrompt'](promptRequest('products'))
    expect(shown.prompt).not.toMatch(/Site paths/u)
  })

  test('sectionRun: an empty reply says Claude found nothing new, not the paste advice', async () => {
    const claude = sectionClaude(() => 'name,job,url')
    const { handlers } = harness({ claude, readWebsitePage: async () => null })
    const result = await handlers['onboarding:sectionRun'](
      runRequest({ section: 'products', mode: 'more' })
    )
    expect(result.rows).toEqual([])
    expect(result.warnings).toEqual(['Claude found nothing new to add.'])
    const pasted = await handlers['onboarding:sectionRead']({
      section: 'products',
      context: textboltContext(),
      current: [],
      text: 'name,job,url'
    })
    expect(pasted.warnings[0]).toMatch(/^No table or list was found/u)
  })

  test('sectionRead reads a pasted answer like Find more', async () => {
    const { handlers } = harness()
    const result = await handlers['onboarding:sectionRead']({
      section: 'triggers',
      context: textboltContext(),
      current: [row('An alarm email sits unread overnight')],
      text: '- An alarm email sits unread overnight\n- A schedule change goes out and staff miss it\n- TextBolt goes down'
    })
    expect(result.rows.map((item) => item.name)).toEqual([
      'A schedule change goes out and staff miss it'
    ])
  })
})

describe('IPC handlers: onboarding v2 finish', () => {
  test('saveProfile accepts an empty name and keeps the saved one', async () => {
    const { handlers, storage } = harness()
    await handlers['onboarding:saveProfile']({ ...profile(), userName: '' })
    expect(storage.readSettings().userName).toBeNull()
    await handlers['onboarding:saveProfile'](profile())
    await handlers['onboarding:saveProfile']({ ...profile(), userName: '' })
    expect(storage.readSettings().userName).toBe('Ada')
  })

  test('onboarding:finish accepts a cloro key', async () => {
    const { handlers } = harness()
    await handlers['onboarding:saveProfile'](profile())
    await handlers['keys:add'](keyRequest('cloro', 'cloro-secret-value-1234'))
    const state = await handlers['onboarding:finish']()
    expect(state.finished).toBe(true)
    expect(state.steps.find((step) => step.id === 'serpapi')?.status).toBe('done')
  })

  test('finishSetup needs the saved site first', async () => {
    const { handlers } = harness()
    await expect(handlers['onboarding:finishSetup'](finishRequest())).rejects.toThrow(
      /Save your site first/u
    )
  })

  test('finishSetup saves the catalog, the first topic with its profile, and starts the check', async () => {
    const started: CheckRequest[] = []
    const { handlers, storage } = harness({ checkEngine: fakeChecks(started) })
    await handlers['onboarding:saveProfile'](profile())
    await handlers['onboarding:saveDraft']({
      view: 'welcome',
      profile: {
        userName: '',
        projectName: '',
        domain: '',
        brands: [],
        brandDraft: '',
        competitors: [],
        competitorDraft: '',
        switchingFrom: [],
        integrations: [],
        country: '',
        countryCode: '',
        language: '',
        languageCode: '',
        location: ''
      },
      fill: null,
      budget: ''
    })
    await handlers['keys:add'](keyRequest('cloro', 'cloro-secret-value-1234'))
    const result = await handlers['onboarding:finishSetup'](finishRequest())
    expect(result.checkStarted).toBe(true)
    expect(result.message).toBeNull()
    expect(result.state.finished).toBe(true)
    expect(result.topicId).not.toBeNull()
    expect(started).toHaveLength(1)
    expect(started[0]?.pageIds).toEqual([result.topicId])
    expect(readOnboardingFinished(storage.db)).toBe(true)
    await expect(handlers['onboarding:getDraft']()).resolves.toBeNull()

    const project = listProjects(storage.db)[0]
    if (project === undefined) throw new Error('no project')
    const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
    try {
      expect(listProducts(db).map((item) => item.name)).toEqual(['Email-to-SMS gateway'])
      const product = listProducts(db)[0]
      const rivals = listProductCompetitors(db)
      expect(rivals.find((item) => item.name === 'TXTImpact')?.productId).toBe(product?.id)
      expect(rivals.find((item) => item.name === 'Twilio')?.tier).toBe('partial')
      const topic = listPages(db, project.id).find((page) => page.id === result.topicId)
      expect(topic?.title).toBe('Replacing a shut-down email-to-text gateway')
      const buyer = getLatestBuyerProfile(db, result.topicId ?? '')
      expect(JSON.stringify(buyer)).toContain('IT managers at small businesses')
      expect(JSON.stringify(buyer)).toContain('A carrier shuts down its email-to-text gateway')
    } finally {
      closeProjectDatabase(db)
    }
    await expect(handlers['onboarding:finishSetup'](finishRequest())).rejects.toThrow(
      /already finished/u
    )
  })

  test('finishSetup with no search key saves the topic and says why no check ran', async () => {
    const started: CheckRequest[] = []
    const { handlers } = harness({ checkEngine: fakeChecks(started) })
    await handlers['onboarding:saveProfile'](profile())
    const result = await handlers['onboarding:finishSetup'](finishRequest())
    expect(result.checkStarted).toBe(false)
    expect(result.message).toBe(NO_SEARCH_KEY_MESSAGE)
    expect(result.topicId).not.toBeNull()
    expect(result.state.finished).toBe(true)
    expect(started).toHaveLength(0)
  })

  test('finishSetup without questions finishes with no topic', async () => {
    const { handlers } = harness()
    await handlers['onboarding:saveProfile'](profile())
    const result = await handlers['onboarding:finishSetup'](
      finishRequest({ questions: [], runFirstCheck: false })
    )
    expect(result).toMatchObject({ topicId: null, checkStarted: false, message: null })
    expect(result.state.finished).toBe(true)
  })

  test('finishSetup rejects a malformed request', async () => {
    const { handlers } = harness()
    await expect(
      handlers['onboarding:finishSetup']({ ...finishRequest(), runFirstCheck: 'yes' } as never)
    ).rejects.toThrow(/Invalid request/u)
  })
})
