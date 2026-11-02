import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import { ClaudeCallError } from '../providers/claude/call-error'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider,
  LlmCallTrace
} from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { listLlmCalls, type LlmCallRow } from '../storage/llm-calls'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { storageCallSink, withCallLog, type LlmCallSink } from './call-log'

const NOW = '2026-10-19T12:00:00.000Z'
const SECRET = 'citefox-known-secret-4411'

const directories: string[] = []
const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const TRACE: LlmCallTrace = {
  source: 'pipeline',
  projectId: 'proj-1',
  templateKind: 'buyer_profile',
  templateId: 'tpl-buyer-profile',
  templateHash: 'a'.repeat(64),
  assistId: null
}

function completion(partial: Partial<ClaudeCompletion> = {}): ClaudeCompletion {
  return {
    provider: 'claude-code',
    text: '{}',
    json: {},
    inputTokens: 1,
    outputTokens: 2,
    durationMs: 40,
    model: 'claude-sonnet-5-5',
    resolvedModel: 'claude-sonnet-5-5-20261001',
    usage: { ...emptyClaudeCliUsage(), inputTokens: 120, outputTokens: 30 },
    ...partial
  }
}

function fakeProvider(
  reply: (request: ClaudeCompletionRequest) => Promise<ClaudeCompletion>
): ClaudeProvider & { calls: ClaudeCompletionRequest[] } {
  const calls: ClaudeCompletionRequest[] = []
  return {
    id: 'claude-code',
    calls,
    complete(request) {
      calls.push(request)
      return reply(request)
    }
  }
}

function memorySink(): LlmCallSink & {
  rows: Array<{ row: LlmCallRow; projectId: string | null }>
} {
  const rows: Array<{ row: LlmCallRow; projectId: string | null }> = []
  return {
    rows,
    record(row, projectId) {
      rows.push({ row, projectId })
    }
  }
}

function throwingSink(): LlmCallSink {
  return {
    record() {
      throw new Error('disk full')
    }
  }
}

describe('withCallLog', () => {
  test('a successful call writes one row with the connection, model, tokens, and trace', async () => {
    const sink = memorySink()
    const provider = fakeProvider(async () => completion())
    const logged = withCallLog(provider, sink, { now: () => new Date(NOW) })
    const result = await logged.complete({ prompt: 'p', model: 'claude-sonnet-5-5', trace: TRACE })
    expect(result.text).toBe('{}')
    expect(provider.calls).toHaveLength(1)
    expect(sink.rows).toHaveLength(1)
    const entry = sink.rows[0]
    expect(entry?.projectId).toBe('proj-1')
    expect(entry?.row).toMatchObject({
      connection: 'claude-code',
      model: 'claude-sonnet-5-5-20261001',
      source: 'pipeline',
      templateKind: 'buyer_profile',
      templateId: 'tpl-buyer-profile',
      templateHash: 'a'.repeat(64),
      assistId: null,
      startedAt: NOW,
      durationMs: 40,
      tokensIn: 120,
      tokensOut: 30,
      ok: true,
      error: null
    })
    expect(entry?.row.id.startsWith('llm-')).toBe(true)
  })

  test('falls back to the clock for duration and to completion tokens when usage is empty', async () => {
    const sink = memorySink()
    let tick = 1000
    const provider = fakeProvider(async () =>
      completion({ durationMs: 0, resolvedModel: null, usage: emptyClaudeCliUsage() })
    )
    const logged = withCallLog(provider, sink, {
      now: () => new Date(NOW),
      clock: () => {
        tick += 250
        return tick
      }
    })
    await logged.complete({ prompt: 'p', trace: TRACE })
    expect(sink.rows[0]?.row).toMatchObject({
      model: 'claude-sonnet-5-5',
      durationMs: 250,
      tokensIn: 1,
      tokensOut: 2
    })
  })

  test('a failed call records spent tokens and a redacted error, then rethrows', async () => {
    const sink = memorySink()
    const failure = new ClaudeCallError(
      `Claude rejected the reply for ${SECRET}`,
      { code: 'malformed', state: 'warning', nextStep: null },
      { ...emptyClaudeCliUsage(), inputTokens: 77, outputTokens: 5 },
      'claude-opus-5-5-20261001'
    )
    const provider = fakeProvider(async () => {
      throw failure
    })
    const logged = withCallLog(provider, sink, {
      now: () => new Date(NOW),
      secrets: () => [SECRET]
    })
    await expect(
      logged.complete({ prompt: 'p', model: 'claude-opus-5-5', trace: TRACE })
    ).rejects.toBe(failure)
    expect(sink.rows).toHaveLength(1)
    const row = sink.rows[0]?.row
    expect(row).toMatchObject({
      connection: 'claude-code',
      model: 'claude-opus-5-5-20261001',
      tokensIn: 77,
      tokensOut: 5,
      ok: false,
      source: 'pipeline'
    })
    expect(row?.error).toContain('[REDACTED]')
    expect(row?.error).not.toContain(SECRET)
  })

  test('a plain error records zero tokens and the request model', async () => {
    const sink = memorySink()
    const provider = fakeProvider(async () => {
      throw new Error('spawn failed')
    })
    const logged = withCallLog(provider, sink, { now: () => new Date(NOW) })
    await expect(logged.complete({ prompt: 'p', model: 'claude-haiku-5-5' })).rejects.toThrow(
      'spawn failed'
    )
    expect(sink.rows[0]?.row).toMatchObject({
      model: 'claude-haiku-5-5',
      tokensIn: 0,
      tokensOut: 0,
      ok: false,
      error: 'spawn failed'
    })
  })

  test('wrapping twice returns the same provider and logs each call once', async () => {
    const sink = memorySink()
    const provider = fakeProvider(async () => completion())
    const once = withCallLog(provider, sink)
    const twice = withCallLog(once, sink)
    expect(twice).toBe(once)
    await twice.complete({ prompt: 'p', trace: TRACE })
    expect(sink.rows).toHaveLength(1)
    expect(twice.id).toBe('claude-code')
  })

  test('a sink that throws never fails or repeats a call', async () => {
    const provider = fakeProvider(async () => completion())
    const logged = withCallLog(provider, throwingSink())
    await expect(logged.complete({ prompt: 'p', trace: TRACE })).resolves.toMatchObject({
      text: '{}'
    })
    expect(provider.calls).toHaveLength(1)

    const failing = fakeProvider(async () => {
      throw new Error('upstream down')
    })
    const loggedFailing = withCallLog(failing, throwingSink())
    await expect(loggedFailing.complete({ prompt: 'p' })).rejects.toThrow('upstream down')
    expect(failing.calls).toHaveLength(1)
  })

  test('an untraced call is logged as source other with no project', async () => {
    const sink = memorySink()
    const logged = withCallLog(
      fakeProvider(async () => completion()),
      sink
    )
    await logged.complete({ prompt: 'p' })
    expect(sink.rows[0]?.projectId).toBeNull()
    expect(sink.rows[0]?.row).toMatchObject({
      source: 'other',
      templateKind: null,
      templateId: null,
      templateHash: null,
      assistId: null
    })
  })
})

