import { afterEach, describe, expect, test } from 'vitest'
import { PipelineError } from '../../pipeline/errors'
import { getTemplate } from '../../storage/records'
import { listBrandCaptures } from '../../storage/sentiment-records'
import { closeSeeds, NOW } from '../checks/checks.test-helper'
import type { CapGate, KeyRotation, RotatedCapture } from '../checks/key-rotation'
import { replaceProductCatalog, setPageProduct } from '../../storage/products'
import {
  brandPromptsProblem,
  comparisonCompetitor,
  generateBrandPrompts,
  saveBrandPrompts,
  type BrandPromptDeps
} from './brand-prompts'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { brandSearchesMax, captureBrandPrompts } from './capture'
import { fixtureClaude, seedSentiment, type SentimentSeed } from './sentiment.test-helper'
import { fullRuns } from './view'

afterEach(() => {
  closeSeeds()
})

function deps(
  seeded: SentimentSeed,
  seen: string[] = []
): BrandPromptDeps & { claude: ClaudeProvider } {
  let n = 0
  return {
    db: seeded.projectDb,
    appDb: seeded.storage.db,
    logger: seeded.checkDeps.logger,
    now: () => NOW,
    createId: () => `bp-${(n += 1)}`,
    claude: fixtureClaude(seen)
  }
}

describe('brand prompts (FR-16.1)', () => {
  test('Claude writes five per market language from the shipped template', async () => {
    const seeded = await seedSentiment({ brandPrompts: false })
    const seen: string[] = []
    const set = await generateBrandPrompts(deps(seeded, seen), {
      projectId: 'proj-1',
      pageId: 'page-1'
    })
    expect(seen).toHaveLength(2)
    expect(seen[0]).toContain(
      'Market: United States (English). Write in English for buyers in United States.'
    )
    expect(seen[1]).toContain('Market: Mexico (Spanish). Write in Spanish for buyers in Mexico.')
    // No products saved: the whole business, and its first competitor for the comparison.
    expect(seen[0]).toContain('Product: not set; treat the business as a whole.')
    expect(seen[0]).toContain('Competitor for the comparison prompt: SimpleTexting\n')
    expect(set.version).toBe(1)
    expect(set.prompts).toHaveLength(10)
    expect(set.prompts.filter((prompt) => prompt.language === 'es').map((p) => p.kind)).toEqual([
      'review',
      'pricing',
      'alternatives',
      'comparison',
      'use_case'
    ])
    expect(set.missingLanguages).toEqual([])
    expect(set.estimate).toEqual({ prompts: 10, markets: 2, minSearches: 10, maxSearches: 20 })
    const template = getTemplate(seeded.storage.db, 'tpl-brand-prompts')
    expect(set.templateHash).toBe(template?.hash)
    expect(JSON.parse(template?.schema ?? '{}')).toHaveProperty('required', ['prompts'])
  })

  test('edits save the next version, and every prompt must name the brand', async () => {
    const seeded = await seedSentiment({})
    const d = deps(seeded)
    expect(() =>
      saveBrandPrompts(d, {
        projectId: 'proj-1',
        pageId: 'page-1',
        prompts: [{ kind: 'review', language: 'en', text: 'best sms tool reviews' }]
      })
    ).toThrow(PipelineError)
    const saved = saveBrandPrompts(d, {
      projectId: 'proj-1',
      pageId: 'page-1',
      prompts: [
        { kind: 'review', language: 'en', text: 'textbolt reviews from IT teams' },
        { kind: 'pricing', language: 'EN', text: 'TextBolt   pricing for 3 sites' }
      ]
    })
    expect(saved.version).toBe(2)
    expect(saved.templateHash).toBeNull()
    expect(saved.prompts.map((prompt) => [prompt.position, prompt.text])).toEqual([
      [1, 'textbolt reviews from IT teams'],
      [2, 'TextBolt pricing for 3 sites']
    ])
    expect(saved.missingLanguages).toEqual(['es'])
    expect(saved.estimate).toEqual({ prompts: 2, markets: 1, minSearches: 2, maxSearches: 4 })
  })

  test('a reply that leaves out the brand or repeats a prompt fails validation', () => {
    expect(
      brandPromptsProblem({ prompts: [{ kind: 'review', text: 'sms reviews' }] }, ['TextBolt'])
    ).toBe('A brand prompt does not name TextBolt.')
    expect(
      brandPromptsProblem(
        {
          prompts: [
            { kind: 'review', text: 'TextBolt reviews' },
            { kind: 'pricing', text: 'textbolt reviews' }
          ]
        },
        ['TextBolt']
      )
    ).toBe('Two brand prompts are the same.')
  })

  test("the comparison names the page product's first direct competitor, else a partial one", () => {
    const versus = comparisonCompetitor({
      direct: [{ name: 'TXTImpact', domain: 'txtimpact.com' }],
      partial: [{ name: 'Twilio', domain: 'twilio.com' }]
    })
    expect(versus?.name).toBe('TXTImpact')
    expect(
      comparisonCompetitor({ direct: [], partial: [{ name: 'Twilio', domain: null }] })
    ).toEqual({ name: 'Twilio', domain: null })
    expect(comparisonCompetitor({ direct: [], partial: [] })).toBeNull()
    const reply = (text: string): unknown => ({
      prompts: [
        { kind: 'review', text: 'TextBolt reviews' },
        { kind: 'comparison', text }
      ]
    })
    expect(
      brandPromptsProblem(reply('TextBolt vs Txt Impact for staff alerts'), ['TextBolt'], versus)
    ).toBeNull()
    expect(
      brandPromptsProblem(reply('TextBolt vs SimpleTexting for alerts'), ['TextBolt'], versus)
    ).toBe('The comparison prompt must name TXTImpact.')
  })

  test('a page mapped to a product compares against that product, not the whole list', async () => {
    const seeded = await seedSentiment({ brandPrompts: false })
    replaceProductCatalog(seeded.projectDb, {
      products: [
        { id: 'prod-sms', name: 'Email to SMS', job: 'texts from email', buyer: 'IT teams' },
        { id: 'prod-inbox', name: 'Team inbox', job: 'shared replies', buyer: 'front desks' }
      ],
      competitors: [
        {
          name: 'Podium',
          domain: 'podium.com',
          productId: 'prod-inbox',
          tier: 'direct',
          startingPrice: null,
          sources: []
        },
        {
          name: 'SimpleTexting',
          domain: 'simpletexting.com',
          productId: 'prod-sms',
          tier: 'direct',
          startingPrice: null,
          sources: []
        }
      ]
    })
    setPageProduct(seeded.projectDb, 'page-1', 'prod-sms', true)
    const seen: string[] = []
    await generateBrandPrompts(deps(seeded, seen), { projectId: 'proj-1', pageId: 'page-1' })
    expect(seen[0]).toContain('Product: Email to SMS. Job: texts from email. Buyer: IT teams.')
    expect(seen[0]).toContain('Competitor for the comparison prompt: SimpleTexting\n')
    expect(seen[0]).not.toContain('Podium')
  })
})

