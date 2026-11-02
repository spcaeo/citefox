/** Harness for the setup runner tests: real storage, fake Claude, fake HTTP. Test-only. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeFallback } from '@shared/domain'
import type { AssistProgress, NoticeList, SetupProgress } from '@shared/ipc'
import { createIpcHandlers, type IpcHandlerDeps } from '../handlers'
import { createLogger } from '../logging/logger'
import {
  textboltGapReply,
  TEXTBOLT_PROFILE,
  TEXTBOLT_PROMPTS_EN,
  textboltJinaBody
} from '../pipeline/textbolt-fixture'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { ProviderError } from '../providers/errors'
import type { HttpTransport } from '../providers/http'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { projectDatabasePool } from '../storage/project-db-pool'
import { readProjectOptions, writeProjectOptions } from '../storage/project-options'
import { getProject } from '../storage/records'
import type { EngineHost } from '../engine/host'
import type { SetupRunner } from './runner'

const directories: string[] = []
const closers: Array<() => void> = []
const ORIGINAL_FETCH = globalThis.fetch

export function cleanupRunnerHarness(): void {
  globalThis.fetch = ORIGINAL_FETCH
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export type ClaudeMode = 'ok' | 'limit' | 'bad'

export interface ScriptedClaude extends ClaudeProvider {
  calls: string[]
  mode: ClaudeMode
}

/** Replies from the recorded TextBolt fixtures by prompt text, or a plan limit. */
export function scriptedClaude(): ScriptedClaude {
  const claude: ScriptedClaude = {
    id: 'claude-code',
    calls: [],
    mode: 'ok',
    async complete(request): Promise<ClaudeCompletion> {
      claude.calls.push(request.prompt)
      if (claude.mode === 'limit') {
        throw new ProviderError('Claude Code hit its plan limit.', {
          code: 'plan_limit',
          state: 'warning',
          nextStep: 'Wait for the limit to reset.'
        })
      }
      const json = claude.mode === 'bad' ? { nope: true } : route(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 11,
        outputTokens: 22,
        durationMs: 8,
        model: 'claude-sonnet',
        resolvedModel: 'claude-sonnet',
        usage: { ...emptyClaudeCliUsage(), inputTokens: 101, outputTokens: 55 }
      }
    }
  }
  return claude
}

function route(prompt: string): unknown {
  const gap = textboltGapReply(prompt)
  if (gap !== null) return gap
  if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
  return TEXTBOLT_PROMPTS_EN
}

/** Jina serves the TextBolt page for any URL; a direct fetch fails, so Jina is the fallback. */
export function fixtureHttp(state: { readFails: boolean; requests: string[] }): HttpTransport {
  return {
    async request(request) {
      state.requests.push(request.url)
      if (request.url.startsWith('https://r.jina.ai/')) {
        return state.readFails
          ? { status: 404, body: 'Not found' }
          : { status: 200, body: textboltJinaBody() }
      }
      return { status: 500, body: '' }
    }
  }
}

/** Manual timers: nothing runs until the test calls `fire`. */
export interface ManualTimers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
  pending: () => number[]
  fire: () => void
}

export function manualTimers(): ManualTimers {
  let next = 0
  const queue = new Map<number, { run: () => void; ms: number }>()
  return {
    set(run, ms) {
      next += 1
      queue.set(next, { run, ms })
      return next
    },
    clear(handle) {
      queue.delete(handle as number)
    },
    pending: () => [...queue.values()].map((item) => item.ms),
    fire() {
      const items = [...queue.values()]
      queue.clear()
      for (const item of items) item.run()
    }
  }
}

export interface RunnerHarness {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  runner: SetupRunner
  host: EngineHost
  claude: ScriptedClaude
  http: { readFails: boolean; requests: string[] }
  progress: SetupProgress[]
  notices: NoticeList[]
  /** Live `assist:progress` steps the runner pushed. */
  assistProgress: AssistProgress[]
  /** Pages the runner started a first check for ("check automatically when ready"). */
  firstChecks: Array<{ projectId: string; pageId: string }>
  timers: ManualTimers
  clock: { now: number }
  projectId: string
  slug: string
  db: () => SqliteDatabase
  /** Adds pages through `pages:add` (status `setting_up`), tracked `ageMs` ago. */
  addPages: (count: number, options?: { ageMs?: number; prefix?: string }) => Promise<string[]>
  setFallback: (fallback: ClaudeFallback) => void
}

