import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EMPTY_ASK_FILTERS } from '@shared/ipc'
import { seedTwoMarketProject } from '../../../tests/e2e/screens-seed'
import { createIpcHandlers } from '../handlers'
import type { EngineHost } from '../engine/host'
import { createLogger } from '../logging/logger'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import type { HttpRequest, HttpResponse } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { listLlmCalls } from '../storage/llm-calls'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { setPageStatus } from '../storage/pages'
import { replaceProductCatalog } from '../storage/products'

/**
 * Ask CiteFox through the real IPC handlers, over the two-market TextBolt seed
 * the e2e screens use: page-1 in US · EN and UK · EN, two prompts, two checks.
 * Claude is the `claude` test seam. No SerpApi call may happen.
 */

const NOW = '2026-10-20T09:00:00.000Z'
const FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), 'src/main/ask/fixtures/ask-filters.json'), 'utf8')
) as unknown
let seeded = ''
const cleanups: Array<() => void> = []

beforeAll(async () => {
  seeded = mkdtempSync(join(tmpdir(), 'citefox-ask-seed-'))
  await seedTwoMarketProject(seeded)
})

afterAll(() => {
  rmSync(seeded, { recursive: true, force: true })
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

interface FakeClaude extends ClaudeProvider {
  requests: ClaudeCompletionRequest[]
}

/** Each reply is JSON, or a string returned as non-JSON text. */
function fakeClaude(replies: unknown[]): FakeClaude {
  const requests: ClaudeCompletionRequest[] = []
  return {
    id: 'claude-code',
    requests,
    async complete(request) {
      requests.push(request)
      const reply = replies.shift()
      const text = typeof reply === 'string' ? reply : JSON.stringify(reply)
      return {
        provider: 'claude-code',
        text,
        json: typeof reply === 'string' ? null : (reply ?? null),
        inputTokens: 40,
        outputTokens: 12,
        durationMs: 2400,
        model: 'claude-test',
        resolvedModel: null,
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

function open(claude: ClaudeProvider): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  projectDb: () => SqliteDatabase
  http: ReturnType<typeof vi.fn>
} {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-ask-'))
  cpSync(seeded, dir, { recursive: true })
  const storage = openAppStorage(dir)
  let host: EngineHost | undefined
  const http = vi.fn(async (request: HttpRequest): Promise<HttpResponse> => {
    throw new Error(`No network in Ask CiteFox: ${request.url}`)
  })
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets: new MemorySecretStore(),
    logger: createLogger({ write: () => undefined }),
    http: { request: http },
    claudeCommand: {
      run: () => Promise.reject(new Error('The claude binary must not run in this test'))
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    now: () => new Date(NOW),
    claude,
    onHost: (opened) => {
      host = opened
    }
  })
  const opened: SqliteDatabase[] = []
  cleanups.push(() => {
    for (const db of opened) closeProjectDatabase(db)
    host?.email.close()
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    handlers,
    storage,
    http,
    projectDb: () => {
      const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
      opened.push(db)
      return db
    }
  }
}

const QUESTION = { projectId: 'proj-1', question: 'Where is my page not cited in the UK?' }

function rival(
  name: string,
  domain: string | null,
  productId: string | null,
  tier: 'direct' | 'partial'
): {
  name: string
  domain: string | null
  productId: string | null
  tier: 'direct' | 'partial'
  startingPrice: null
  sources: []
} {
  return { name, domain, productId, tier, startingPrice: null, sources: [] }
}

describe('ask:question', () => {
  it('turns the question into filters and answers from stored results', async () => {
    const claude = fakeClaude([FIXTURE])
    const { handlers, http, projectDb } = open(claude)
    const answer = await handlers['ask:question'](QUESTION)

    expect(answer.question).toBe(QUESTION.question)
    expect(answer.filters).toEqual({
      ...EMPTY_ASK_FILTERS,
      marketIds: ['mkt-uk'],
      statuses: ['not_cited', 'brand_mentioned', 'other_own_page']
    })
    expect(answer.chips.map((chip) => chip.label)).toEqual([
      'Not cited',
      'Brand mentioned',
      'Other own page',
      'UK · EN'
    ])
    expect(answer.answer).toBe(
      '2 of 4 prompt checks match in UK · EN: your page is not cited for 1 prompt and another of your pages is cited for 1 prompt. Sites cited most in these, besides yours: simpletexting.com (1 of 2). Latest check Oct 19, 2026.'
    )
    expect(answer.rows.map((row) => [row.marketId, row.promptId, row.status])).toEqual([
      ['mkt-uk', 'prompt-1', 'not_cited'],
      ['mkt-uk', 'prompt-2', 'other_own_page']
    ])
    expect(answer.rows[0]).toMatchObject({
      pageId: 'page-1',
      pageLabel: 'Alerts',
      marketLabel: 'UK · EN',
      promptText: 'How do I alert the crew in the UK without a developer?',
      citedDomains: ['simpletexting.com'],
      movement: 'unchanged'
    })
    expect(answer).toMatchObject({
      total: 2,
      searched: 4,
      savedDataOnly: true,
      notCovered: null,
      label: {
        connection: 'claude-code',
        expectedSeconds: 5,
        text: 'CiteFox AI · on your plan · about 5 s'
      }
    })
    expect(answer.checkedThrough).toMatch(/^2026-10-19T12:00/)

    const request = claude.requests[0]
    expect(claude.requests).toHaveLength(1)
    expect(request?.prompt.split('\n')[0]).toBe('Ask CiteFox: filters')
    expect(request?.prompt).toContain('Where is my page not cited in the UK?')
    expect(request?.prompt).toContain('- mkt-uk · UK · EN')
    expect(request?.prompt).toContain('- simpletexting.com · simpletexting.com · whole business')
    expect(request?.prompt).toContain('results for textbolt.com')
    expect(request?.prompt).toContain('- page-1 · Alerts · ')
    expect(request?.prompt).toContain('Today: 2026-10-20')
    expect(request?.schema).toBeTruthy()

    const calls = listLlmCalls(projectDb(), {
      since: null,
      projectId: 'proj-1',
      appTable: false
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ source: 'ask', assistId: 'ask.citefox', ok: true })
    expect(http).not.toHaveBeenCalled()
  })

  it("names each page's product and each product's competitors with their domains", async () => {
    const claude = fakeClaude([FIXTURE])
    const { handlers, projectDb } = open(claude)
    replaceProductCatalog(projectDb(), {
      products: [
        {
          id: 'prod-alerts',
          name: 'Text alerts',
          job: 'send text alerts to staff',
          buyer: 'small teams',
          evidencePath: '/blog/how-to-set-up-text-alerts-for-business/'
        },
        { id: 'prod-api', name: 'SMS API', job: 'send texts from code', buyer: 'developers' }
      ],
      competitors: [
        rival('SimpleTexting', 'simpletexting.com', 'prod-alerts', 'direct'),
        rival('Twilio', 'twilio.com', 'prod-api', 'direct'),
        rival('Twilio', 'twilio.com', 'prod-alerts', 'partial'),
        rival('Textmagic', null, null, 'direct')
      ]
    })
    await handlers['ask:question'](QUESTION)
    const prompt = claude.requests[0]?.prompt ?? ''
    expect(prompt).toContain(
      '- page-1 · Alerts · https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/ · Text alerts'
    )
    expect(prompt).toContain('- SimpleTexting · simpletexting.com · Text alerts (direct)')
    expect(prompt).toContain('- Twilio · twilio.com · Text alerts (partial), SMS API (direct)')
    expect(prompt).toContain('- Textmagic · domain not saved · whole business')
    expect(prompt).toContain(
      'Domains cited in the saved results, most cited first:\ntextbolt.com, simpletexting.com, twilio.com'
    )
  })

  it('uses past Ask CiteFox durations for the label', async () => {
    const claude = fakeClaude([FIXTURE, FIXTURE])
    const { handlers } = open(claude)
    await handlers['ask:question'](QUESTION)
    const second = await handlers['ask:question'](QUESTION)
    expect(second.label?.text).toBe('CiteFox AI · on your plan · about 2 s')
  })

  it('drops page and market ids the project does not have', async () => {
    const claude = fakeClaude([
      {
        filters: { ...EMPTY_ASK_FILTERS, pageIds: ['page-404'], marketIds: ['mkt-uk', 'mkt-fr'] },
        notCovered: 'There is no date filter.'
      }
    ])
    const { handlers } = open(claude)
    const answer = await handlers['ask:question'](QUESTION)
    expect(answer.filters.pageIds).toBeNull()
    expect(answer.filters.marketIds).toEqual(['mkt-uk'])
    expect(answer.total).toBe(2)
    expect(answer.notCovered).toBe('There is no date filter.')
  })

  it('retries once after an invalid reply', async () => {
    const claude = fakeClaude(['not json at all', FIXTURE])
    const { handlers } = open(claude)
    const answer = await handlers['ask:question'](QUESTION)
    expect(answer.total).toBe(2)
    expect(claude.requests).toHaveLength(2)
    expect(claude.requests[1]?.prompt).toContain('The previous reply was rejected')
  })

  it('rejects the question after two invalid replies', async () => {
    const claude = fakeClaude([
      { filters: { ...EMPTY_ASK_FILTERS, statuses: ['winning'] }, notCovered: null },
      { answer: 'Two pages lost citations.' }
    ])
    const { handlers, http } = open(claude)
    await expect(handlers['ask:question'](QUESTION)).rejects.toThrow(/did not match|only "filters"/)
    expect(claude.requests).toHaveLength(2)
    expect(http).not.toHaveBeenCalled()
  })

  it('does not call Claude when no check has finished', async () => {
    const claude = fakeClaude([FIXTURE])
    const { handlers, projectDb } = open(claude)
    setPageStatus(projectDb(), 'page-1', 'removed', 'proj-1')
    const answer = await handlers['ask:question'](QUESTION)
    expect(answer.answer).toBe('Press Check now first — Ask CiteFox only reads saved results.')
    expect(answer).toMatchObject({ searched: 0, total: 0, label: null, checkedThrough: null })
    expect(claude.requests).toHaveLength(0)
  })

  it('rejects an empty question before Claude', async () => {
    const claude = fakeClaude([FIXTURE])
    const { handlers } = open(claude)
    await expect(handlers['ask:question']({ projectId: 'proj-1', question: '  ' })).rejects.toThrow(
      'Ask a question of 1 to 500 characters.'
    )
    expect(claude.requests).toHaveLength(0)
  })
})

describe('ask:filter', () => {
  it('re-runs edited filters without Claude', async () => {
    const claude = fakeClaude([])
    const { handlers, http, projectDb } = open(claude)
    const answer = await handlers['ask:filter']({
      projectId: 'proj-1',
      filters: {
        ...EMPTY_ASK_FILTERS,
        statuses: ['not_cited', 'brand_mentioned', 'other_own_page']
      }
    })
    expect(answer.question).toBeNull()
    expect(answer.label).toBeNull()
    expect(answer.total).toBe(3)
    expect(answer.answer).toBe(
      '3 of 4 prompt checks match in UK · EN and US · EN: your page is not cited for 1 prompt and another of your pages is cited for 2 prompts. Most misses: Alerts in UK · EN (2 of its 2 prompts). Sites cited most in these, besides yours: simpletexting.com (1 of 3). Latest check Oct 19, 2026.'
    )
    expect(claude.requests).toHaveLength(0)
    expect(
      listLlmCalls(projectDb(), { since: null, projectId: 'proj-1', appTable: false })
    ).toEqual([])
    expect(http).not.toHaveBeenCalled()
  })

  it('filters on a cited competitor and on prompt words', async () => {
    const { handlers } = open(fakeClaude([]))
    const twilio = await handlers['ask:filter']({
      projectId: 'proj-1',
      filters: { ...EMPTY_ASK_FILTERS, citedDomain: 'https://www.Twilio.com/pricing' }
    })
    expect(twilio.filters.citedDomain).toBe('twilio.com')
    expect(twilio.chips).toEqual([
      { field: 'citedDomain', value: 'twilio.com', label: 'Cites twilio.com' }
    ])
    expect(twilio.rows.map((row) => [row.marketId, row.promptId])).toEqual([['mkt-us', 'prompt-1']])

    const words = await handlers['ask:filter']({
      projectId: 'proj-1',
      filters: { ...EMPTY_ASK_FILTERS, text: 'scheduled PLAN' }
    })
    expect(words.total).toBe(2)
    expect(words.chips[0]?.label).toBe('Contains: scheduled PLAN')
  })

  it('says when nothing matches', async () => {
    const { handlers } = open(fakeClaude([]))
    const answer = await handlers['ask:filter']({
      projectId: 'proj-1',
      filters: { ...EMPTY_ASK_FILTERS, movements: ['lost'] }
    })
    expect(answer.total).toBe(0)
    expect(answer.rows).toEqual([])
    expect(answer.answer).toBe(
      'No stored results match: no saved prompt check lost a citation since the check before. Searched 4 prompt checks. Remove a filter to see more. Latest check Oct 19, 2026.'
    )
  })
})

describe('ask:options', () => {
  it('lists pages, markets, and the most cited domains', async () => {
    const { handlers, http } = open(fakeClaude([]))
    const options = await handlers['ask:options']({ projectId: 'proj-1' })
    expect(options.pages).toEqual([{ id: 'page-1', label: 'Alerts', kind: 'page' }])
    expect(options.markets).toEqual([
      { id: 'mkt-us', label: 'US · EN' },
      { id: 'mkt-uk', label: 'UK · EN' }
    ])
    expect(options.domains).toEqual(['textbolt.com', 'simpletexting.com', 'twilio.com'])
    expect(http).not.toHaveBeenCalled()
  })
})