describe('brand prompt captures', () => {
  test('a resumed run does not search a brand prompt again', async () => {
    const seeded = await seedSentiment({})
    await seeded.handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: ['mkt-us'],
      promptIds: null
    })
    const run = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us').at(-1)
    if (run === undefined) throw new Error('no run')
    let searches = 0
    const rotation: KeyRotation = {
      keys: () => [],
      exhausted: () => false,
      capture: async (): Promise<RotatedCapture> => {
        searches += 1
        throw new Error('should not search')
      }
    }
    const gate: CapGate = {
      allow: async () => true,
      stopRequested: () => false,
      capHit: () => false
    }
    const outcome = await captureBrandPrompts({
      db: seeded.projectDb,
      runId: run.id,
      market: { id: 'mkt-us', gl: 'US', hl: 'en', location: null, device: 'desktop', addedAt: NOW },
      prompts: [
        { id: 'bp-review', position: 1, kind: 'review', language: 'en', text: 'TextBolt reviews' }
      ],
      rotation,
      gate,
      createId: () => 'x',
      now: () => NOW,
      cancelled: () => false,
      classify: () => [],
      countSearches: () => undefined
    })
    expect(outcome).toBe('done')
    expect(searches).toBe(0)
    expect(listBrandCaptures(seeded.projectDb, [run.id])).toHaveLength(5)
  })

  test('searches three brand prompts at once and stores every capture', async () => {
    const seeded = await seedSentiment({})
    const run = await checkedRun(seeded)
    let inFlight = 0
    let most = 0
    const rotation: KeyRotation = {
      keys: () => [],
      exhausted: () => false,
      capture: async (query): Promise<RotatedCapture> => {
        inFlight += 1
        most = Math.max(most, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return capturedFor(query.q, false)
      }
    }
    let counted = 0
    const outcome = await captureBrandPrompts({
      ...captureInput(seeded, run.id, rotation),
      countSearches: (searches) => {
        counted += searches
      }
    })
    expect(outcome).toBe('done')
    expect(most).toBe(3)
    expect(counted).toBe(5)
    expect(
      listBrandCaptures(seeded.projectDb, [run.id])
        .map((row) => row.brandPromptId)
        .sort()
    ).toEqual(FIVE.map((prompt) => prompt.id).sort())
  })

  test('keys running out stops new brand searches; the ones started finish', async () => {
    const seeded = await seedSentiment({})
    const run = await checkedRun(seeded)
    const asked: string[] = []
    const rotation: KeyRotation = {
      keys: () => [],
      exhausted: () => false,
      capture: async (query): Promise<RotatedCapture> => {
        asked.push(query.q)
        // The second prompt finds the keys out at once; the others take a moment.
        const out = query.q === FIVE[1]?.text
        if (!out) await new Promise((resolve) => setTimeout(resolve, 5))
        return capturedFor(query.q, out)
      }
    }
    const outcome = await captureBrandPrompts(captureInput(seeded, run.id, rotation))
    expect(outcome).toBe('keys')
    // The first three started together; none started after the keys ran out.
    expect(asked).toEqual(FIVE.slice(0, 3).map((prompt) => prompt.text))
    expect(listBrandCaptures(seeded.projectDb, [run.id])).toHaveLength(2)
  })

  test('the search budget counts only prompts in each market language', () => {
    const prompts = [
      { id: 'a', position: 1, kind: 'review' as const, language: 'en', text: 'TextBolt reviews' },
      { id: 'b', position: 1, kind: 'review' as const, language: 'es', text: 'TextBolt opiniones' }
    ]
    expect(brandSearchesMax(prompts, [{ hl: 'en' }, { hl: 'EN' }, { hl: 'fr' }])).toBe(4)
  })
})