export const START = Date.parse('2026-10-19T12:00:00.000Z')
export const HOUR = 60 * 60_000

export async function runnerHarness(
  overrides: Partial<IpcHandlerDeps> = {}
): Promise<RunnerHarness> {
  globalThis.fetch = (() => {
    throw new Error('network')
  }) as typeof fetch
  const directory = mkdtempSync(join(tmpdir(), 'citefox-setup-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  // One page at a time unless a test raises it, so the order is fixed.
  storage.writeSettings({ ...storage.readSettings(), claudeConcurrency: 1 })
  const registry = new SecretRegistry()
  const logger = createLogger({ write: () => undefined, secrets: () => registry.list() })
  const claude = scriptedClaude()
  const http = { readFails: false, requests: [] as string[] }
  const progress: SetupProgress[] = []
  const notices: NoticeList[] = []
  const assistProgress: AssistProgress[] = []
  const firstChecks: Array<{ projectId: string; pageId: string }> = []
  const timers = manualTimers()
  const clock = { now: START }
  let sequence = 0
  let runner: SetupRunner | undefined
  let host: EngineHost | undefined
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage,
    secrets: new MemorySecretStore(registry),
    logger,
    http: fixtureHttp(http),
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: (channel, payload) => {
      if (channel === 'setup:progress') progress.push(payload as SetupProgress)
      if (channel === 'notices:changed') notices.push(payload as NoticeList)
      if (channel === 'assist:progress') assistProgress.push(payload as AssistProgress)
    },
    knownSecrets: () => registry.list(),
    now: () => new Date(clock.now),
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    claude,
    pageDns: {
      async lookup() {
        return ['93.184.216.34']
      }
    },
    setupRunner: {
      timers,
      timeZone: () => 'UTC',
      startFirstCheck: (projectId, pageId) => {
        firstChecks.push({ projectId, pageId })
      }
    },
    onSetupRunner: (created) => {
      runner = created
    },
    onHost: (opened) => {
      host = opened
    },
    ...overrides
  })
  if (runner === undefined || host === undefined) throw new Error('no setup runner')
  const project = await handlers['projects:create']({
    name: 'TextBolt',
    domain: 'textbolt.com',
    includeSubdomains: true,
    brandNames: ['TextBolt', 'Text Bolt'],
    competitors: ['Twilio'],
    clientName: null,
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop'
  })
  const record = getProject(storage.db, project.id)
  if (record === null) throw new Error('no project')
  const db = (): SqliteDatabase => projectDatabasePool(storage).get(record.slug)
  let pageNumber = 0
  return {
    handlers,
    storage,
    runner,
    host,
    claude,
    http,
    progress,
    notices,
    assistProgress,
    firstChecks,
    timers,
    clock,
    projectId: project.id,
    slug: record.slug,
    db,
    async addPages(count, options) {
      const ids: string[] = []
      const saved = clock.now
      clock.now -= options?.ageMs ?? HOUR
      for (let index = 0; index < count; index += 1) {
        pageNumber += 1
        const page = await handlers['pages:add']({
          projectId: project.id,
          url: `https://textbolt.com/${options?.prefix ?? 'blog'}/page-${pageNumber}/`,
          markets: [],
          intervalDays: 14,
          samples: 1,
          promptCount: 10
        })
        ids.push(page.id)
        clock.now += 1000
      }
      clock.now = saved
      return ids
    },
    setFallback(fallback) {
      const options = readProjectOptions(db())
      writeProjectOptions(db(), { ...options, claude: { ...options.claude, fallback } })
    }
  }
}

/** Lets queued promise callbacks run. */
export async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve))
}
