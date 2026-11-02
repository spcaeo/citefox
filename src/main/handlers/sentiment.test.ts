import { afterEach, describe, expect, test } from 'vitest'
import type { IpcHandlerMap, SentimentUpdated } from '@shared/ipc'
import { closeSeeds, stubCommand, stubProbe } from '../engine/checks/checks.test-helper'
import { fixtureClaude, seedSentiment } from '../engine/sentiment/sentiment.test-helper'
import { createIpcHandlers, type IpcHandlerDeps } from '.'

afterEach(() => {
  closeSeeds()
})

/** The real sentiment handlers on the seeded project, with the recorded Claude replies. */
async function sentimentApp(seen: string[] = []): Promise<{
  handlers: IpcHandlerMap
  updates: SentimentUpdated[]
  updated: () => Promise<void>
}> {
  const seeded = await seedSentiment({})
  await seeded.handlers['checks:start']({
    projectId: 'proj-1',
    pageIds: ['page-1'],
    marketIds: null,
    promptIds: null
  })
  const updates: SentimentUpdated[] = []
  let notify: () => void = () => undefined
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage: seeded.storage,
    secrets: seeded.checkDeps.secrets,
    logger: seeded.checkDeps.logger,
    http: seeded.checkDeps.http,
    claudeCommand: stubCommand(),
    claudeProbe: stubProbe(),
    emitCheckupProgress: () => undefined,
    emit: (channel, payload) => {
      if (channel === 'sentiment:updated') {
        updates.push(payload as SentimentUpdated)
        notify()
      }
    },
    now: seeded.checkDeps.now,
    createId: seeded.checkDeps.createId,
    checkEngine: seeded.checkEngine,
    claude: fixtureClaude(seen)
  } satisfies IpcHandlerDeps)
  const updated = (): Promise<void> =>
    new Promise((resolve) => {
      notify = resolve
    })
  return { handlers, updates, updated }
}

describe('sentiment IPC handlers', () => {
  test('a re-read reads the saved overviews with no new searches and pushes an update', async () => {
    const seen: string[] = []
    const { handlers, updates, updated } = await sentimentApp(seen)
    const before = await handlers['sentiment:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null
    })
    expect(before.reading.pending).toBe(3)
    expect(before.claims).toHaveLength(0)

    const done = updated()
    const started = await handlers['sentiment:reread']({ projectId: 'proj-1', pageId: 'page-1' })
    expect(started).toEqual({
      started: true,
      overviews: 4,
      message: 'CiteFox AI is re-reading 4 saved overviews. No new searches.'
    })
    const again = await handlers['sentiment:reread']({ projectId: 'proj-1', pageId: 'page-1' })
    expect(again.started).toBe(false)
    await done
    expect(updates).toEqual([{ projectId: 'proj-1', pageId: 'page-1' }])
    const after = await handlers['sentiment:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: 'mkt-us'
    })
    expect(after.reading).toEqual({ pending: 0, failed: 0, running: false })
    expect(after.claims).toHaveLength(8)
    expect(
      seen.every((prompt) => /^Template: sentiment_(claims_v2|fact_check)\.md/.test(prompt))
    ).toBe(true)
  })

  test('brand facts and brand prompts round-trip, and bad requests name the channel', async () => {
    const { handlers } = await sentimentApp()
    const facts = await handlers['sentiment:addFact']({
      projectId: 'proj-1',
      text: 'TextBolt plans start at $29 a month.',
      source: '  '
    })
    expect(facts.map((fact) => [fact.text, fact.source])).toEqual([
      ['TextBolt plans start at $29 a month.', null]
    ])
    const id = facts[0]?.id ?? ''
    expect(await handlers['sentiment:listFacts']({ projectId: 'proj-1' })).toHaveLength(1)
    expect(await handlers['sentiment:deleteFact']({ projectId: 'proj-1', factId: id })).toEqual([])
    await expect(
      handlers['sentiment:addFact']({ projectId: 'proj-1', text: ' ', source: null })
    ).rejects.toThrow('sentiment:addFact: A brand fact is 1 to 300 characters.')

    const generated = await handlers['sentiment:generateBrandPrompts']({
      projectId: 'proj-1',
      pageId: 'page-1'
    })
    expect(generated.version).toBe(2)
    expect(generated.prompts).toHaveLength(10)
    const saved = await handlers['sentiment:saveBrandPrompts']({
      projectId: 'proj-1',
      pageId: 'page-1',
      prompts: [{ kind: 'review', language: 'en', text: 'TextBolt reviews 2026' }]
    })
    expect(saved.version).toBe(3)
    await expect(
      handlers['sentiment:saveBrandPrompts']({
        projectId: 'proj-1',
        pageId: 'page-1',
        prompts: [{ kind: 'review', language: 'en', text: 'sms reviews' }]
      })
    ).rejects.toThrow('sentiment:saveBrandPrompts: Each brand prompt must name TextBolt.')
    await expect(
      handlers['sentiment:get']({ projectId: 'proj-1', pageId: 'page-1' } as never)
    ).rejects.toThrow('sentiment:get: Invalid request')
    await expect(
      handlers['sentiment:get']({ projectId: 'proj-1', pageId: 'page-1', marketId: 'mkt-zz' })
    ).rejects.toThrow('sentiment:get: Unknown market')
  })
})