/** The seeded page's five English brand prompts (`seedSentiment`). */
const FIVE = [
  ['bp-review', 'TextBolt reviews'],
  ['bp-pricing', 'TextBolt pricing'],
  ['bp-alt', 'TextBolt alternatives'],
  ['bp-vs', 'TextBolt vs SimpleTexting for staff alerts'],
  ['bp-use', 'Is TextBolt good for staff alerts from Outlook']
].map(([id, text], index) => ({
  id: id ?? '',
  position: index + 1,
  kind: 'review' as const,
  language: 'en',
  text: text ?? ''
}))

async function checkedRun(seeded: SentimentSeed): Promise<{ id: string }> {
  await seeded.handlers['checks:start']({
    projectId: 'proj-1',
    pageIds: ['page-1'],
    marketIds: ['mkt-us'],
    promptIds: null
  })
  const run = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us').at(-1)
  if (run === undefined) throw new Error('no run')
  // Forget the check's own brand captures, so each test searches them again.
  seeded.projectDb.prepare('DELETE FROM brand_captures WHERE run_id = ?').run(run.id)
  return run
}

function captureInput(
  seeded: SentimentSeed,
  runId: string,
  rotation: KeyRotation
): Parameters<typeof captureBrandPrompts>[0] {
  let sequence = 0
  const gate: CapGate = {
    allow: async () => true,
    stopRequested: () => false,
    capHit: () => false
  }
  return {
    db: seeded.projectDb,
    runId,
    market: { id: 'mkt-us', gl: 'US', hl: 'en', location: null, device: 'desktop', addedAt: NOW },
    prompts: FIVE,
    rotation,
    gate,
    createId: () => {
      sequence += 1
      return `capture-${sequence}`
    },
    now: () => NOW,
    cancelled: () => false,
    classify: () => [],
    countSearches: () => undefined
  }
}

function capturedFor(query: string, exhausted: boolean): RotatedCapture {
  return {
    keyId: null,
    attempts: [],
    exhausted,
    hasAio: true,
    neededFollowup: false,
    searches: exhausted ? 0 : 1,
    halted: false,
    errorCode: null,
    message: null,
    nextStep: null,
    aioText: `An overview about ${query}.`,
    references: [],
    rawSearchJson: null,
    rawAioJson: null,
    retryAfterMs: null
  }
}
