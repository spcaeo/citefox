import { afterEach, describe, expect, test } from 'vitest'
import type { LlmCallRecord } from '@shared/ipc'
import { cleanupHarness, harness } from '../handlers/test-harness'
import { insertLlmCall, type LlmCallRow } from '../storage/llm-calls'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { summarizeLlmCalls } from './usage'

afterEach(cleanupHarness)

function record(
  partial: Partial<LlmCallRecord> & { id: string; startedAt: string }
): LlmCallRecord {
  return {
    projectId: null,
    connection: 'claude-code',
    model: 'claude-sonnet-5-5',
    source: 'pipeline',
    templateKind: null,
    templateId: null,
    templateHash: null,
    assistId: null,
    durationMs: 1000,
    tokensIn: 10,
    tokensOut: 5,
    ok: true,
    error: null,
    ...partial
  }
}

function row(partial: Partial<LlmCallRow> & { id: string; startedAt: string }): LlmCallRow {
  const full = record(partial)
  return {
    id: full.id,
    connection: full.connection,
    model: full.model,
    source: full.source,
    templateKind: full.templateKind,
    templateId: full.templateId,
    templateHash: full.templateHash,
    assistId: full.assistId,
    startedAt: full.startedAt,
    durationMs: full.durationMs,
    tokensIn: full.tokensIn,
    tokensOut: full.tokensOut,
    ok: full.ok,
    error: full.error
  }
}

