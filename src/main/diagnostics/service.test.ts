import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppInfo } from '@shared/ipc'
import { createLogger } from '../logging/logger'
import { appLogFilePath } from '../logging/file-sink'
import {
  addAnswer,
  addGoogle,
  addRun,
  cleanupEngineSeeds,
  openEngineSeed,
  withDb
} from '../handlers/engines.test-helper'
import { PROGRESS_SEED } from '../handlers/progress.test-helper'
import { MemorySecretStore } from '../secrets/secret-store'
import { createDiagnosticsService, type DiagnosticsService, type SystemFacts } from './service'
import { configureDiagnosticsShell } from './shell'

const HOME = '/Users/jane.doe'
const KEY = 'sk-fixture-ABCDEFGHIJKLMNOPQRSTUV-0123456789'
const SERP_SECRET = 'fixture-serpapi-secret-progress'

const SYSTEM: SystemFacts = {
  platform: 'darwin',
  arch: 'arm64',
  osRelease: '25.6.0',
  electron: '39.2.7',
  node: '24.19.0',
  chrome: '142.0.7444.175',
  locale: 'en-CA',
  timeZone: 'America/Toronto'
}

const INFO: AppInfo = {
  name: 'CiteFox',
  version: '0.13.2',
  build: { commit: 'abc1234', number: 1424, builtAt: '2026-11-02T13:49:00.000Z' }
}

afterEach(() => {
  configureDiagnosticsShell(null)
  cleanupEngineSeeds()
})

interface Setup {
  seed: ReturnType<typeof openEngineSeed>
  service: DiagnosticsService
  logFile: string
  secrets: MemorySecretStore
}

function setup(options: { log?: string; cloro?: boolean } = {}): Setup {
  const seed = openEngineSeed({ cloro: options.cloro })
  const logFile = appLogFilePath(seed.storage.paths.root)
  mkdirSync(join(seed.storage.paths.root, 'logs'), { recursive: true })
  if (options.log !== undefined) writeFileSync(logFile, options.log)
  const secrets = new MemorySecretStore()
  // Same ref the seed saved its key under, so the service can read the real secret back.
  secrets.set('citefox.serpapi.progress-key-1', SERP_SECRET)
  const service = createDiagnosticsService({
    storage: seed.storage,
    secrets,
    appInfo: () => INFO,
    logger: createLogger({ write: () => undefined }),
    now: () => new Date('2026-11-03T14:00:00.000Z'),
    system: () => SYSTEM,
    home: () => HOME
  })
  return { seed, service, logFile, secrets }
}

function seedFailures(seed: ReturnType<typeof openEngineSeed>): void {
  withDb(seed, (db) => {
    addRun(db, {
      id: 'run-a',
      startedAt: '2026-11-03T10:00:00.000Z',
      engines: ['google_aio', 'chatgpt']
    })
    addGoogle(db, 'run-a', 'prompt-1', 1, 'error', {
      errorCode: 'rate_limited',
      message: 'Search for "Crew alerts" was refused at 10.1.2.3'
    })
    addGoogle(db, 'run-a', 'prompt-2', 1, 'not_cited')
    addAnswer(db, 'run-a', 'prompt-1', 'chatgpt', 'error', 1, {
      errorCode: 'timeout',
      message: 'timed out for jane@example.com',
      checkedAt: '2026-11-03T10:05:00.000Z'
    })
    addAnswer(db, 'run-a', 'prompt-3', 'perplexity', 'cited')
  })
}

