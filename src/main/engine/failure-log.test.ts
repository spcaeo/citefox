import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seedAssistProject, SEED, type AssistSeed } from '../assist/assist.test-helper'
import { completeAssist } from './assist'
import { createLogger } from '../logging/logger'
import { logSerpApiFailure } from './checks/capture'
import { createCheckRunner, type CheckEngine, type CheckEngineDeps } from './checks/engine'

function capture(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = []
  return { lines, logger: createLogger({ write: (_level, line) => lines.push(line) }) }
}

function ask(host: AssistSeed['host']): Promise<unknown> {
  return completeAssist(
    host,
    'prompts:rephrase',
    'Rephrase this buyer prompt.',
    (value) => typeof value === 'object' && value !== null && 'text' in value,
    null,
    { assistId: 'prompts.rephrase', projectId: SEED.projectId }
  )
}

describe('engine failures leave one line with a short reason', () => {
  let seed: AssistSeed
  beforeAll(async () => {
    seed = await seedAssistProject()
  })
  afterAll(() => seed.close())

  test('an AI step that fails logs the step and a reason, never the message or prompt', async () => {
    const { logger, lines } = capture()
    seed.claude.failNext = 'Claude Code is signed out for secret-user@example.com.'
    await expect(ask({ ...seed.host, logger })).rejects.toThrow()
    const line = lines.find((entry) => entry.includes('claude assist failed'))
    expect(line).toContain('"assistId":"prompts.rephrase"')
    expect(line).toContain('"reason"')
    expect(lines.join('\n')).not.toContain('secret-user@example.com')
    expect(lines.join('\n')).not.toContain('signed out')
  })

  test('a reply that does not match the shape is logged for each try', async () => {
    const { logger, lines } = capture()
    seed.claude.queue.push({ verdict: 'no' }, { verdict: 'no' })
    await expect(ask({ ...seed.host, logger })).rejects.toThrow()
    const matching = lines.filter((entry) => entry.includes('did not match the shape'))
    expect(matching).toHaveLength(2)
    expect(matching[0]).toContain('"attempt":0')
    expect(matching[1]).toContain('"attempt":1')
  })
})

describe('a SerpApi search that fails', () => {
  test('is logged with the reason and the count, not the message', () => {
    const { logger, lines } = capture()
    logSerpApiFailure(logger, { errorCode: 'rejected', halted: false, searches: 1 })
    expect(lines[0]).toContain('search call failed')
    expect(lines[0]).toContain('"provider":"serpapi"')
    expect(lines[0]).toContain('"reason":"rejected"')
  })

  test('is not logged when it worked or was only cancelled', () => {
    const { logger, lines } = capture()
    logSerpApiFailure(logger, { errorCode: null, halted: false, searches: 1 })
    logSerpApiFailure(logger, { errorCode: 'other', halted: true, searches: 0 })
    expect(lines).toEqual([])
  })
})

describe('a check that cannot start', () => {
  test('is logged with the job id and the error type only', async () => {
    const { logger, lines } = capture()
    const engine = {
      async start() {
        throw new Error('disk path /Users/secret-person/db failed')
      }
    } as unknown as CheckEngine
    const runner = createCheckRunner({ logger } as unknown as CheckEngineDeps, engine)
    const result = await runner.run({
      id: 'job-1',
      projectId: 'p',
      pageId: 'pg',
      marketIds: [],
      promptIds: null,
      reason: 'manual'
    } as unknown as Parameters<typeof runner.run>[0])
    expect(result).toMatchObject({
      outcome: 'error',
      message: 'The check could not start. Try it again in a minute.'
    })
    expect(JSON.stringify(result)).not.toContain('secret-person')
    expect(lines[0]).toContain('check could not start')
    expect(lines[0]).toContain('"jobId":"job-1"')
    expect(lines[0]).toContain('"threw":"Error"')
    expect(lines.join('\n')).not.toContain('secret-person')
  })
})