describe('storageCallSink', () => {
  function setup(): { storage: AppStorage; projectDb: SqliteDatabase; logs: string[] } {
    const directory = mkdtempSync(join(tmpdir(), 'citefox-call-log-'))
    directories.push(directory)
    const storage = openAppStorage(directory)
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
    closers.push(() => {
      closeProjectDatabase(projectDb)
      storage.close()
    })
    const logs: string[] = []
    return { storage, projectDb, logs }
  }

  function row(partial: Partial<LlmCallRow> = {}): LlmCallRow {
    return {
      id: `llm-${Math.random().toString(36).slice(2)}`,
      connection: 'claude-code',
      model: 'claude-sonnet-5-5',
      source: 'pipeline',
      templateKind: 'buyer_profile',
      templateId: 'tpl-buyer-profile',
      templateHash: 'b'.repeat(64),
      assistId: null,
      startedAt: NOW,
      durationMs: 10,
      tokensIn: 3,
      tokensOut: 4,
      ok: true,
      error: null,
      ...partial
    }
  }

  test('a known project writes to its own file, not app.sqlite', () => {
    const { storage, projectDb, logs } = setup()
    const sink = storageCallSink(storage, createLogger({ write: (_l, line) => logs.push(line) }))
    sink.record(row({ id: 'llm-project' }), 'proj-1')
    const projectRows = listLlmCalls(projectDb, {
      since: null,
      projectId: 'proj-1',
      appTable: false
    })
    expect(projectRows.map((item) => item.id)).toEqual(['llm-project'])
    expect(projectRows[0]?.projectId).toBe('proj-1')
    expect(listLlmCalls(storage.db, { since: null, projectId: null, appTable: true })).toEqual([])
    expect(logs).toEqual([])
  })

  test('no project writes to app.sqlite with a null project id', () => {
    const { storage, projectDb } = setup()
    const sink = storageCallSink(storage, createLogger({ write: () => undefined }))
    sink.record(row({ id: 'llm-app', source: 'playground' }), null)
    const appRows = listLlmCalls(storage.db, { since: null, projectId: null, appTable: true })
    expect(appRows.map((item) => [item.id, item.projectId, item.source])).toEqual([
      ['llm-app', null, 'playground']
    ])
    expect(listLlmCalls(projectDb, { since: null, projectId: 'proj-1', appTable: false })).toEqual(
      []
    )
  })

  test('an unknown project id is kept on the app table', () => {
    const { storage } = setup()
    const sink = storageCallSink(storage, createLogger({ write: () => undefined }))
    sink.record(row({ id: 'llm-gone' }), 'proj-deleted')
    const appRows = listLlmCalls(storage.db, { since: null, projectId: null, appTable: true })
    expect(appRows.map((item) => [item.id, item.projectId])).toEqual([['llm-gone', 'proj-deleted']])
  })

  test('a rejected row is logged as a warning and never thrown', () => {
    const { storage } = setup()
    const logs: string[] = []
    const sink = storageCallSink(
      storage,
      createLogger({ write: (level, line) => logs.push(`${level} ${line}`) })
    )
    expect(() => {
      sink.record(row({ connection: 'x' as unknown as LlmCallRow['connection'] }), null)
    }).not.toThrow()
    expect(logs.some((line) => line.includes('could not record claude call'))).toBe(true)
    expect(listLlmCalls(storage.db, { since: null, projectId: null, appTable: true })).toEqual([])
  })
})
