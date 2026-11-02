import { describe, expect, test } from 'vitest'
import { TEMPLATE_VARIABLES, type TemplateVariable } from './templates'
import {
  CHECK_VARIABLES,
  PAGE_VARIABLE_HELP,
  isVariableForKind,
  templateVariablesFor,
  usesGroupedVariables
} from './template-variables'

describe('template variables', () => {
  test('page steps list the flat names with what each holds', () => {
    const page = TEMPLATE_VARIABLES.slice(0, 10)
    const expected: Record<string, readonly string[]> = {
      buyer_profile: [...page, 'business_block', 'product_block', 'market_block'],
      buyer_prompts: [
        ...page,
        'business_block',
        'product_block',
        'market_block',
        'competitor_block'
      ],
      coverage: page,
      coverage_matrix: page,
      page_audit: [...page, 'market_block'],
      coverage_fixes: [...page, 'business_block', 'market_block']
    }
    for (const [kind, names] of Object.entries(expected)) {
      const variables = templateVariablesFor(kind)
      expect(variables.map((item) => item.name)).toEqual(names)
      expect(
        variables.every((item) => item.holds === PAGE_VARIABLE_HELP[item.name as TemplateVariable])
      ).toBe(true)
      expect(usesGroupedVariables(kind)).toBe(false)
    }
  })

  test('check steps list the grouped names', () => {
    for (const kind of ['aio_gap', 'run_summary']) {
      expect(templateVariablesFor(kind)).toBe(CHECK_VARIABLES)
      expect(usesGroupedVariables(kind)).toBe(true)
    }
    const names = CHECK_VARIABLES.map((item) => item.name)
    expect(names).toEqual(
      expect.arrayContaining(['page.url', 'market.country', 'aio.text', 'run.page_cited', 'notes'])
    )
    expect(names).not.toContain('url')
    expect(new Set(names).size).toBe(names.length)
    expect(CHECK_VARIABLES.every((item) => item.holds.length > 0)).toBe(true)
  })

  test('an unknown kind accepts both lists, so its editor never warns on a filled name', () => {
    const names = templateVariablesFor('some_new_step').map((item) => item.name)
    expect(names).toEqual([...TEMPLATE_VARIABLES, ...CHECK_VARIABLES.map((item) => item.name)])
    expect(usesGroupedVariables('brand_prompts')).toBe(false)
    expect(templateVariablesFor('brand_prompts').map((item) => item.name)).toContain('buyer_values')
    expect(templateVariablesFor('sentiment_claims').map((item) => item.name)).toContain('aio_text')
  })

  test('isVariableForKind follows the lists', () => {
    expect(isVariableForKind('buyer_profile', 'title')).toBe(true)
    expect(isVariableForKind('buyer_profile', 'page.title')).toBe(false)
    expect(isVariableForKind('aio_gap', 'page.title')).toBe(true)
    expect(isVariableForKind('aio_gap', 'title')).toBe(false)
    expect(isVariableForKind('run_summary', 'run.content_change')).toBe(true)
    expect(isVariableForKind('video_brief', 'question')).toBe(true)
    expect(isVariableForKind('video_brief', 'page_sections')).toBe(true)
    expect(isVariableForKind('video_brief', 'aio.prompt')).toBe(false)
    expect(isVariableForKind('video_brief', 'made_up')).toBe(false)
  })

  test('the block variables are registered with help, and listed on the steps that fill them', () => {
    const blocks = [
      'business_block',
      'product_block',
      'market_block',
      'buyer_block',
      'competitor_block',
      'stage_rules',
      'mode_rules',
      'evidence'
    ] as const
    for (const name of blocks) {
      expect(TEMPLATE_VARIABLES).toContain(name)
      expect(PAGE_VARIABLE_HELP[name].length).toBeGreaterThan(0)
    }
    // A live step lists a block once its package fills it (P1 the page steps, P3 the
    // journey questions, P6 brand prompts).
    expect(isVariableForKind('brand_prompts', 'product_block')).toBe(true)
    expect(isVariableForKind('brand_prompts', 'market_block')).toBe(true)
    expect(isVariableForKind('brand_prompts', 'competitor_block')).toBe(false)
    expect(isVariableForKind('buyer_profile', 'product_block')).toBe(true)
    expect(isVariableForKind('buyer_profile', 'competitor_block')).toBe(false)
    expect(isVariableForKind('buyer_prompts', 'competitor_block')).toBe(true)
    expect(isVariableForKind('sentiment_claims_v2', 'competitor_block')).toBe(true)
    expect(isVariableForKind('sentiment_claims_v2', 'brand_facts')).toBe(false)
    expect(isVariableForKind('sentiment_fact_check', 'claims')).toBe(true)
    expect(isVariableForKind('page_audit', 'market_block')).toBe(true)
    // P3 fills the blocks of the journey questions.
    expect(isVariableForKind('topic_journey_questions', 'stage_rules')).toBe(true)
    expect(isVariableForKind('topic_journey_questions', 'counts')).toBe(false)
    expect(isVariableForKind('competitor_page_questions_v2', 'stage_rules')).toBe(true)
    expect(isVariableForKind('topic_fix_draft', 'diagnosis')).toBe(true)
  })
})
