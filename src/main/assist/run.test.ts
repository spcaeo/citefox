import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { completeAssist } from '../engine/assist'
import { SWITCHING_SHAPE, renderAssistShape } from '../engine/assist-shapes'
import { createLogger } from '../logging/logger'
import { listLlmCalls } from '../storage/llm-calls'
import {
  readFixture,
  request,
  seedAssistProject,
  SEED,
  type AssistSeed
} from './assist.test-helper'
import { ensureShippedAssists } from './definitions'
import { ASSIST_OUTPUT_RULES } from './preamble'
import { describeAssist, runAssist } from './run'

ensureShippedAssists()

const LONG_TITLES = {
  summary: null,
  items: [1, 2, 3].map((index) => ({
    text: `Text alerts for business number ${index}, sent from Gmail or Outlook with no developer`
  })),
  caution: null
}

describe('runAssist', () => {
  let seed: AssistSeed

  beforeAll(async () => {
    seed = await seedAssistProject()
  })

  afterAll(() => {
    seed.close()
  })

  function assistRows(assistId: string): ReturnType<typeof listLlmCalls> {
    return listLlmCalls(seed.projectDb, { since: null, projectId: null, appTable: false }).filter(
      (row) => row.assistId === assistId
    )
  }

  test('retries once with the problem named, then succeeds', async () => {
    seed.claude.queue.push({ verdict: 'no items' }, readFixture('page.promises'))
    const before = seed.claude.requests.length
    const result = await runAssist(seed.host, request('page.promises'))
    expect(result.items.length).toBeGreaterThanOrEqual(3)
    const sent = seed.claude.requests.slice(before)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.prompt).toContain(
      'The previous reply was rejected: The reply did not match the schema.'
    )
    expect(sent[1]?.prompt.startsWith('Assist: page.promises\n')).toBe(true)
  })

  test('stops after two rejected replies and logs both calls', async () => {
    const logged = assistRows('page.shorterTitle').length
    seed.claude.queue.push(LONG_TITLES, LONG_TITLES)
    await expect(runAssist(seed.host, request('page.shorterTitle'))).rejects.toThrow(
      'Every title must be under 60 characters.'
    )
    expect(seed.claude.queue).toHaveLength(0)
    expect(assistRows('page.shorterTitle')).toHaveLength(logged + 2)
  })

  test('a failed call is logged as failed under the assist id', async () => {
    seed.claude.failNext = 'Claude Code is signed out.'
    await expect(runAssist(seed.host, request('page.checkFacts'))).rejects.toThrow(
      'Claude Code is signed out.'
    )
    expect(assistRows('page.checkFacts')[0]).toMatchObject({
      source: 'assist',
      ok: false,
      error: 'Claude Code is signed out.'
    })
  })

  test('requests that miss a project, page, or known id are refused before Claude', async () => {
    const before = seed.claude.requests.length
    await expect(
      runAssist(seed.host, request('page.promises', { projectId: null }))
    ).rejects.toThrow('Open a project first.')
    await expect(runAssist(seed.host, request('gaps.draftFix'))).rejects.toThrow('Invalid request')
    await expect(runAssist(seed.host, request('page.nope'))).rejects.toThrow(
      'That assist is not available.'
    )
    expect(seed.claude.requests).toHaveLength(before)
  })

  test('describe reads the shipped estimate, then the logged durations', () => {
    const first = describeAssist(seed.host, { assistId: 'markets.suggest', projectId: null })
    expect(first.label.text).toBe('CiteFox AI · on your plan · about 8 s')
    const logged = describeAssist(seed.host, {
      assistId: 'page.promises',
      projectId: SEED.projectId
    })
    expect(logged.label.expectedSeconds).toBe(1)
  })
})

describe('completeAssist (older assist channels)', () => {
  let seed: AssistSeed

  beforeAll(async () => {
    seed = await seedAssistProject()
  })

  afterAll(() => {
    seed.close()
  })

  test('ends with the output rules, logs no prompt text, and traces the assist', async () => {
    const logs: string[] = []
    const host = {
      ...seed.host,
      logger: createLogger({ write: (_level, line) => logs.push(line) })
    }
    seed.claude.queue.push({ text: 'A clearer question' })
    const before = seed.claude.requests.length
    const json = await completeAssist(
      host,
      'prompts:rephrase',
      'Rephrase this buyer prompt.\nHow do I text the crew?',
      (value) => typeof value === 'object' && value !== null,
      SWITCHING_SHAPE,
      { assistId: 'prompts.rephrase', projectId: SEED.projectId }
    )
    expect(json).toEqual({ text: 'A clearer question' })
    const sent = seed.claude.requests[before]
    expect(sent?.prompt.startsWith('Rephrase this buyer prompt.')).toBe(true)
    // No schema reaches Claude Code here, so the rules are followed by the reply's keys.
    expect(
      sent?.prompt.endsWith(`\n\n${ASSIST_OUTPUT_RULES}\n\n${renderAssistShape(SWITCHING_SHAPE)}`)
    ).toBe(true)
    expect(sent?.trace).toEqual({
      source: 'assist',
      projectId: SEED.projectId,
      assistId: 'prompts.rephrase',
      templateKind: null,
      templateId: null,
      templateHash: null
    })
    const joined = logs.join('\n')
    expect(joined).not.toContain('How do I text the crew?')
    expect(joined).toContain('promptLength')
    const rows = listLlmCalls(seed.projectDb, {
      since: null,
      projectId: null,
      appTable: false
    }).filter((row) => row.assistId === 'prompts.rephrase')
    expect(rows[0]).toMatchObject({ source: 'assist', ok: true })
  })
})
