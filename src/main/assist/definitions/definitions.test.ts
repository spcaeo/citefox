import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ASSIST_IDS, type AssistRunRequest } from '@shared/ipc'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BUYER_PROMPTS_TEMPLATE } from '../../pipeline/template-bodies'
import { contentHash } from '../../pipeline/hash'
import { insertCoverage } from '../../storage/coverage-records'
import { listLlmCalls } from '../../storage/llm-calls'
import {
  FIXTURE_DIR,
  SEED,
  readFixture,
  request,
  seedAssistProject,
  type AssistSeed
} from '../assist.test-helper'
import { ASSIST_OUTPUT_RULES } from '../preamble'
import { getAssist, listAssistIds } from '../registry'
import { readAssistReply } from '../reply'
import { runAssist } from '../run'
import { ensureShippedAssists } from './index'

ensureShippedAssists()

describe('shipped assist registry', () => {
  test('every contract id is registered', () => {
    const registered = listAssistIds()
    for (const id of ASSIST_IDS) expect(registered).toContain(id)
  })

  test('every registered assist has a fixture that passes its reply rules', () => {
    for (const id of listAssistIds()) {
      const definition = getAssist(id)
      if (definition === null) throw new Error(`missing ${id}`)
      expect(existsSync(join(FIXTURE_DIR, `${id}.json`)), id).toBe(true)
      const read = readAssistReply(readFixture(id), definition)
      expect('reply' in read ? null : read.problem, id).toBeNull()
      expect(definition.expectedSeconds).toBeGreaterThanOrEqual(6)
      // A web search takes up to two minutes; every other assist answers in half a minute.
      expect(definition.expectedSeconds).toBeLessThanOrEqual(
        definition.webSearch === true ? 120 : 30
      )
    }
  })
})

interface Case {
  id: string
  extra?: Partial<AssistRunRequest>
  /** Saved data the prompt must carry. */
  facts: readonly string[]
  /** Where the call is logged. */
  table?: 'project' | 'app'
  /** Items code adds after Claude's (search cut-off, stored findings). */
  savedItems?: number
}

const CASES: readonly Case[] = [
  { id: 'page.shorterTitle', facts: [SEED.title, 'Title (101 characters)'] },
  // The 101-character title adds one "cut off" item, computed in code.
  { id: 'page.promises', facts: [SEED.meta, 'H1 (101 characters)', '<page_text>'], savedItems: 1 },
  { id: 'page.checkFacts', facts: ['155 GSM characters', 'Can employees reply to a text alert??'] },
  {
    id: 'audience.sharpen',
    facts: ['Office managers at US businesses', SEED.title, 'Market: United States (English)']
  },
  {
    id: 'audience.triggers',
    facts: ['A carrier email-to-text gateway stopped working.', 'At a Glance', '<page_text>']
  },
  {
    id: 'prompts.more',
    extra: { inputs: { count: 4 } },
    facts: [
      'Prompts wanted: 4',
      SEED.prompts[0],
      'TextBolt',
      'Product: not set',
      'Direct competitors of this business: simpletexting.com, twilio.com.',
      'A comparison prompt weighs kinds of solutions'
    ]
  },
  {
    id: 'prompts.rephrase',
    extra: { promptId: 'prompt-1' },
    facts: [SEED.prompts[0], 'Market: United States (English)', 'Buyer: ']
  },
  {
    id: 'prompts.rephrase',
    extra: { marketId: SEED.uk, inputs: { promptId: 'prompt-1' } },
    facts: [SEED.ukPrompt, 'Market: United Kingdom (English), London']
  },
  {
    // An instruction skips the saved matrix, so Claude rates the prompts with the rubric.
    id: 'prompts.checkPage',
    extra: { instruction: 'Look again at prompt 2.' },
    facts: [SEED.prompts[1], SEED.body, 'strong: the page answers this exact question']
  },
  {
    id: 'gaps.draftFix',
    extra: { promptId: 'prompt-2' },
    facts: ['Never names the plan', SEED.prompts[1]]
  },
  { id: 'results.explainChange', facts: ['Previous check: 2026-10-05', 'Fix 1, live 2026-10-10'] },
  { id: 'results.topActions', facts: ['Open coverage gaps:', 'Never names the plan'] },
  {
    id: 'results.whyNotFirst',
    extra: { promptId: 'prompt-1' },
    facts: ['Sources cited, in order (', '<overview>', SEED.prompts[0]]
  },
  {
    id: 'results.overviewRead',
    extra: { promptId: 'prompt-1' },
    facts: [
      '<overview>',
      'Observed in code:',
      'Competitors of this product: simpletexting.com, direct; twilio.com, direct',
      'Verdict: Cited once but never named — listed 2nd of 3 sources.'
    ]
  },
  { id: 'progress.nextFix', facts: ['Fix 2, live 2026-10-20', 'Never names the plan'] },
  {
    id: 'progress.otherMarkets',
    extra: { inputs: { fixNumber: 1 } },
    facts: [
      'Before the fix (check of 2026-10-05)',
      'After the fix (check of 2026-10-19)',
      'Market mkt-uk'
    ]
  },
  {
    id: 'progress.otherMarkets',
    extra: { inputs: { fixNumber: '2' } },
    facts: ['After the fix: no check since it went live on 2026-10-20']
  },
  {
    id: 'progress.draftFix',
    extra: { inputs: { fixNumber: 3, gap: 'Name the plan with scheduling.' } },
    facts: ['Fix to draft: Fix 3', 'Gap: Name the plan with scheduling.']
  },
  {
    id: 'markets.suggest',
    facts: ['Competitors: simpletexting.com, twilio.com', 'mkt-uk (UK · en · London']
  },
  {
    id: 'markets.localPrompts',
    extra: { marketId: SEED.uk },
    facts: [`Saved wording in this market: ${SEED.ukPrompt}`, 'Brand names to leave out: TextBolt']
  },
  {
    id: 'markets.whatsDifferent',
    extra: { marketId: SEED.uk },
    facts: ['Default market: mkt-us', SEED.ukPrompt]
  },
  {
    id: 'status.explainUsage',
    extra: { projectId: null, pageId: null },
    facts: ['SerpApi searches this month:', 'Key "My plan"', 'cap 200'],
    table: 'app'
  },
  {
    id: 'status.explainErrors',
    extra: { projectId: null, pageId: null },
    facts: ['Claude Code is signed out.', 'run_summary'],
    table: 'app'
  },
  {
    id: 'report.summary',
    facts: [
      'Template: run_summary.md',
      'Visibility score:',
      'Headline draft: ',
      'Write notes, not essays',
      'write "unknown" instead of guessing'
    ]
  },
  {
    id: 'template.improve',
    extra: { pageId: null, inputs: { kind: 'buyer_prompts', body: BUYER_PROMPTS_TEMPLATE } },
    facts: ['sms alerts small business', 'contains the brand name', 'You are writing buyer prompts']
  }
]