describe('summarizeLlmCalls', () => {
  test('counts today and this month, tokens, connections, steps, and errors', () => {
    const rows: LlmCallRecord[] = [
      record({
        id: 'a',
        startedAt: '2026-10-19T08:00:00.000Z',
        templateKind: 'buyer_profile',
        durationMs: 2000,
        tokensIn: 100,
        tokensOut: 50
      }),
      record({
        id: 'b',
        startedAt: '2026-10-19T09:00:00.000Z',
        templateKind: 'buyer_profile',
        durationMs: 4000,
        ok: false,
        error: 'timeout'
      }),
      record({
        id: 'c',
        startedAt: '2026-10-18T09:00:00.000Z',
        connection: 'anthropic-api',
        assistId: 'page.titles',
        templateKind: 'buyer_profile',
        source: 'assist',
        tokensIn: 7,
        tokensOut: 3
      }),
      record({ id: 'd', startedAt: '2026-10-02T09:00:00.000Z', source: 'playground' })
    ]
    const usage = summarizeLlmCalls(rows, {
      dayStart: new Date('2026-10-19T00:00:00.000Z'),
      builtAt: new Date('2026-10-19T12:00:00.000Z')
    })
    expect(usage.builtAt).toBe('2026-10-19T12:00:00.000Z')
    expect(usage.callsToday).toBe(2)
    expect(usage.failedToday).toBe(1)
    expect(usage.callsThisMonth).toBe(4)
    expect(usage.tokensInThisMonth).toBe(100 + 10 + 7 + 10)
    expect(usage.tokensOutThisMonth).toBe(50 + 5 + 3 + 5)
    expect(usage.byConnection).toEqual([
      { connection: 'claude-code', calls: 3, tokensIn: 120, tokensOut: 60 },
      { connection: 'anthropic-api', calls: 1, tokensIn: 7, tokensOut: 3 }
    ])
    expect(usage.byStep).toEqual([
      { step: 'buyer_profile', calls: 2, failed: 1, averageDurationMs: 3000 },
      { step: 'page.titles', calls: 1, failed: 0, averageDurationMs: 1000 },
      { step: 'playground', calls: 1, failed: 0, averageDurationMs: 1000 }
    ])
    expect(usage.recent.map((item) => item.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(usage.recentErrors.map((item) => item.id)).toEqual(['b'])
  })

  test('caps recent at 20 and recent errors at 10, newest first', () => {
    const rows: LlmCallRecord[] = []
    for (let index = 0; index < 30; index += 1) {
      const minute = String(index).padStart(2, '0')
      rows.push(
        record({
          id: `call-${minute}`,
          startedAt: `2026-10-19T10:${minute}:00.000Z`,
          ok: index % 2 === 0,
          error: index % 2 === 0 ? null : 'failed'
        })
      )
    }
    const usage = summarizeLlmCalls(rows, {
      dayStart: new Date('2026-10-19T00:00:00.000Z'),
      builtAt: new Date('2026-10-19T12:00:00.000Z')
    })
    expect(usage.recent).toHaveLength(20)
    expect(usage.recent[0]?.id).toBe('call-29')
    expect(usage.recentErrors).toHaveLength(10)
    expect(usage.recentErrors.map((item) => item.id).slice(0, 2)).toEqual(['call-29', 'call-27'])
    expect(usage.recentErrors.every((item) => !item.ok)).toBe(true)
  })

  test('an empty month is all zeros', () => {
    const usage = summarizeLlmCalls([], {
      dayStart: new Date('2026-10-19T00:00:00.000Z'),
      builtAt: new Date('2026-10-19T12:00:00.000Z')
    })
    expect(usage).toMatchObject({
      callsToday: 0,
      failedToday: 0,
      callsThisMonth: 0,
      tokensInThisMonth: 0,
      tokensOutThisMonth: 0,
      byConnection: [],
      byStep: [],
      recent: [],
      recentErrors: []
    })
  })
})

describe('llm:usage', () => {
  test('reads app.sqlite and every project file, or one project', async () => {
    const { handlers, storage } = harness()
    const first = await handlers['projects:create'](projectBody('TextBolt', 'textbolt.com'))
    const second = await handlers['projects:create'](projectBody('Other', 'other.example'))
    const write = (slug: string, rows: LlmCallRow[]): void => {
      const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
      try {
        for (const item of rows) insertLlmCall(db, item, { table: 'project' })
      } finally {
        closeProjectDatabase(db)
      }
    }
    // Harness clock is 2026-10-19T12:00Z. Rows near noon are today in any time zone.
    write(first.slug, [
      row({ id: 'p1-today', startedAt: '2026-10-19T11:59:00.000Z', templateKind: 'coverage' }),
      row({ id: 'p1-earlier', startedAt: '2026-10-17T12:00:00.000Z', tokensIn: 40 }),
      row({ id: 'p1-last-month', startedAt: '2026-09-10T12:00:00.000Z', tokensIn: 999 })
    ])
    write(second.slug, [
      row({
        id: 'p2-failed',
        startedAt: '2026-10-19T11:58:00.000Z',
        ok: false,
        error: 'timeout'
      })
    ])
    insertLlmCall(
      storage.db,
      row({ id: 'app-playground', startedAt: '2026-10-19T11:57:00.000Z', source: 'playground' }),
      { table: 'app', projectId: null }
    )
    insertLlmCall(
      storage.db,
      row({ id: 'app-tagged', startedAt: '2026-10-19T11:56:00.000Z', source: 'assist' }),
      { table: 'app', projectId: first.id }
    )

    const all = await handlers['llm:usage']({})
    expect(all.callsThisMonth).toBe(5)
    expect(all.callsToday).toBe(4)
    expect(all.failedToday).toBe(1)
    expect(all.tokensInThisMonth).toBe(10 + 40 + 10 + 10 + 10)
    expect(all.recent.map((item) => item.id)).toEqual([
      'p1-today',
      'p2-failed',
      'app-playground',
      'app-tagged',
      'p1-earlier'
    ])
    expect(all.recent.find((item) => item.id === 'p2-failed')?.projectId).toBe(second.id)
    expect(all.recentErrors.map((item) => item.id)).toEqual(['p2-failed'])

    const one = await handlers['llm:usage']({ projectId: first.id })
    expect(one.recent.map((item) => item.id)).toEqual(['p1-today', 'app-tagged', 'p1-earlier'])
    expect(one.callsThisMonth).toBe(3)
    expect(one.failedToday).toBe(0)

    const unknownKey: Record<string, unknown> = { projectId: first.id, extra: 1 }
    await expect(handlers['llm:usage'](unknownKey as { projectId: string })).rejects.toThrow(
      /llm:usage/
    )
  })
})

function projectBody(
  name: string,
  domain: string
): {
  name: string
  domain: string
  includeSubdomains: boolean
  brandNames: string[]
  competitors: string[]
  clientName: null
  country: string
  language: string
  location: null
  device: 'desktop'
} {
  return {
    name,
    domain,
    includeSubdomains: true,
    brandNames: [name],
    competitors: [],
    clientName: null,
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop'
  }
}
