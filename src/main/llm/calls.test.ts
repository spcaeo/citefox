import { afterEach, describe, expect, test } from 'vitest'
import { cleanupHarness, harness } from '../handlers/test-harness'
import { insertLlmCall, type LlmCallRow } from '../storage/llm-calls'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'

afterEach(cleanupHarness)

function row(partial: Partial<LlmCallRow> & { id: string; startedAt: string }): LlmCallRow {
  return {
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

const PROJECT = {
  domain: 'textbolt.com',
  includeSubdomains: true,
  competitors: [],
  clientName: null,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop' as const
}

describe('llm:calls', () => {
  test('lists every call of one template kind, newest first, across projects or one', async () => {
    const { handlers, storage } = harness()
    const first = await handlers['projects:create']({
      ...PROJECT,
      name: 'TextBolt',
      brandNames: ['TextBolt']
    })
    const second = await handlers['projects:create']({
      ...PROJECT,
      name: 'Other',
      domain: 'other.example',
      brandNames: ['Other']
    })
    const write = (slug: string, rows: LlmCallRow[]): void => {
      const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
      try {
        for (const item of rows) insertLlmCall(db, item, { table: 'project' })
      } finally {
        closeProjectDatabase(db)
      }
    }
    write(first.slug, [
      row({ id: 'p1-old', startedAt: '2025-01-02T10:00:00.000Z', templateKind: 'coverage' }),
      row({ id: 'p1-new', startedAt: '2026-10-19T10:00:00.000Z', templateKind: 'coverage' }),
      row({ id: 'p1-other', startedAt: '2026-10-19T11:00:00.000Z', templateKind: 'icp' })
    ])
    write(second.slug, [
      row({
        id: 'p2',
        startedAt: '2026-10-18T10:00:00.000Z',
        templateKind: 'coverage',
        ok: false,
        error: 'timeout'
      })
    ])

    const all = await handlers['llm:calls']({ templateKind: 'coverage' })
    expect(all.total).toBe(3)
    expect(all.calls.map((call) => call.id)).toEqual(['p1-new', 'p2', 'p1-old'])
    expect(all.calls.find((call) => call.id === 'p2')?.projectId).toBe(second.id)

    const one = await handlers['llm:calls']({ projectId: first.id, templateKind: 'coverage' })
    expect(one.calls.map((call) => call.id)).toEqual(['p1-new', 'p1-old'])
    expect(one.total).toBe(2)

    const bad: Record<string, unknown> = { templateKind: 'nope' }
    await expect(handlers['llm:calls'](bad as { templateKind: string })).rejects.toThrow(
      /llm:calls/
    )
  })
})

describe('templates:usageDetail', () => {
  test('lists the saved artifacts behind templates:usage, one per count', async () => {
    const { handlers } = harness()
    const templates = await handlers['templates:list']({})
    const coverage = templates.find((item) => item.kind === 'coverage' && item.isDefault)
    expect(coverage).toBeDefined()
    if (!coverage) return
    const usage = await handlers['templates:usage']({ id: coverage.id })
    const detail = await handlers['templates:usageDetail']({ id: coverage.id })
    expect(detail.templateId).toBe(coverage.id)
    expect(detail.items.filter((item) => item.kind === 'coverage')).toHaveLength(
      usage.coverageMatrices
    )
    await expect(handlers['templates:usageDetail']({ id: 'missing-template' })).rejects.toThrow(
      /templates:usageDetail/
    )
  })
})
