import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openCheckClaude } from '../../engine/claude'
import { createLogger } from '../../logging/logger'
import { contentHash } from '../../pipeline/hash'
import type { BinaryProbe } from '../../providers/claude/binary'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import type { CommandResult, CommandTransport } from '../../providers/command'
import type { HttpResponse } from '../../providers/http'
import { MemorySecretStore } from '../../secrets/secret-store'
import { openAppStorage } from '../../storage/app-storage'
import { ANSWER_SHAPE_SCHEMA } from '../../analytics/answer-shape/schema'
import { overviewHash } from '../../analytics/answer-shape/vocabulary'
import { listAnswerShapeHashes } from '../../storage/answer-shapes'
import { listStoredCheckRuns } from '../../storage/check-records'
import { insertBuyerProfile, insertPromptSet, insertSnapshot } from '../../storage/content-records'
import { addPageMarket, insertPage } from '../../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../storage/project-files'
import { writeProjectProfile } from '../../storage/project-profile'
import { insertApiKey, insertProject } from '../../storage/records'
import { projectDatabaseRelativePath } from '../../storage/slug'
import { closeSeeds, createGate, envelope, runFilter, seed, until } from './checks.test-helper'
import { createCheckEngine } from './engine'
import { aioGapPath, checkReportsRoot, runSummaryPath } from './report-files'
import {
  buyer,
  NOW,
  page,
  prompt,
  provider,
  read,
  SECRET,
  SERP,
  snapshot
} from './reports.test-helper'

afterEach(() => {
  closeSeeds()
})