describe('the problem report', () => {
  it('lists the app, the computer, the AI program, the keys and the log, with no key', () => {
    const { service } = setup({ log: 'one\ntwo\nthree\n', cloro: true })
    const report = service.build({
      includeQuestions: false,
      note: 'The checks all failed',
      projectId: null
    })
    expect(report.text).toContain('CiteFox problem report')
    expect(report.text).toContain('The checks all failed')
    expect(report.text).toContain('Release: v0.13.2 · build 1424 · Nov 2, 2026 8:49 AM EST')
    expect(report.text).toContain('System: darwin arm64, version 25.6.0')
    expect(report.text).toContain('Time zone: America/Toronto')
    expect(report.text).toContain('Connection: Claude Code')
    expect(report.text).toContain('Google search key: yes')
    expect(report.text).toContain('CiteFox credits key: yes')
    expect(report.text).toContain('Page reader key: no')
    expect(report.text).toContain('one\ntwo\nthree')
    expect(report.release).toBe('v0.13.2 · build 1424 · Nov 2, 2026 8:49 AM EST')
    expect(report.lines).toBe(report.text.split('\n').length)
    expect(report.bytes).toBe(Buffer.byteLength(report.text))
  })

  it('never names a provider and never shows a key, a key hint or a key path', () => {
    const { service } = setup({ cloro: true })
    const { text } = service.build({ includeQuestions: true, note: '', projectId: null })
    expect(text).not.toMatch(/cloro|serpapi|jina|anthropic/i)
    expect(text).not.toContain(SERP_SECRET)
    expect(text).not.toContain('cl01')
    expect(text).not.toContain('citefox.serpapi')
  })

  it('removes a configured key wherever it shows up: the log, the note and the failure messages', () => {
    const { service, seed } = setup({
      log: `fetch failed with ${SERP_SECRET}\nBearer ${KEY}\nnext`
    })
    seedFailures(seed)
    withDb(seed, (db) => {
      db.prepare(`UPDATE serp_results SET message = ? WHERE status = 'error'`).run(
        `bad key ${SERP_SECRET}`
      )
    })
    const { text } = service.build({
      includeQuestions: true,
      note: `my key is ${SERP_SECRET} and ${KEY}`,
      projectId: PROGRESS_SEED.projectId
    })
    expect(text).not.toContain(SERP_SECRET)
    expect(text).not.toContain(KEY)
    expect(text).toContain('[REDACTED]')
  })

  it('cuts the log to the last 300 lines', () => {
    const lines = Array.from({ length: 500 }, (_, index) => `log entry ${index + 1}`)
    const { service } = setup({ log: `${lines.join('\n')}\n` })
    const { text } = service.build({ includeQuestions: false, note: '', projectId: null })
    expect(text).toContain('log entry 500')
    expect(text).toContain('log entry 201')
    expect(text).not.toContain('log entry 200\n')
    expect(text).toContain('## Log (last 300 lines)')
  })

  it('hides the home folder, emails and IP addresses found in the log and the note', () => {
    const { service } = setup({
      log: '[warn] open /Users/jane.doe/Library/x failed for jane@example.com from 192.168.0.9\n'
    })
    const { text } = service.build({
      includeQuestions: false,
      note: 'I am jane@example.com at /Users/jane.doe',
      projectId: null
    })
    expect(text).not.toContain('jane.doe')
    expect(text).not.toContain('jane@example.com')
    expect(text).not.toContain('192.168.0.9')
    expect(text).toContain('~/Library/x')
  })

  it('shows only the program file name, never its folder', () => {
    const { service, seed } = setup()
    seed.storage.writeSettings({
      ...seed.storage.readSettings(),
      claudeBinaryPath: '/usr/local/bin/claude'
    })
    const { text } = service.build({ includeQuestions: false, note: '', projectId: null })
    expect(text).toContain('Program file: claude')
    expect(text).not.toContain('/usr/local/bin')
  })

  it('lists failed checks with engine, reason and time, and leaves the question texts out by default', () => {
    const { service, seed } = setup()
    seedFailures(seed)
    const off = service.build({
      includeQuestions: false,
      note: '',
      projectId: PROGRESS_SEED.projectId
    })
    expect(off.text).toContain('## Recent failed checks')
    expect(off.text).toContain('Google AI Overview | rate_limited')
    expect(off.text).toContain('ChatGPT | timeout')
    expect(off.text).toContain('2026-11-03T10:05:00.000Z')
    expect(off.text).toContain('Search for "[question]" was refused')
    expect(off.text).not.toContain('Crew alerts')
    expect(off.text).toContain('Question texts: not included.')
    expect(off.text).not.toContain('10.1.2.3')
    expect(off.text).not.toContain('jane@example.com')

    const on = service.build({
      includeQuestions: true,
      note: '',
      projectId: PROGRESS_SEED.projectId
    })
    expect(on.text).toContain('question: Crew alerts')
    expect(on.text).toContain('Question texts: included')
  })

  it('reads every project when no project is named, and says so when nothing failed', () => {
    const { service, seed } = setup()
    const empty = service.build({ includeQuestions: false, note: '', projectId: null })
    expect(empty.text).toContain('No failed checks are stored.')
    seedFailures(seed)
    const all = service.build({ includeQuestions: false, note: '', projectId: null })
    expect(all.text).toContain('rate_limited x 1')
    // An unknown project id reads every project instead of failing.
    const unknown = service.build({ includeQuestions: false, note: '', projectId: 'nope-1' })
    expect(unknown.text).toContain('rate_limited x 1')
  })

  it('handles a missing log folder', () => {
    const { service, seed } = setup()
    rmSync(join(seed.storage.paths.root, 'logs'), { recursive: true, force: true })
    const { text } = service.build({ includeQuestions: false, note: '', projectId: null })
    expect(text).toContain('(the log is empty)')
  })
})

