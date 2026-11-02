import { afterEach, describe, expect, test } from 'vitest'
import {
  ASSISTANT_TEMPLATE_KINDS,
  TOPIC_TEMPLATE_KINDS,
  templateKindLifecycle
} from '@shared/domain'
import { cleanupHarness, harness } from './test-harness'

afterEach(cleanupHarness)

describe('IPC handlers: templates and playground', () => {
  test('templates channels seed the shipped defaults and playground:run returns one result per template', async () => {
    let reads = 0
    const { handlers } = harness({
      readPlaygroundPage: async (url) => {
        reads += 1
        return { url, title: 'Hello', metaDescription: '', h1: 'H', pageText: 'Body' }
      },
      completePlayground: async (prompt) => ({
        text: `model:${prompt.slice(0, 12)}`,
        resolvedModel: 'claude-test',
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          serpapiSearches: 0
        },
        durationMs: 4
      })
    })
    const listed = await handlers['templates:list']({})
    expect(listed.map((template) => template.kind)).toEqual([
      'buyer_profile',
      'buyer_prompts',
      'brand_prompts',
      'coverage',
      'coverage_matrix',
      'page_audit',
      'coverage_fixes',
      'aio_gap',
      'answer_shape',
      'sentiment_claims',
      'sentiment_claims_v2',
      'sentiment_fact_check',
      'video_brief',
      'run_summary',
      ...TOPIC_TEMPLATE_KINDS.filter((kind) => templateKindLifecycle(kind) !== 'planned'),
      ...ASSISTANT_TEMPLATE_KINDS
    ])
    const coverage = listed.find((template) => template.kind === 'coverage_matrix')
    expect(listed.every((template) => template.isShipped && template.isDefault)).toBe(true)
    const created = await handlers['templates:create']({
      kind: 'coverage_matrix',
      name: 'My coverage',
      fromId: coverage?.id
    })
    expect(created.isShipped).toBe(false)
    expect(created.isDefault).toBe(false)
    const runs = await handlers['playground:run']({
      url: 'https://example.com/page',
      templateIds: [coverage?.id ?? '', created.id],
      overrides: null
    })
    expect(runs.map((run) => run.templateName)).toEqual(['CiteFox default', 'My coverage'])
    expect(runs[0]?.renderedPrompt.includes('Hello')).toBe(true)
    expect(reads).toBe(1)
    await expect(
      handlers['playground:run']({
        url: 'https://example.com/page',
        templateId: created.id,
        templateIds: [created.id],
        overrides: null
      })
    ).rejects.toThrow(/templateId or templateIds/)
    const usage = await handlers['templates:usage']({ id: created.id })
    expect(usage).toEqual({
      templateId: created.id,
      buyerProfiles: 0,
      promptSets: 0,
      coverageMatrices: 0,
      lastUsedAt: null
    })
  })
})