describe('check reports from an engine run', () => {
  test('a finished engine run writes the files from stored captures', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'citefox-engine-report-'))
    const storage = openAppStorage(userData)
    insertProject(storage.db, {
      id: 'proj-1',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    writeProjectProfile(projectDb, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: ['SimpleTexting'],
      market: {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    })
    insertPage(projectDb, page())
    addPageMarket(projectDb, {
      pageId: 'page-1',
      marketId: 'mkt-us',
      addedAt: NOW,
      baselineRunId: null
    })
    insertSnapshot(projectDb, snapshot())
    insertBuyerProfile(projectDb, buyer())
    insertPromptSet(
      projectDb,
      {
        id: 'pset-engine',
        pageId: 'page-1',
        version: 1,
        savedAt: NOW,
        icpId: 'icp-1',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: [prompt('prompt-1', 1, 'Crew', 'How do I alert the crew?', 'mkt-us', 'en')]
      },
      ['TextBolt']
    )
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'Search',
      keychainRef: 'citefox.serpapi.key-1',
      hint: 'ab12',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: null
    })
    const secrets = new MemorySecretStore()
    secrets.set('citefox.serpapi.key-1', SECRET)
    let sequence = 0
    const engine = createCheckEngine({
      storage,
      secrets,
      logger: createLogger({ write: () => undefined }),
      http: {
        async request(): Promise<HttpResponse> {
          const parsed = JSON.parse(
            readFileSync(join(SERP, 'google-ai-overview.json'), 'utf8')
          ) as {
            status: number
            body: unknown
          }
          return { status: parsed.status, body: JSON.stringify(parsed.body) }
        }
      },
      now: () => new Date(NOW),
      createId: () => {
        sequence += 1
        return `eng-${sequence}`
      },
      emitProgress: () => undefined,
      emitFinished: () => undefined,
      knownSecrets: () => [SECRET],
      claude: provider('aio-gap.json')
    })
    const job = await engine.start({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    await engine.reportsIdle()
    expect(job.status).toBe('finished')
    const runs = listStoredCheckRuns(projectDb, {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketId: 'mkt-us',
      from: null,
      to: null,
      runId: null,
      promptId: null
    })
    const runId = runs[0]?.id
    expect(runId).toBeTruthy()
    const root = checkReportsRoot(userData)
    const gap = read(aioGapPath(root, 'proj-1', runId ?? ''))
    const summary = read(runSummaryPath(root, 'proj-1', runId ?? ''))
    expect(gap).toContain('page cited')
    expect(gap).toContain('Template: aio_gap.md')
    expect(summary).toContain('Template: run_summary.md')
    expect(summary).toContain('**1** AIOs shown')
    expect(gap).not.toContain(SECRET)
    expect(summary).not.toContain(SECRET)
    const results = engine.results({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(results.runSummary?.headline).toContain('**1** page cited')
    const detail = engine.getPrompt({
      projectId: 'proj-1',
      pageId: 'page-1',
      promptId: 'prompt-1',
      marketId: null,
      runId: null
    })
    expect(detail.aioGap).toBeNull()
    closeProjectDatabase(projectDb)
    storage.close()
    rmSync(userData, { recursive: true, force: true })
  })

  test('a finished check still scores when Claude is unavailable', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'citefox-engine-skip-'))
    const storage = openAppStorage(userData)
    insertProject(storage.db, {
      id: 'proj-1',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    writeProjectProfile(projectDb, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: ['SimpleTexting'],
      market: {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    })
    insertPage(projectDb, page())
    addPageMarket(projectDb, {
      pageId: 'page-1',
      marketId: 'mkt-us',
      addedAt: NOW,
      baselineRunId: null
    })
    insertSnapshot(projectDb, snapshot())
    insertBuyerProfile(projectDb, buyer())
    insertPromptSet(
      projectDb,
      {
        id: 'pset-engine',
        pageId: 'page-1',
        version: 1,
        savedAt: NOW,
        icpId: 'icp-1',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: [prompt('prompt-1', 1, 'Crew', 'How do I alert the crew?', 'mkt-us', 'en')]
      },
      ['TextBolt']
    )
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'Search',
      keychainRef: 'citefox.serpapi.key-1',
      hint: 'ab12',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: null
    })
    const saved = storage.readSettings()
    storage.readSettings = (): ReturnType<typeof storage.readSettings> => ({
      ...saved,
      claudeBinaryPath: `/opt/${SECRET}/claude`
    })
    const lines: string[] = []
    const logger = createLogger({
      write: (_level, line) => {
        lines.push(line)
      }
    })
    const command: CommandTransport = {
      async run(): Promise<CommandResult> {
        return {
          exitCode: 1,
          stdout: '',
          stderr: SECRET,
          timedOut: false,
          spawnError: 'ENOENT'
        }
      }
    }
    const probe: BinaryProbe = {
      exists: (): boolean => false,
      searchPath: (): null => null
    }
    const secrets = new MemorySecretStore()
    secrets.set('citefox.serpapi.key-1', SECRET)
    const claude = openCheckClaude({
      storage,
      secrets,
      logger,
      http: {
        async request(): Promise<HttpResponse> {
          return { status: 200, body: '' }
        }
      },
      command,
      probe,
      knownSecrets: () => [SECRET]
    })
    expect(claude).toBeUndefined()
    let sequence = 0
    const engine = createCheckEngine({
      storage,
      secrets,
      logger,
      http: {
        async request(): Promise<HttpResponse> {
          const parsed = JSON.parse(
            readFileSync(join(SERP, 'google-ai-overview.json'), 'utf8')
          ) as {
            status: number
            body: unknown
          }
          return { status: parsed.status, body: JSON.stringify(parsed.body) }
        }
      },
      now: () => new Date(NOW),
      createId: () => {
        sequence += 1
        return `skip-${sequence}`
      },
      emitProgress: () => undefined,
      emitFinished: () => undefined,
      knownSecrets: () => [SECRET]
    })
    const job = await engine.start({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    await engine.reportsIdle()
    expect(job.status).toBe('finished')
    const results = engine.results({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(typeof results.run?.visibilityScore).toBe('number')
    const runs = listStoredCheckRuns(projectDb, {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketId: 'mkt-us',
      from: null,
      to: null,
      runId: null,
      promptId: null
    })
    const runId = runs[0]?.id ?? ''
    expect(runId).not.toBe('')
    const root = checkReportsRoot(userData)
    expect(existsSync(aioGapPath(root, 'proj-1', runId))).toBe(false)
    expect(existsSync(runSummaryPath(root, 'proj-1', runId))).toBe(false)
    const logged = lines.join('\n')
    expect(logged).toContain('check report skipped')
    expect(logged).toContain('[REDACTED]')
    expect(logged).not.toContain(SECRET)
    closeProjectDatabase(projectDb)
    storage.close()
    rmSync(userData, { recursive: true, force: true })
  })

  test('a reached daily cap skips the report call and the check still scores', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'citefox-engine-cap-'))
    const storage = openAppStorage(userData)
    insertProject(storage.db, {
      id: 'proj-1',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    writeProjectProfile(projectDb, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: ['SimpleTexting'],
      market: {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    })
    insertPage(projectDb, page())
    addPageMarket(projectDb, {
      pageId: 'page-1',
      marketId: 'mkt-us',
      addedAt: NOW,
      baselineRunId: null
    })
    insertSnapshot(projectDb, snapshot())
    insertBuyerProfile(projectDb, buyer())
    insertPromptSet(
      projectDb,
      {
        id: 'pset-cap',
        pageId: 'page-1',
        version: 1,
        savedAt: NOW,
        icpId: 'icp-1',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: [prompt('prompt-1', 1, 'Crew', 'How do I alert the crew?', 'mkt-us', 'en')]
      },
      ['TextBolt']
    )
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'Search',
      keychainRef: 'citefox.serpapi.key-1',
      hint: 'ab12',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: null
    })
    const lines: string[] = []
    const secrets = new MemorySecretStore()
    secrets.set('citefox.serpapi.key-1', SECRET)
    let calls = 0
    let sequence = 0
    const engine = createCheckEngine({
      storage,
      secrets,
      logger: createLogger({
        secrets: [SECRET],
        hexKeys: true,
        write: (_level, line) => {
          lines.push(line)
        }
      }),
      http: {
        async request(): Promise<HttpResponse> {
          const parsed = JSON.parse(
            readFileSync(join(SERP, 'google-ai-overview.json'), 'utf8')
          ) as {
            status: number
            body: unknown
          }
          return { status: parsed.status, body: JSON.stringify(parsed.body) }
        }
      },
      now: () => new Date(NOW),
      createId: () => {
        sequence += 1
        return `cap-${sequence}`
      },
      emitProgress: () => undefined,
      emitFinished: () => undefined,
      knownSecrets: () => [SECRET],
      generationCaps: { daily: 0, monthly: null },
      claude: {
        id: 'claude-code',
        async complete(): Promise<never> {
          calls += 1
          throw new Error(SECRET)
        }
      }
    })
    const job = await engine.start({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    await engine.reportsIdle()
    expect(job.status).toBe('finished')
    expect(calls).toBe(0)
    const results = engine.results({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(typeof results.run?.visibilityScore).toBe('number')
    const logged = lines.join('\n')
    expect(logged).toContain('The daily CiteFox AI cap is reached')
    expect(logged).not.toContain(SECRET)
    closeProjectDatabase(projectDb)
    storage.close()
    rmSync(userData, { recursive: true, force: true })
  })
})

describe('check reports off the job path', () => {
  test('the job finishes before Claude answers, and the files land afterwards', async () => {
    const claude = blocking(provider('aio-gap.json'))
    const { checkEngine, storage, projectDb } = await seed({
      progress: [],
      claude: claude.provider,
      http: () => envelope('google-competitor.json')
    })
    const job = await checkEngine.start({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    await until(() => claude.pending() === 1)
    const runId = listStoredCheckRuns(projectDb, runFilter())[0]?.id ?? ''
    const root = checkReportsRoot(storage.paths.root)
    expect(existsSync(runSummaryPath(root, 'proj-1', runId))).toBe(false)
    claude.release()
    await until(() => claude.pending() === 1)
    claude.release()
    // The answer-shape call comes after both report files are written.
    await until(() => claude.pending() === 1)
    expect(read(aioGapPath(root, 'proj-1', runId))).toContain('Template: aio_gap.md')
    expect(read(runSummaryPath(root, 'proj-1', runId))).toContain('Template: run_summary.md')
    expect(listAnswerShapeHashes(projectDb)).toEqual([])
    claude.release()
    await checkEngine.reportsIdle()
    expect(claude.calls()).toBe(3)
    expect(listAnswerShapeHashes(projectDb)).toEqual([
      overviewHash('Several vendors offer business texting.')
    ])
  })

  test('a failed answer-shape step leaves the check report files in place', async () => {
    const inner = provider('aio-gap.json')
    let shapeCalls = 0
    const { checkEngine, storage, projectDb } = await seed({
      progress: [],
      claude: {
        id: inner.id,
        async complete(request) {
          if (request.schema !== ANSWER_SHAPE_SCHEMA) return inner.complete(request)
          shapeCalls += 1
          throw new Error(SECRET)
        }
      },
      http: () => envelope('google-competitor.json')
    })
    const job = await checkEngine.start({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    await checkEngine.reportsIdle()
    expect(job.status).toBe('finished')
    expect(shapeCalls).toBeGreaterThan(0)
    const runId = listStoredCheckRuns(projectDb, runFilter())[0]?.id ?? ''
    const root = checkReportsRoot(storage.paths.root)
    expect(read(aioGapPath(root, 'proj-1', runId))).toContain('Template: aio_gap.md')
    expect(read(runSummaryPath(root, 'proj-1', runId))).toContain('Template: run_summary.md')
    expect(listAnswerShapeHashes(projectDb)).toEqual([])
  })

  test('cancel after the searches stops the report and writes no files', async () => {
    const claude = blocking(provider('aio-gap.json'))
    const { checkEngine, storage, projectDb } = await seed({
      progress: [],
      claude: claude.provider,
      http: () => envelope('google-competitor.json')
    })
    const job = await checkEngine.start({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    await until(() => claude.pending() === 1)
    const cancelled = await checkEngine.cancel(job.id)
    expect(cancelled.status).toBe('finished')
    claude.release()
    await checkEngine.reportsIdle()
    expect(claude.calls()).toBe(1)
    const runId = listStoredCheckRuns(projectDb, runFilter())[0]?.id ?? ''
    const root = checkReportsRoot(storage.paths.root)
    expect(existsSync(aioGapPath(root, 'proj-1', runId))).toBe(false)
    expect(existsSync(runSummaryPath(root, 'proj-1', runId))).toBe(false)
  })

  test('a cancelled job writes no report for markets it finished', async () => {
    const claude = blocking(provider('aio-gap.json'))
    const gate = createGate()
    let block = false
    const { checkEngine, projectDb } = await seed({
      progress: [],
      secondPage: true,
      claude: claude.provider,
      beforeRequest: () => (block ? gate.beforeRequest() : Promise.resolve()),
      http: () => {
        block = true
        return envelope('google-competitor.json')
      }
    })
    const pending = checkEngine.start({
      projectId: 'proj-1',
      pageIds: ['page-1', 'page-2'],
      marketIds: null,
      promptIds: null
    })
    await until(() => gate.pending() === 1)
    const jobId = checkEngine.listActive('proj-1')[0]?.id ?? ''
    const cancelling = checkEngine.cancel(jobId)
    gate.release()
    expect((await cancelling).status).toBe('cancelled')
    await pending
    await checkEngine.reportsIdle()
    expect(claude.calls()).toBe(0)
    expect(listStoredCheckRuns(projectDb, runFilter()).map((run) => run.status)).toEqual([
      'finished'
    ])
  })
})

function blocking(inner: ClaudeProvider): {
  provider: ClaudeProvider
  release: () => void
  pending: () => number
  calls: () => number
} {
  const waiters: Array<() => void> = []
  let calls = 0
  return {
    provider: {
      id: inner.id,
      async complete(request) {
        calls += 1
        await new Promise<void>((resolve) => waiters.push(resolve))
        return inner.complete(request)
      }
    },
    release() {
      waiters.shift()?.()
    },
    pending: () => waiters.length,
    calls: () => calls
  }
}
