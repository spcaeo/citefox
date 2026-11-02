import { afterEach, describe, expect, test } from 'vitest'
import {
  ASSISTANT_TEMPLATE_KINDS,
  TOPIC_TEMPLATE_KINDS,
  templateKindLifecycle
} from '@shared/domain'
import { openAppDatabase } from '../../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../../storage/database'
import { ANSWER_SHAPE_TEMPLATE as REEXPORTED } from '../../pipeline/template-bodies'
import {
  listGenerationTemplates,
  loadGenerationTemplate,
  renderTemplate,
  templateHash,
  unknownVariables
} from '../../pipeline/templates'
import {
  answerShapeBlocks,
  answerShapeSchemaError,
  ANSWER_SHAPE_EXCERPT_MAX,
  ANSWER_SHAPE_MAX_BLOCKS,
  ANSWER_SHAPE_SCHEMA
} from './schema'
import { ANSWER_SHAPE_TEMPLATE } from './template-body'
import { ANSWER_SHAPE_CODES, ANSWER_SHAPE_GROUPS, ANSWER_SHAPE_LABELS } from './vocabulary'

const OVERVIEW =
  'You can text employees without a developer by turning email from tools you already use into SMS. ' +
  'Carrier email-to-text gateways are shutting down, so “old” alerts stop arriving.'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('answer shape schema', () => {
  test('a long excerpt passes and is clipped at a space, still copied from the overview', () => {
    // Live Claude wrote a 168-character excerpt for a 160 limit. Claude Code enforces the
    // JSON schema inside its one turn, so a maxLength there failed the whole call.
    const blocks = ANSWER_SHAPE_SCHEMA.properties as {
      blocks: { items: { properties: { excerpt: Record<string, unknown> } } }
    }
    const excerpts = blocks.blocks.items.properties.excerpt
    expect(excerpts.maxLength).toBeUndefined()
    const long = OVERVIEW.slice(0, 168)
    const reply = { blocks: [{ code: 'A1', excerpt: long }] }
    expect(answerShapeSchemaError(reply, OVERVIEW)).toBeNull()
    const [block] = answerShapeBlocks(reply)
    expect(block?.excerpt.length).toBeLessThanOrEqual(ANSWER_SHAPE_EXCERPT_MAX)
    expect(block?.excerpt.endsWith(' ')).toBe(false)
    expect(OVERVIEW.startsWith(block?.excerpt ?? 'x')).toBe(true)
  })

  test('accepts blocks whose excerpts are in the overview', () => {
    const reply = {
      blocks: [
        { code: 'A1', excerpt: 'You can text employees without a developer' },
        { code: 'D2', excerpt: 'Carrier email-to-text gateways are shutting down' }
      ]
    }
    expect(answerShapeSchemaError(reply, OVERVIEW)).toBeNull()
    expect(answerShapeBlocks(reply).map((block) => block.code)).toEqual(['A1', 'D2'])
  })

  test('matching ignores case, whitespace, curly quotes, and a trailing ellipsis', () => {
    const reply = {
      blocks: [
        { code: 'A1', excerpt: '  you CAN text\n employees…' },
        { code: 'D2', excerpt: 'so "old" alerts stop arriving...' }
      ]
    }
    expect(answerShapeSchemaError(reply, OVERVIEW)).toBeNull()
    expect(answerShapeBlocks(reply)[0]?.excerpt).toBe('you CAN text employees…')
  })

  test('rejects an excerpt that is not in the overview', () => {
    const reply = { blocks: [{ code: 'A1', excerpt: 'TextBolt is the best texting tool' }] }
    expect(answerShapeSchemaError(reply, OVERVIEW)).toBe('An excerpt is not in the overview text.')
    expect(answerShapeSchemaError({ blocks: [{ code: 'A1', excerpt: '...' }] }, OVERVIEW)).toBe(
      'An excerpt is not in the overview text.'
    )
  })

  test('rejects a code outside the vocabulary, extra fields, and bad block counts', () => {
    const bad = [
      { blocks: [{ code: 'G1', excerpt: 'You can text' }] },
      { blocks: [{ code: 'a1', excerpt: 'You can text' }] },
      { blocks: [{ code: 'A1', excerpt: 'You can text', why: 'definition' }] },
      { blocks: [{ code: 'A1', excerpt: '' }] },
      { blocks: [] },
      {
        blocks: Array.from({ length: ANSWER_SHAPE_MAX_BLOCKS + 1 }, () => ({
          code: 'A1',
          excerpt: 'You can text'
        }))
      },
      { blocks: [{ code: 'A1', excerpt: 'You can text' }], extra: true },
      null
    ]
    for (const reply of bad) {
      expect(answerShapeSchemaError(reply, OVERVIEW)).toBe('The reply did not match the schema.')
    }
    // Length is clipped later, not rejected; an excerpt that is not copied is still rejected.
    expect(
      answerShapeSchemaError({ blocks: [{ code: 'A1', excerpt: 'x'.repeat(161) }] }, OVERVIEW)
    ).toBe('An excerpt is not in the overview text.')
  })
})

describe('answer shape template', () => {
  test('lists every code with its label and group, and uses only known variables', () => {
    for (const code of ANSWER_SHAPE_CODES) {
      expect(ANSWER_SHAPE_TEMPLATE).toContain(`- ${code} ${ANSWER_SHAPE_LABELS[code]}:`)
    }
    for (const group of ANSWER_SHAPE_GROUPS) expect(ANSWER_SHAPE_TEMPLATE).toContain(group.label)
    const rendered = renderTemplate(ANSWER_SHAPE_TEMPLATE, {
      prompt_text: 'How do I alert the crew?',
      overview_text: OVERVIEW
    })
    expect(unknownVariables(ANSWER_SHAPE_TEMPLATE, 'answer_shape')).toEqual([])
    expect(rendered.text).toContain('How do I alert the crew?')
    expect(rendered.text).toContain(OVERVIEW)
    expect(REEXPORTED).toBe(ANSWER_SHAPE_TEMPLATE)
  })

  test('is seeded as the shipped, default answer_shape template', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    const template = loadGenerationTemplate(db, 'answer_shape')
    expect(template).toMatchObject({
      id: 'tpl-answer-shape',
      kind: 'answer_shape',
      name: 'CiteFox default',
      isShipped: true,
      isDefault: true,
      body: ANSWER_SHAPE_TEMPLATE,
      templateHash: templateHash(ANSWER_SHAPE_TEMPLATE),
      warnings: []
    })
    expect(template.variables).toEqual(['prompt_text', 'overview_text'])
    const shipped = listGenerationTemplates(db, {}).filter((item) => item.isShipped)
    expect(shipped.map((item) => item.kind)).toEqual([
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
  })
})