describe('save, logs folder and mail', () => {
  it('asks the person where to save and writes the report again without secrets', async () => {
    const { service } = setup()
    const dir = mkdtempSync(join(tmpdir(), 'citefox-save-'))
    const target = join(dir, 'report.txt')
    const { configureTransferDialogs } = await import('../project-transfer/dialogs')
    configureTransferDialogs({
      open: () => Promise.resolve({ canceled: true, filePaths: [] }),
      save: () => Promise.resolve({ canceled: false, filePath: target })
    })
    try {
      const result = await service.save({ text: `hello ${KEY} /Users/jane.doe/x` })
      expect(result).toEqual({ saved: true, filename: 'report.txt' })
      const { readFileSync } = await import('node:fs')
      const written = readFileSync(target, 'utf8')
      expect(written).not.toContain(KEY)
      expect(written).toContain('~/x')
      configureTransferDialogs({
        open: () => Promise.resolve({ canceled: true, filePaths: [] }),
        save: () => Promise.resolve({ canceled: true })
      })
      expect(await service.save({ text: 'x' })).toEqual({ saved: false })
    } finally {
      configureTransferDialogs(null)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('opens a short mail link only, after taking secrets and emails out of the note', async () => {
    const { service } = setup()
    const opened: string[] = []
    configureDiagnosticsShell((url) => {
      opened.push(url)
      return Promise.resolve()
    })
    const result = await service.openMail({ note: `It broke. My key ${KEY}, me@x.io` })
    expect(result).toEqual({ ok: true })
    expect(opened).toHaveLength(1)
    const url = opened[0] ?? ''
    expect(url.startsWith('mailto:getcitifox@gmail.com?subject=')).toBe(true)
    expect(url.length).toBeLessThan(2000)
    const decoded = decodeURIComponent(url)
    expect(decoded).not.toContain(KEY)
    expect(decoded).not.toContain('me@x.io')
    expect(decoded).toContain('Paste the full report below this line')
  })

  it('says so when no mail program can be opened', async () => {
    const { service } = setup()
    expect(await service.openMail({ note: '' })).toMatchObject({ ok: false })
    configureDiagnosticsShell(() => Promise.reject(new Error('no handler')))
    expect(await service.openMail({ note: '' })).toMatchObject({ ok: false })
  })
})