describe('shipped assists on saved data', () => {
  let seed: AssistSeed

  beforeAll(async () => {
    seed = await seedAssistProject()
  })

  afterAll(() => {
    seed.close()
  })

  test.each(CASES.map((item, index) => [`${item.id} #${index}`, item] as const))(
    '%s gathers saved data and maps the reply',
    async (_name, item) => {
      const before = seed.claude.requests.length
      const result = await runAssist(seed.host, request(item.id, item.extra))
      const sent = seed.claude.requests.slice(before)
      expect(sent).toHaveLength(1)
      const prompt = sent[0]?.prompt ?? ''
      expect(prompt.startsWith(`Assist: ${item.id}\n`)).toBe(true)
      expect(prompt).toContain(ASSIST_OUTPUT_RULES)
      for (const fact of item.facts) expect(prompt).toContain(fact)
      expect(prompt).not.toContain('fixture-serpapi-secret-assists')
      expect(sent[0]?.trace).toMatchObject({ source: 'assist', assistId: item.id })

      const fixture = readFixture(item.id) as { items: unknown[]; summary: string | null }
      expect(result.assistId).toBe(item.id)
      expect(result.items).toHaveLength(fixture.items.length + (item.savedItems ?? 0))
      expect(result.summary).toBe(fixture.summary)
      expect(result.searchesUsed).toBe(0)
      expect(result.savedDataOnly).toBe(true)
      expect(result.label.text).toMatch(/^CiteFox AI · on your plan · about \d+ s$/)

      const db = item.table === 'app' ? seed.storage.db : seed.projectDb
      const rows = listLlmCalls(db, {
        since: null,
        projectId: null,
        appTable: item.table === 'app'
      }).filter((row) => row.assistId === item.id)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0]).toMatchObject({ source: 'assist', ok: true, tokensIn: 120 })
    }
  )

  test('a missing fix names the next step', async () => {
    await expect(
      runAssist(seed.host, request('progress.otherMarkets', { inputs: {} }))
    ).rejects.toThrow('That fix was not found.')
  })

  test('an unknown prompt names the next step', async () => {
    await expect(
      runAssist(seed.host, request('gaps.draftFix', { promptId: 'prompt-9' }))
    ).rejects.toThrow('That prompt was not found.')
  })

  test('comparing the default market with itself is refused', async () => {
    await expect(
      runAssist(seed.host, request('markets.whatsDifferent', { marketId: SEED.us }))
    ).rejects.toThrow('This is the default market.')
  })

  test('a template with no runs needs an instruction', async () => {
    const input = { kind: 'aio_gap', body: 'Template: aio_gap.md\nList facts.' }
    await expect(
      runAssist(
        seed.host,
        request('template.improve', { projectId: null, pageId: null, inputs: input })
      )
    ).rejects.toThrow('This template has not run yet.')
    const result = await runAssist(
      seed.host,
      request('template.improve', {
        projectId: null,
        pageId: null,
        inputs: {
          ...input,
          body: `${input.body}\nReply with JSON that matches the schema and no other text.`
        },
        instruction: 'Ask for shorter facts.'
      })
    )
    expect(result.items.every((item) => item.sign !== null)).toBe(true)
  })

  test('a removed line that is not in the template is rejected', async () => {
    const input = { kind: 'buyer_prompts', body: 'Only one line here.' }
    await expect(
      runAssist(seed.host, request('template.improve', { pageId: null, inputs: input }))
    ).rejects.toThrow('Copy every removed line exactly from the template.')
  })

  test('a prompt that names the brand is rejected and retried', async () => {
    const good = readFixture('prompts.rephrase')
    seed.claude.queue.push(
      {
        summary: null,
        items: [1, 2, 3].map(() => ({
          text: 'Is TextBolt a good way to send text alerts to my staff without a developer?'
        })),
        caution: null
      },
      good
    )
    const before = seed.claude.requests.length
    const result = await runAssist(seed.host, request('prompts.rephrase', { promptId: 'prompt-1' }))
    expect(result.items).toHaveLength(3)
    const retry = seed.claude.requests[before + 1]?.prompt ?? ''
    expect(retry).toContain('The previous reply was rejected: Leave the brand name "TextBolt" out')
  })

  test('a report summary that quotes a number not in the saved data is rejected and retried', async () => {
    const good = readFixture('report.summary')
    seed.claude.queue.push(
      {
        summary: null,
        items: [
          { text: 'This page was cited in 7 of 9 AI Overviews.', tag: 'headline' },
          { text: 'It holds steady.', tag: 'body' }
        ],
        caution: null
      },
      good
    )
    const before = seed.claude.requests.length
    const result = await runAssist(seed.host, request('report.summary'))
    expect(result.items).toHaveLength(2)
    const retry = seed.claude.requests[before + 1]?.prompt ?? ''
    expect(retry).toContain('Use only numbers from the saved data. These are not in it: 7, 9.')
  })

  test('the handler runs an assist through the IPC parser', async () => {
    const result = await seed.handlers['assist:run'](request('results.topActions'))
    expect(result.items.length).toBeGreaterThanOrEqual(3)
    const described = await seed.handlers['assist:describe']({
      assistId: 'results.topActions',
      projectId: SEED.projectId
    })
    expect(described).toMatchObject({
      savedDataOnly: true,
      searchCost: 0,
      acceptsInstruction: true
    })
  })
})

