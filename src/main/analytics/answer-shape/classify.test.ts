import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  closeSeeds,
  envelope,
  FIXTURES,
  runFilter,
  seed
} from '../../engine/checks/checks.test-helper'
import { createLimiter } from '../../engine/checks/check-pace'
import { answerShapeReply } from '../../engine/checks/reports.test-helper'
import { createLogger } from '../../logging/logger'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../../providers/claude/parse'
import type { HttpResponse } from '../../providers/http'
import { getAnswerShapes, listAnswerShapeHashes } from '../../storage/answer-shapes'
import { listStoredCheckRuns } from '../../storage/check-records'
import { listGenerations } from '../../storage/content-records'
import { classifyRunAnswerShapes } from './classify'
import { ANSWER_SHAPE_SCHEMA } from './schema'
import { overviewHash } from './vocabulary'

const NOW = '2026-10-20T09:00:00.000Z'

/** The TextBolt fixture overview, grown into several blocks for the crew prompt. */
const CREW_BLOCKS = [
  'You can text employees without a developer by turning email from tools you already use into SMS.',
  'Office managers and shift leads use it when a crew has no company app.',
  'Carrier email-to-text gateways such as vtext.com are shutting down, so alerts sent that way stop arriving.'
]
const NIGHT_BLOCKS = ['Several vendors offer business texting for night shifts.']

afterEach(() => {
  closeSeeds()
})

describe('classifyRunAnswerShapes', () => {
  test('classifies each prompt overview once and reuses the cache on the next run', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const seen: string[] = []
    const claude = fakeClaude(seen)
    const first = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude,
      logger: quietLogger(),
      now: () => NOW
    })
    expect(first).toEqual({ classified: 2, cached: 0, skipped: 0, stopped: false })
    expect(seen).toHaveLength(2)
    expect(seen[0]).toContain('How do I alert the crew?')
    expect(seen[0]).toContain(CREW_BLOCKS[2])
    expect(seen[0]).not.toContain('{{')
    const crewHash = overviewHash(CREW_BLOCKS.join(' '))
    const stored = getAnswerShapes(projectDb, [crewHash]).get(crewHash)
    expect(stored?.blocks).toEqual([{ code: 'D1', excerpt: CREW_BLOCKS[0]?.slice(0, 40).trim() }])
    expect(stored?.classifiedAt).toBe(NOW)
    expect(stored?.templateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(listAnswerShapeHashes(projectDb)).toHaveLength(2)

    const second = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude,
      logger: quietLogger()
    })
    expect(second).toEqual({ classified: 0, cached: 2, skipped: 0, stopped: false })
    expect(seen).toHaveLength(2)
  })

  test('each answer-shape call is a generations row, so it counts toward usage and the caps', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const before = listGenerations(projectDb, 'page-1').length
    const seen: string[] = []
    await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude: fakeClaude(seen),
      logger: quietLogger(),
      now: () => NOW
    })
    const rows = listGenerations(projectDb, 'page-1').filter((row) => row.kind === 'answer_shape')
    expect(listGenerations(projectDb, 'page-1')).toHaveLength(before + 2)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.ok && row.connection === 'claude-code')).toBe(true)
    expect(rows[0]?.usage.inputTokens).toBeGreaterThanOrEqual(0)
    expect(rows[0]?.templateHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('the daily CiteFox AI cap stops answer-shape calls like other report calls', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const today = listGenerations(projectDb, 'page-1').filter(
      (row) => row.startedAt.slice(0, 10) === NOW.slice(0, 10)
    ).length
    const seen: string[] = []
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude: fakeClaude(seen),
      logger: quietLogger(),
      caps: { daily: today + 1, monthly: null },
      now: () => NOW
    })
    expect(seen).toHaveLength(1)
    expect(result).toEqual({ classified: 1, cached: 0, skipped: 1, stopped: false })
  })

  test('a cap already reached by other report calls blocks every answer-shape call', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const seen: string[] = []
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude: fakeClaude(seen),
      logger: quietLogger(),
      caps: { daily: null, monthly: 0 }
    })
    expect(seen).toEqual([])
    expect(result.classified).toBe(0)
  })

  test('stops before the next Claude call when asked', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const seen: string[] = []
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude: fakeClaude(seen),
      logger: quietLogger(),
      shouldStop: () => seen.length >= 1
    })
    expect(result).toEqual({ classified: 1, cached: 0, skipped: 0, stopped: true })
    expect(seen).toHaveLength(1)
    expect(listAnswerShapeHashes(projectDb)).toHaveLength(1)
  })

  test('with a limiter of two, both overviews are asked at once and both are saved', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const seen: string[] = []
    let inFlight = 0
    let most = 0
    let release: () => void = () => undefined
    const bothAsked = new Promise<void>((resolve) => {
      release = resolve
    })
    const claude: ClaudeProvider = {
      id: 'claude-code',
      async complete(request) {
        seen.push(request.prompt)
        inFlight += 1
        most = Math.max(most, inFlight)
        if (inFlight === 2) release()
        // Neither call answers until both are in flight: one at a time would never finish.
        await bothAsked
        inFlight -= 1
        return completion(answerShapeReply(request.prompt))
      }
    }
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude,
      logger: quietLogger(),
      limiter: createLimiter(2),
      now: () => NOW
    })
    expect(most).toBe(2)
    expect(result).toEqual({ classified: 2, cached: 0, skipped: 0, stopped: false })
    expect(listAnswerShapeHashes(projectDb)).toHaveLength(2)
  })

  test('with a limiter, one failed overview does not stop the other', async () => {
    const { projectDb, storage, runId } = await seededRun()
    let calls = 0
    const claude: ClaudeProvider = {
      id: 'claude-code',
      async complete(request) {
        calls += 1
        if (request.prompt.includes('night shift')) throw new Error('Claude call failed')
        return completion(answerShapeReply(request.prompt))
      }
    }
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude,
      logger: quietLogger(),
      limiter: createLimiter(2),
      now: () => NOW
    })
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(result.classified).toBe(1)
    expect(result.skipped).toBe(1)
    expect(listAnswerShapeHashes(projectDb)).toHaveLength(1)
  })

  test('a reply with an unknown code is rejected, logged, and the next overview continues', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const lines: string[] = []
    let calls = 0
    const claude: ClaudeProvider = {
      id: 'claude-code',
      async complete(request) {
        calls += 1
        const json = request.prompt.includes('How do I alert the crew?')
          ? { blocks: [{ code: 'Z9', excerpt: 'You can text employees' }] }
          : answerShapeReply(request.prompt)
        return completion(json)
      }
    }
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude,
      logger: createLogger({ write: (_level, line) => lines.push(line) })
    })
    expect(result).toEqual({ classified: 1, cached: 0, skipped: 1, stopped: false })
    expect(calls).toBeGreaterThan(2)
    expect(listAnswerShapeHashes(projectDb)).toEqual([overviewHash(NIGHT_BLOCKS.join(' '))])
    expect(lines.join('\n')).toContain('answer shape')
  })

  test('an excerpt that is not in the overview is rejected', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude: fixedClaude({ blocks: [{ code: 'A1', excerpt: 'An invented opening line' }] }),
      logger: quietLogger()
    })
    expect(result).toEqual({ classified: 0, cached: 0, skipped: 2, stopped: false })
    expect(listAnswerShapeHashes(projectDb)).toEqual([])
  })

  test('known secrets are masked in the prompt sent to Claude', async () => {
    const { projectDb, storage, runId } = await seededRun()
    const planted = 'vtext.com'
    const seen: string[] = []
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude: fakeClaude(seen),
      logger: quietLogger(),
      secrets: [planted, 'night shift']
    })
    expect(result.classified).toBe(2)
    expect(seen.join('\n')).not.toContain(planted)
    expect(seen.join('\n')).not.toContain('night shift')
    expect(seen.join('\n')).toContain('Carrier email-to-text gateways')
  })

  test('a prompt without an overview is skipped with no Claude call', async () => {
    const { projectDb, storage, runId } = await seededRun(() => envelope('google-no-aio.json'))
    const seen: string[] = []
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId,
      claude: fakeClaude(seen),
      logger: quietLogger()
    })
    expect(result).toEqual({ classified: 0, cached: 0, skipped: 2, stopped: false })
    expect(seen).toEqual([])
  })

  test('an unknown run classifies nothing', async () => {
    const { projectDb, storage } = await seededRun()
    const seen: string[] = []
    const result = await classifyRunAnswerShapes({
      db: projectDb,
      appDb: storage.db,
      projectId: 'proj-1',
      runId: 'run-missing',
      claude: fakeClaude(seen),
      logger: quietLogger()
    })
    expect(result).toEqual({ classified: 0, cached: 0, skipped: 0, stopped: false })
    expect(seen).toEqual([])
  })
})

