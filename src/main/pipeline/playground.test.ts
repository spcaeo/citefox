import { afterEach, describe, expect, test } from 'vitest'
import { PLAYGROUND_COMPARE_LIMIT, PLAYGROUND_MEMORY_RUNS } from '@shared/domain'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import {
  PlaygroundMemory,
  runPlayground,
  type PlaygroundModelReply,
  type PlaygroundPage
} from './playground'
import {
  TemplateContractError,
  createGenerationTemplate,
  deleteGenerationTemplate,
  seedShippedTemplates
} from './templates'

const databases: SqliteDatabase[] = []
const NOW = '2026-10-19T12:00:00.000Z'

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('playground compare', () => {
  test('returns one run per template, in order, and falls back to the kind default', async () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    const seeded = seedShippedTemplates(db, () => NOW)
    const coverage = seeded.find((template) => template.kind === 'buyer_prompts')
    if (coverage === undefined) throw new Error('missing buyer prompts template')
    const copy = createGenerationTemplate(
      db,
      { kind: 'buyer_prompts', name: 'Strict prompts', fromId: coverage.id },
      { id: 'tpl-strict', now: NOW }
    )
    const memory = new PlaygroundMemory()
    const runs = await runPlayground({
      db,
      request: {
        url: 'https://example.com/pricing',
        templateIds: [copy.id, coverage.id],
        overrides: { body: null, promptCount: 4, brandName: 'TextBolt' }
      },
      readPage: page,
      complete: reply,
      promptCount: 10,
      createId: sequence(),
      memory
    })
    expect(runs.map((run) => run.templateName)).toEqual(['Strict prompts', 'CiteFox default'])
    expect(runs[0]?.templateId).toBe('tpl-strict')
    expect(runs[0]?.renderedPrompt).toContain('TextBolt')
    expect(runs[0]?.renderedPrompt).toContain('Pricing')
    expect(runs[0]?.templateHash).toBe(coverage.templateHash)
    expect(runs[1]?.templateUpdatedAt).toBeNull()
    expect(runs).toHaveLength(2)
    expect(memory.recent()).toHaveLength(2)

    const fallback = await runPlayground({
      db,
      request: { url: 'https://example.com/pricing', kind: 'buyer_profile', overrides: null },
      readPage: page,
      complete: reply,
      promptCount: 10,
      createId: sequence(),
      memory
    })
    expect(fallback).toHaveLength(1)
    expect(fallback[0]?.templateId).toBe('tpl-buyer-profile')
    expect(fallback[0]?.templateName).toBe('CiteFox default')
  })

  test('rejects a bad selection and does not count the runs as saved usage', async () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    const seeded = seedShippedTemplates(db, () => NOW)
    const profile = seeded.find((template) => template.kind === 'buyer_profile')
    const prompts = seeded.find((template) => template.kind === 'buyer_prompts')
    if (profile === undefined || prompts === undefined) throw new Error('missing template')
    const memory = new PlaygroundMemory()
    const request = {
      url: 'https://example.com/pricing',
      overrides: null
    }
    await expect(
      runPlayground({
        db,
        request: { ...request, templateId: profile.id, templateIds: [profile.id] },
        readPage: page,
        complete: reply,
        promptCount: 1,
        createId: sequence(),
        memory
      })
    ).rejects.toMatchObject({ code: 'selection_conflict' })
    await expect(
      runPlayground({
        db,
        request: { ...request },
        readPage: page,
        complete: reply,
        promptCount: 1,
        createId: sequence(),
        memory
      })
    ).rejects.toMatchObject({ code: 'selection_required' })
    await expect(
      runPlayground({
        db,
        request: {
          ...request,
          templateIds: Array.from({ length: PLAYGROUND_COMPARE_LIMIT + 1 }, () => profile.id)
        },
        readPage: page,
        complete: reply,
        promptCount: 1,
        createId: sequence(),
        memory
      })
    ).rejects.toMatchObject({ code: 'compare_limit' })
    await expect(
      runPlayground({
        db,
        request: { ...request, templateIds: [profile.id, prompts.id] },
        readPage: page,
        complete: reply,
        promptCount: 1,
        createId: sequence(),
        memory
      })
    ).rejects.toMatchObject({ code: 'kind_mismatch' })
    const copy = createGenerationTemplate(
      db,
      { kind: 'buyer_profile', name: 'Gone', fromId: profile.id },
      { id: 'tpl-gone', now: NOW }
    )
    deleteGenerationTemplate(db, copy.id, NOW)
    await expect(
      runPlayground({
        db,
        request: { ...request, templateId: copy.id },
        readPage: page,
        complete: reply,
        promptCount: 1,
        createId: sequence(),
        memory
      })
    ).rejects.toBeInstanceOf(TemplateContractError)
    expect(memory.recent()).toHaveLength(0)

    const capped = new PlaygroundMemory(PLAYGROUND_MEMORY_RUNS)
    for (let index = 0; index < PLAYGROUND_MEMORY_RUNS + 1; index += 1) {
      await runPlayground({
        db,
        request: { ...request, templateId: profile.id },
        readPage: page,
        complete: reply,
        promptCount: 1,
        createId: sequence(),
        memory: capped
      })
    }
    expect(capped.recent()).toHaveLength(PLAYGROUND_MEMORY_RUNS)
  })

  test('rejects an answer-shape template before reading the page', async () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    let reads = 0
    const memory = new PlaygroundMemory()
    for (const request of [{ kind: 'answer_shape' as const }, { templateId: 'tpl-answer-shape' }]) {
      const rejected = runPlayground({
        db,
        request: { url: 'https://example.com/pricing', overrides: null, ...request },
        readPage: (url) => {
          reads += 1
          return page(url)
        },
        complete: reply,
        promptCount: 1,
        createId: sequence(),
        memory
      })
      await expect(rejected).rejects.toBeInstanceOf(TemplateContractError)
      await expect(rejected).rejects.toMatchObject({ code: 'playground_kind' })
    }
    expect(reads).toBe(0)
    expect(memory.recent()).toHaveLength(0)
  })

  test('renders the outline, FAQs, and last-modified date from the read page', async () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    const runs = await runPlayground({
      db,
      request: {
        url: 'https://example.com/pricing',
        kind: 'buyer_profile',
        overrides: {
          body: '{{ outline }}|{{ faqs }}|{{ last_modified }}',
          promptCount: null,
          brandName: null
        }
      },
      readPage: async (url) => ({
        ...(await page(url)),
        outline: [{ level: 'h2', text: 'Plans', table: true }],
        faqs: [{ question: 'Is there a free plan?', answer: 'Yes.', typo: null }],
        modifiedAt: '2026-10-16T09:00:00Z',
        publishedAt: null
      }),
      complete: reply,
      promptCount: 1,
      createId: sequence(),
      memory: new PlaygroundMemory()
    })
    expect(runs[0]?.renderedPrompt).toBe(
      'H2: Plans (has a table)|FAQ 1. Q: Is there a free plan?\nA: Yes.|2026-10-16T09:00:00Z'
    )
    expect(runs[0]?.warnings).toEqual([])
  })

  test('rejects an override body with code in it before reading the page', async () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    const globals = globalThis as { citefoxTemplatePwned?: unknown }
    delete globals.citefoxTemplatePwned
    let reads = 0
    await expect(
      runPlayground({
        db,
        request: {
          url: 'https://example.com/pricing',
          kind: 'buyer_profile',
          overrides: {
            body: "{{ constructor.constructor('globalThis.citefoxTemplatePwned = 1')() }}",
            promptCount: null,
            brandName: null
          }
        },
        readPage: (url) => {
          reads += 1
          return page(url)
        },
        complete: reply,
        promptCount: 1,
        createId: sequence(),
        memory: new PlaygroundMemory()
      })
    ).rejects.toMatchObject({ code: 'syntax', channel: 'playground:run' })
    expect(reads).toBe(0)
    expect(globals.citefoxTemplatePwned).toBeUndefined()
  })
})

function page(url: string): Promise<PlaygroundPage> {
  return Promise.resolve({
    url,
    title: 'Pricing',
    metaDescription: 'Plans',
    h1: 'Pricing',
    pageText: 'A public pricing page.'
  })
}

function reply(prompt: string): Promise<PlaygroundModelReply> {
  return Promise.resolve({
    text: `out:${prompt.length}`,
    resolvedModel: 'claude-test',
    usage: {
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      serpapiSearches: 0
    },
    durationMs: 5
  })
}

function sequence(): () => string {
  let n = 0
  return () => {
    n += 1
    return `run-${n}`
  }
}
