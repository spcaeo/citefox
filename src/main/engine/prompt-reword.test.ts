import type { CheckProgress } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import {
  insertTopicBatches,
  insertTopicPrompts,
  listAllTopicPrompts,
  listTopicBatches,
  type TopicPromptRecord
} from '../topics/records'
import { closeSeeds, envelope, NOW, seed } from './checks/checks.test-helper'

afterEach(() => {
  closeSeeds()
})

const NEW_WORDING = 'How do I text the whole crew when a Saturday shift changes?'

/** A seeded project with two enabled prompts; every SerpApi call answers from a fixture. */
async function setup(queries: string[] = []): ReturnType<typeof seed> {
  return seed({
    progress: [] as CheckProgress[],
    secondPrompt: true,
    http(request) {
      const url = new URL(request.url)
      if (url.searchParams.get('engine') === 'google') queries.push(url.searchParams.get('q') ?? '')
      return url.searchParams.get('engine') === 'google_ai_overview'
        ? envelope('google-ai-overview.json')
        : envelope('google-page-token.json')
    }
  })
}

const PROMPT = { projectId: 'proj-1', pageId: 'page-1' }

describe('prompts:reword', () => {
  test('saves the new wording as a new version and keeps old results with the old id', async () => {
    const queries: string[] = []
    const { handlers } = await setup(queries)
    const full = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(full.status).toBe('finished')

    const saved = await handlers['prompts:reword']({
      ...PROMPT,
      promptId: 'prompt-1',
      marketId: 'mkt-us',
      text: `  ${NEW_WORDING} `,
      allMarkets: false
    })
    expect(saved.changed).toBe(true)
    expect(saved.previousPromptId).toBe('prompt-1')
    expect(saved.promptId).not.toBe('prompt-1')
    expect(saved.version).toBe(2)

    const set = await handlers['prompts:list'](PROMPT)
    expect(set.version).toBe(2)
    expect(set.dirty).toBe(false)
    expect(set.prompts.map((prompt) => prompt.variants[0]?.text)).toEqual([
      NEW_WORDING,
      'How do I reach the night shift?'
    ])
    expect(set.prompts[0]?.id).toBe(saved.promptId)
    // A page prompt keeps its short name.
    expect(set.prompts[0]?.label).toBe('Crew')

    const versions = await handlers['prompts:versions']({ ...PROMPT, promptId: saved.promptId })
    expect(versions.active).toBe(true)
    expect(versions.currentPromptId).toBeNull()
    expect(versions.steps.map((step) => [step.promptId, step.promptSetVersion])).toEqual([
      [saved.promptId, 2],
      ['prompt-1', 1]
    ])
    expect(versions.steps[1]?.texts).toEqual([
      { marketId: 'mkt-us', text: 'How do I alert the crew?' }
    ])
    expect(versions.rules).toMatchObject({ kind: 'buyer_prompt', minWords: 8, maxWords: 32 })
    expect(versions.rules.brands).toEqual(['TextBolt'])
    const older = await handlers['prompts:versions']({ ...PROMPT, promptId: 'prompt-1' })
    expect(older.active).toBe(false)
    expect(older.currentPromptId).toBe(saved.promptId)

    // Re-check this prompt in one market only.
    queries.length = 0
    const recheck = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: ['mkt-us'],
      promptIds: [saved.promptId]
    })
    expect(recheck.status).toBe('finished')
    expect(queries).toEqual([NEW_WORDING])
    const runId = recheck.runIds[0] ?? null
    expect(runId).not.toBeNull()
    const fresh = await handlers['checks:getPrompt']({
      ...PROMPT,
      promptId: saved.promptId,
      marketId: 'mkt-us',
      runId
    })
    expect(fresh.row?.text).toBe(NEW_WORDING)
    // The last full check still holds the old wording's result, under the old id only.
    const latest = await handlers['checks:getPrompt']({
      ...PROMPT,
      promptId: 'prompt-1',
      marketId: 'mkt-us',
      runId: null
    })
    expect(latest.row?.text).toBe('How do I alert the crew?')
    const mixed = await handlers['checks:getPrompt']({
      ...PROMPT,
      promptId: saved.promptId,
      marketId: 'mkt-us',
      runId: null
    })
    expect(mixed.row).toBeNull()

    await expect(
      handlers['prompts:reword']({
        ...PROMPT,
        promptId: 'prompt-1',
        marketId: 'mkt-us',
        text: NEW_WORDING,
        allMarkets: true
      })
    ).rejects.toThrow(/older version of the prompt/)
  })

  test('runs the Prompts tab checks and saves nothing when the wording is the same', async () => {
    const { handlers } = await setup()
    type Reword = (typeof handlers)['prompts:reword']
    const reword = (patch: Partial<Parameters<Reword>[0]>): ReturnType<Reword> =>
      handlers['prompts:reword']({
        ...PROMPT,
        promptId: 'prompt-1',
        marketId: 'mkt-us',
        text: NEW_WORDING,
        allMarkets: false,
        ...patch
      })
    await expect(
      reword({ text: 'Which TextBolt plan texts the whole crew on a Saturday?' })
    ).rejects.toThrow(/contains the brand name "TextBolt"/)
    await expect(reword({ text: 'Crew text alerts' })).rejects.toThrow(/at least 8 words/)
    await expect(reword({ text: '   ' })).rejects.toThrow(/Write the wording before saving/)
    await expect(reword({ marketId: 'mkt-fr' })).rejects.toThrow(
      /That market is not on this prompt/
    )
    await expect(
      (handlers['prompts:reword'] as (value: unknown) => Promise<unknown>)({
        ...PROMPT,
        promptId: 'prompt-1',
        marketId: 'mkt-us',
        text: NEW_WORDING
      })
    ).rejects.toThrow('prompts:reword: Invalid request')

    const same = await reword({ promptId: 'prompt-2', text: 'How do I reach the night shift?' })
    expect(same).toMatchObject({ changed: false, promptId: 'prompt-2', version: 1 })
    expect((await handlers['prompts:list'](PROMPT)).version).toBe(1)

    await handlers['prompts:edit']({ ...PROMPT, promptId: 'prompt-2', label: 'Night shift' })
    await expect(reword({})).rejects.toThrow(/unsaved prompt edits on its Prompts tab/)
  })

  test('a topic question keeps its facts, gets a new stable key, and waiting batches follow it', async () => {
    const { handlers, projectDb } = await setup()
    const base: Omit<TopicPromptRecord, 'promptId' | 'stableKey'> = {
      pageId: 'page-1',
      kind: 'question',
      stage: 'problem',
      source: 'claude',
      sourceNote: null,
      kwGroup: null,
      kwGroupKind: null,
      intent: null,
      funnel: null,
      pageType: null,
      targetPageId: null,
      targetUrl: 'https://textbolt.com/pricing',
      matchConfidence: 100,
      matchReason: 'You picked this page.',
      matchSetBy: 'user',
      matchConfirmed: true
    }
    insertTopicPrompts(projectDb, [
      { ...base, promptId: 'prompt-1', stableKey: 'tp-a' },
      { ...base, promptId: 'prompt-2', stableKey: 'tp-b' }
    ])
    insertTopicBatches(projectDb, [
      {
        id: 'batch-1',
        pageId: 'page-1',
        batchNo: 1,
        marketIds: ['mkt-us'],
        promptKeys: ['tp-a', 'tp-b'],
        dueAt: NOW,
        jobId: null,
        startedAt: null,
        cancelledAt: null
      }
    ])
    await expect(
      handlers['prompts:reword']({
        ...PROMPT,
        promptId: 'prompt-1',
        marketId: 'mkt-us',
        text: 'Is TextBolt cheaper',
        allMarkets: true
      })
    ).rejects.toThrow(/names your brand/)
    // Short is fine for a topic question (the topic rules flag it, they do not refuse it).
    const saved = await handlers['prompts:reword']({
      ...PROMPT,
      promptId: 'prompt-1',
      marketId: 'mkt-us',
      text: 'crew text alerts',
      allMarkets: true
    })
    expect(saved.changed).toBe(true)
    const rows = new Map(listAllTopicPrompts(projectDb, 'page-1').map((row) => [row.promptId, row]))
    const moved = rows.get(saved.promptId)
    expect(moved?.stableKey).not.toBe('tp-a')
    expect(moved?.targetUrl).toBe('https://textbolt.com/pricing')
    expect(moved?.matchSetBy).toBe('user')
    const set = await handlers['prompts:list'](PROMPT)
    expect(set.prompts[0]?.label).toBe('crew text alerts')
    expect(rows.get(set.prompts[1]?.id ?? '')?.stableKey).toBe('tp-b')
    expect(listTopicBatches(projectDb, 'page-1')[0]?.promptKeys).toEqual([moved?.stableKey, 'tp-b'])
    const versions = await handlers['prompts:versions']({ ...PROMPT, promptId: saved.promptId })
    expect(versions.rules).toMatchObject({ kind: 'question', minWords: 1, maxWords: 32 })
  })

  test('a version saved from the Prompts tab links each prompt to its earlier version', async () => {
    const { handlers } = await setup()
    await handlers['prompts:edit']({
      ...PROMPT,
      promptId: 'prompt-1',
      variant: {
        marketId: 'mkt-us',
        text: 'How do I alert the whole crew about a late shift change?'
      }
    })
    await handlers['prompts:edit']({
      ...PROMPT,
      promptId: 'prompt-2',
      source: 'trigger_event',
      variant: {
        marketId: 'mkt-us',
        text: 'How do I reach the night shift when the schedule changes?'
      }
    })
    const saved = await handlers['prompts:save'](PROMPT)
    expect(saved.version).toBe(2)
    const second = saved.prompts[1]?.id ?? ''
    const versions = await handlers['prompts:versions']({ ...PROMPT, promptId: second })
    expect(versions.steps.map((step) => step.promptId)).toEqual([second, 'prompt-2'])
    await expect(
      handlers['prompts:versions']({ ...PROMPT, promptId: 'prompt-missing' })
    ).rejects.toThrow(/That prompt was not found/)
  })
})
