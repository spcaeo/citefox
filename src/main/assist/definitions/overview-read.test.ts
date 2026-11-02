import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadPromptDetail } from '../../engine/checks/results'
import { listOverviewReads } from '../../storage/overview-reads'
import {
  NOW,
  readFixture,
  request,
  SEED,
  seedAssistProject,
  type AssistSeed
} from '../assist.test-helper'
import { runAssist } from '../run'
import { ensureShippedAssists } from './index'

ensureShippedAssists()

function detail(seed: AssistSeed): ReturnType<typeof loadPromptDetail> {
  return loadPromptDetail(seed.projectDb, {
    projectId: SEED.projectId,
    pageId: SEED.pageId,
    marketId: SEED.us,
    runId: null,
    promptId: 'prompt-1',
    builtAt: NOW,
    domain: 'textbolt.com',
    keyLabels: new Map()
  })
}

describe('results.overviewRead', () => {
  let seed: AssistSeed

  beforeAll(async () => {
    seed = await seedAssistProject()
  })

  afterAll(() => {
    seed.close()
  })

  test('the prompt detail carries the lens: brand, own site and the page’s competitors', () => {
    expect(detail(seed).lens).toEqual({
      brandNames: ['TextBolt'],
      ownDomain: 'textbolt.com',
      includeSubdomains: expect.any(Boolean),
      productName: null,
      competitors: [
        { name: 'simpletexting.com', domain: 'simpletexting.com', tier: 'direct' },
        { name: 'twilio.com', domain: 'twilio.com', tier: 'direct' }
      ]
    })
    expect(detail(seed).overviewReads).toEqual([])
  })

  test('saves the checked read per sample, so the page shows it again', async () => {
    const sample = detail(seed).samples[0]
    if (!sample) throw new Error('no sample')
    const result = await runAssist(
      seed.host,
      request('results.overviewRead', {
        promptId: 'prompt-1',
        marketId: SEED.us,
        inputs: { sampleId: sample.id }
      })
    )
    expect(result.items.map((item) => item.tag)).toEqual([
      'tone',
      'competitor: SimpleTexting',
      'action',
      'action',
      'action'
    ])
    const saved = listOverviewReads(seed.projectDb, [sample.id])
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      sampleId: sample.id,
      ranAt: NOW,
      read: {
        tone: { value: 'absent', quote: null },
        confidence: { level: 'medium', reason: 'One sample with a single short paragraph.' }
      }
    })
    expect(saved[0]?.read.actions).toHaveLength(3)
    expect(detail(seed).overviewReads.map((read) => read.sampleId)).toEqual([sample.id])
  })

  test('drops an action whose quote is not in the overview, and keeps the rest', async () => {
    const fixture = readFixture('results.overviewRead') as {
      items: { text: string; detail: string | null; tag: string }[]
    }
    seed.claude.queue.push({
      ...fixture,
      items: [
        ...fixture.items,
        { text: 'Add pricing.', detail: 'TextBolt costs $5 a month.', tag: 'action' }
      ]
    })
    const result = await runAssist(
      seed.host,
      request('results.overviewRead', { promptId: 'prompt-1', marketId: SEED.us })
    )
    expect(result.items.filter((item) => item.tag === 'action')).toHaveLength(3)
    expect(result.items.some((item) => item.text === 'Add pricing.')).toBe(false)
  })

  test('rejects a tone the overview cannot carry and asks again', async () => {
    const fixture = readFixture('results.overviewRead') as { items: object[] }
    seed.claude.queue.push(
      {
        ...fixture,
        items: [
          { text: 'positive', detail: 'TextBolt is the best choice.', tag: 'tone' },
          ...fixture.items.slice(1)
        ]
      },
      fixture
    )
    const before = seed.claude.requests.length
    await runAssist(seed.host, request('results.overviewRead', { promptId: 'prompt-1' }))
    const retry = seed.claude.requests[before + 1]?.prompt ?? ''
    expect(retry).toContain(
      'The previous reply was rejected: The overview does not name the brand, so tone is "absent".'
    )
  })

  test('a prompt with no stored overview names the next step', async () => {
    await expect(
      runAssist(
        seed.host,
        request('results.overviewRead', { promptId: 'prompt-1', inputs: { sampleId: 'nope' } })
      )
    ).rejects.toThrow('This sample has no stored AI Overview to read.')
  })
})