describe('prompt audit P7 assists', () => {
  let seed: AssistSeed

  beforeAll(async () => {
    seed = await seedAssistProject()
  })

  afterAll(() => {
    seed.close()
  })

  test('prompts.checkPage shows the current saved matrix with no AI call', async () => {
    const before = seed.claude.requests.length
    const result = await runAssist(seed.host, request('prompts.checkPage'))
    expect(seed.claude.requests.length).toBe(before)
    expect(result.items.map((item) => item.tag)).toEqual(['strong', 'weak'])
    expect(result.items[1]?.text).toBe('Prompt 2: Never names the plan that includes scheduling.')
    expect(result.summary).toContain('1 strong, 0 partial, 1 weak, 0 none')
    expect(result.model).toBeNull()
  })

  test('page.shorterTitle lengths are counted by code, not by Claude', async () => {
    const result = await runAssist(seed.host, request('page.shorterTitle'))
    expect(result.items.map((item) => item.tag)).toEqual([
      'job first · 52 characters',
      'differentiator first · 47 characters',
      'problem first · 43 characters'
    ])
  })

  test('page.verifyClaims searches the web with the claims only and checks the sources', async () => {
    const before = seed.claude.requests.length
    const result = await runAssist(seed.host, request('page.verifyClaims'))
    const sent = seed.claude.requests.slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.webSearch).toBe(true)
    expect(sent[0]?.schema).toBeNull()
    const prompt = sent[0]?.prompt ?? ''
    expect(prompt.startsWith('Assist: page.verifyClaims\n')).toBe(true)
    expect(prompt).not.toContain(ASSIST_OUTPUT_RULES)
    expect(prompt).toContain('<claims>')
    expect(prompt).toContain('1. Each SMS holds 155 GSM characters.')
    expect(prompt).toContain('Market: United States.')
    // No page text beyond the claims: the opening sentence states no checkable fact.
    expect(prompt).not.toContain('Text alerts reach a crew faster than email.')
    expect(result.savedDataOnly).toBe(false)
    expect(result.items.map((item) => item.tag)).toEqual(['wrong', 'outdated'])
    const described = await seed.handlers['assist:describe']({
      assistId: 'page.verifyClaims',
      projectId: SEED.projectId
    })
    expect(described.savedDataOnly).toBe(false)
  })

  test('page.verifyClaims asks again when a wrong claim has no source', async () => {
    const good = readFixture('page.verifyClaims')
    seed.claude.queue.push(
      {
        summary: null,
        items: [
          {
            text: 'Each SMS holds 155 GSM characters.',
            detail: 'It is 160.',
            tag: 'wrong',
            verify: null
          }
        ],
        caution: null
      },
      good
    )
    const before = seed.claude.requests.length
    await runAssist(seed.host, request('page.verifyClaims'))
    const retry = seed.claude.requests[before + 1]?.prompt ?? ''
    expect(retry).toContain('Give at least one source URL in verify for every wrong claim')
  })

  test('page.verifyClaims checks the claims the user passes', async () => {
    seed.claude.queue.push({
      summary: null,
      items: [
        {
          text: 'Toll-free numbers need verification',
          detail: 'Carriers require toll-free verification before sending.',
          tag: 'confirmed',
          verify: 'https://example.com/toll-free'
        }
      ],
      caution: null
    })
    const before = seed.claude.requests.length
    await runAssist(
      seed.host,
      request('page.verifyClaims', { inputs: { claims: '- Toll-free numbers need verification' } })
    )
    const prompt = seed.claude.requests[before]?.prompt ?? ''
    expect(prompt).toContain('1. Toll-free numbers need verification')
    expect(prompt).not.toContain('155 GSM')
  })

  test('audience.triggers asks again when a tag is not a page element', async () => {
    const good = readFixture('audience.triggers')
    seed.claude.queue.push(
      {
        summary: null,
        items: [{ text: 'A gateway shuts down.', detail: 'They need a new one.', tag: 'Intro' }],
        caution: null
      },
      good
    )
    const before = seed.claude.requests.length
    const result = await runAssist(seed.host, request('audience.triggers'))
    expect(result.items).toHaveLength(3)
    const retry = seed.claude.requests[before + 1]?.prompt ?? ''
    expect(retry).toContain('copied exactly from the page')
  })

  test('page.checkFacts asks again when a statement is not on the page', async () => {
    const good = readFixture('page.checkFacts')
    seed.claude.queue.push(
      {
        summary: null,
        items: [
          {
            text: 'Each SMS holds 150 characters.',
            detail: 'It is 160.',
            tag: 'limit',
            verify: 'Check the standard.'
          }
        ],
        caution: null
      },
      good
    )
    const before = seed.claude.requests.length
    await runAssist(seed.host, request('page.checkFacts'))
    const retry = seed.claude.requests[before + 1]?.prompt ?? ''
    expect(retry).toContain('Copy each statement exactly as written on the page')
  })

  test('page.checkFacts reads the stored findings for this content with no AI call', async () => {
    insertCoverage(seed.projectDb, {
      runId: 'cov-2',
      pageId: SEED.pageId,
      recordedAt: '2026-10-21T00:00:00.000Z',
      templateId: 'tpl-coverage',
      templateName: 'CiteFox default',
      templateHash: contentHash('coverage'),
      templateUpdatedAt: null,
      contentHash: contentHash(SEED.body),
      reused: false,
      stale: false,
      rows: [],
      findings: [
        {
          id: 'f-1',
          runId: 'cov-2',
          pageId: SEED.pageId,
          kind: 'factual_claim',
          summary: 'A standard SMS holds 160 GSM characters, not 155.',
          detail: 'The page says 155.'
        },
        {
          id: 'f-2',
          runId: 'cov-2',
          pageId: SEED.pageId,
          kind: 'title_meta_mismatch',
          summary: 'The meta never mentions scheduling.',
          detail: 'The title leads with it.'
        }
      ]
    })
    const before = seed.claude.requests.length
    const facts = await runAssist(seed.host, request('page.checkFacts'))
    expect(seed.claude.requests.length).toBe(before)
    expect(facts.items).toEqual([
      expect.objectContaining({
        text: 'A standard SMS holds 160 GSM characters, not 155.',
        tag: 'limit',
        verify: expect.stringContaining('exact limit')
      })
    ])
    // The stored mismatch is added after Claude's three promises.
    const promises = await runAssist(seed.host, request('page.promises'))
    expect(promises.items.map((item) => item.tag)).toEqual([
      'title',
      'meta',
      'h1',
      'cut off',
      'mismatch'
    ])
    // An instruction asks Claude again.
    await runAssist(seed.host, request('page.checkFacts', { instruction: 'Look at dates only.' }))
    expect(seed.claude.requests.length).toBe(before + 2)
  })
})
