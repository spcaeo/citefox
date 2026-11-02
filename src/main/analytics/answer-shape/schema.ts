import Ajv from 'ajv'
import { ANSWER_SHAPE_CODES, type AnswerShapeBlock } from './vocabulary'

const ajv = new Ajv({ allErrors: true, strict: false })

/** Longest excerpt a block may carry (Docs/REPORT-SPEC.md section 9). */
export const ANSWER_SHAPE_EXCERPT_MAX = 160

/** Most blocks one overview may be split into. */
export const ANSWER_SHAPE_MAX_BLOCKS = 40

/** The reply to `answer_shape.md`: the overview's blocks in reading order. */
export const ANSWER_SHAPE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['blocks'],
  properties: {
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: ANSWER_SHAPE_MAX_BLOCKS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'excerpt'],
        properties: {
          code: { type: 'string', enum: [...ANSWER_SHAPE_CODES] },
          // No maxLength here: Claude Code enforces this schema inside its single turn
          // (LLM-3), and a model cannot count characters, so a 168-character excerpt
          // failed the whole call. `answerShapeBlocks` clips to ANSWER_SHAPE_EXCERPT_MAX.
          excerpt: { type: 'string', minLength: 1 }
        }
      }
    }
  }
}

const shapeValid = ajv.compile(ANSWER_SHAPE_SCHEMA)

/**
 * Null when the reply matches the schema and every excerpt occurs in the overview
 * text. The match ignores case, whitespace, curly quotes, and a trailing ellipsis,
 * like the `quote_not_on_page` check for coverage.
 */
export function answerShapeSchemaError(value: unknown, overviewText: string): string | null {
  if (!shapeValid(value)) return 'The reply did not match the schema.'
  const overview = comparable(overviewText)
  for (const block of (value as { blocks: AnswerShapeBlock[] }).blocks) {
    const excerpt = comparable(block.excerpt)
    if (excerpt.length === 0 || !overview.includes(excerpt)) {
      return 'An excerpt is not in the overview text.'
    }
  }
  return null
}

/**
 * The blocks of a reply that passed {@link answerShapeSchemaError}, with tidy excerpts
 * of at most ANSWER_SHAPE_EXCERPT_MAX characters. A longer excerpt keeps its opening
 * words, cut at a space, so it is still copied from the overview (no ellipsis).
 */
export function answerShapeBlocks(value: unknown): AnswerShapeBlock[] {
  return (value as { blocks: AnswerShapeBlock[] }).blocks.map((block) => ({
    code: block.code,
    excerpt: clipExcerpt(block.excerpt.replace(/\s+/g, ' ').trim())
  }))
}

function clipExcerpt(text: string): string {
  if (text.length <= ANSWER_SHAPE_EXCERPT_MAX) return text
  const head = text.slice(0, ANSWER_SHAPE_EXCERPT_MAX)
  const space = head.lastIndexOf(' ')
  return (space >= ANSWER_SHAPE_EXCERPT_MAX / 2 ? head.slice(0, space) : head).trimEnd()
}

function comparable(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:\.\.\.|…)$/, '')
    .trim()
    .toLowerCase()
}