async function seededRun(http: (request: { url: string }) => HttpResponse = overviewFor): Promise<{
  projectDb: Awaited<ReturnType<typeof seed>>['projectDb']
  storage: Awaited<ReturnType<typeof seed>>['storage']
  runId: string
}> {
  const seeded = await seed({ progress: [], secondPrompt: true, http })
  const job = await seeded.checkEngine.start({
    projectId: 'proj-1',
    pageIds: ['page-1'],
    marketIds: null,
    promptIds: null
  })
  expect(job.status).toBe('finished')
  const runId = listStoredCheckRuns(seeded.projectDb, runFilter())[0]?.id ?? ''
  return { projectDb: seeded.projectDb, storage: seeded.storage, runId }
}

/** The fixture overview, with the blocks above in place of its one paragraph. */
function overviewFor(request: { url: string }): HttpResponse {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, 'google-ai-overview.json'), 'utf8')) as {
    status: number
    body: { ai_overview: { text_blocks: unknown[] } }
  }
  const query = new URL(request.url).searchParams.get('q') ?? ''
  const blocks = query.includes('night shift') ? NIGHT_BLOCKS : CREW_BLOCKS
  fixture.body.ai_overview.text_blocks = blocks.map((snippet) => ({ type: 'paragraph', snippet }))
  return { status: fixture.status, body: JSON.stringify(fixture.body) }
}

function fakeClaude(seen: string[]): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request) {
      expect(request.schema).toBe(ANSWER_SHAPE_SCHEMA)
      seen.push(request.prompt)
      return completion(answerShapeReply(request.prompt))
    }
  }
}

function fixedClaude(json: unknown): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete() {
      return completion(json)
    }
  }
}

function completion(json: unknown): Awaited<ReturnType<ClaudeProvider['complete']>> {
  return {
    provider: 'claude-code',
    text: JSON.stringify(json),
    json,
    inputTokens: 3,
    outputTokens: 2,
    durationMs: 1,
    model: 'fixture',
    resolvedModel: 'fixture',
    usage: emptyClaudeCliUsage()
  }
}

function quietLogger(): ReturnType<typeof createLogger> {
  return createLogger({ write: () => undefined })
}
