import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../../logging/logger'
import type { ClaudeCompletion, ClaudeProvider } from '../../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../../providers/claude/parse'
import { ClaudeLimitError } from '../../providers/errors'
import { listStoredCheckRuns } from '../../storage/check-records'
import { CLAUDE_WAIT_RETRY_MS, createProjectClaudeProvider } from '../claude-fallback'
import { closeSeeds, envelope, runFilter, seed } from './checks.test-helper'
import { createReportRunner } from './report-runner'

afterEach(() => {
  closeSeeds()
})

function counting(answer: () => Promise<ClaudeCompletion>): ClaudeProvider & { calls: number } {
  const provider = {
    id: 'claude-code' as const,
    calls: 0,
    async complete(): Promise<ClaudeCompletion> {
      provider.calls += 1
      return answer()
    }
  }
  return provider
}

function reply(): Promise<ClaudeCompletion> {
  return Promise.resolve({
    provider: 'claude-code',
    text: '{}',
    json: {},
    inputTokens: 1,
    outputTokens: 1,
    durationMs: 1,
    model: 'claude-sonnet-5-5',
    resolvedModel: null,
    usage: emptyClaudeCliUsage()
  })
}

async function finishedRuns(): Promise<{
  storage: Awaited<ReturnType<typeof seed>>['storage']
  runIds: string[]
}> {
  const { handlers, storage, projectDb } = await seed({
    progress: [],
    http: () => envelope('google-ai-overview.json')
  })
  const job = await handlers['checks:start']({
    projectId: 'proj-1',
    pageIds: ['page-1'],
    marketIds: null,
    promptIds: null
  })
  expect(job.status).toBe('finished')
  const runIds = listStoredCheckRuns(projectDb, runFilter()).map((run) => run.id)
  expect(runIds.length).toBeGreaterThan(0)
  return { storage, runIds }
}

const JOB = { id: 'job-report', projectId: 'proj-1', domain: 'textbolt.com' }

describe('check reports and the project Claude fallback (LLM-10)', () => {
  test('wait stops the report and writes it again later, on the project connection', async () => {
    const { storage, runIds } = await finishedRuns()
    const limited = counting(() => Promise.reject(new ClaudeLimitError('Plan limit reached.')))
    const working = counting(reply)
    const appWide = counting(reply)
    let connection: ClaudeProvider = limited
    const timers: Array<{ run: () => void; ms: number }> = []
    const asked: string[] = []
    const runner = createReportRunner({
      storage,
      logger: createLogger({ write: () => undefined }),
      claude: appWide,
      claudeFor: (projectId) => {
        asked.push(projectId)
        return createProjectClaudeProvider({
          primary: connection,
          primaryLabel: 'Claude Code',
          primaryKeyId: null,
          rule: 'wait',
          projectName: 'TextBolt'
        })
      },
      setTimer: (run, ms) => timers.push({ run, ms })
    })
    runner.schedule(JOB, runIds)
    await runner.idle()
    expect(asked).toEqual(['proj-1'])
    expect(limited.calls).toBe(1)
    expect(appWide.calls).toBe(0)
    expect(timers).toHaveLength(1)
    expect(timers[0]?.ms).toBe(CLAUDE_WAIT_RETRY_MS)

    connection = working
    timers[0]?.run()
    await runner.idle()
    expect(working.calls).toBeGreaterThan(0)
    expect(limited.calls).toBe(1)
    expect(timers).toHaveLength(1)
  })

  test('abort while waiting cancels the retry', async () => {
    const { storage, runIds } = await finishedRuns()
    const limited = counting(() => Promise.reject(new ClaudeLimitError('Plan limit reached.')))
    const timers: Array<{ run: () => void; ms: number }> = []
    const runner = createReportRunner({
      storage,
      logger: createLogger({ write: () => undefined }),
      claudeFor: () =>
        createProjectClaudeProvider({
          primary: limited,
          primaryLabel: 'Claude Code',
          primaryKeyId: null,
          rule: 'retry_later',
          projectName: null
        }),
      setTimer: (run, ms) => timers.push({ run, ms })
    })
    runner.schedule(JOB, runIds)
    await runner.idle()
    expect(timers).toHaveLength(1)
    expect(runner.abort(JOB.id)).toBe(true)
    timers[0]?.run()
    await runner.idle()
    expect(limited.calls).toBe(1)
    expect(runner.abort(JOB.id)).toBe(false)
  })

  test('ask stops the report and does not schedule a retry', async () => {
    const { storage, runIds } = await finishedRuns()
    const limited = counting(() => Promise.reject(new ClaudeLimitError('Plan limit reached.')))
    const timers: Array<{ run: () => void; ms: number }> = []
    const runner = createReportRunner({
      storage,
      logger: createLogger({ write: () => undefined }),
      claudeFor: () =>
        createProjectClaudeProvider({
          primary: limited,
          primaryLabel: 'Claude Code',
          primaryKeyId: null,
          rule: 'ask',
          projectName: null
        }),
      setTimer: (run, ms) => timers.push({ run, ms })
    })
    runner.schedule(JOB, runIds)
    await runner.idle()
    expect(limited.calls).toBe(1)
    expect(timers).toEqual([])
  })
})
