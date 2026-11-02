import { TOPIC_PROFILE_SECTIONS, TOPIC_STAGES } from '@shared/domain'

/**
 * JSON-schema helpers the topic step schemas share (Docs/TOPICS-SPEC.md section 6).
 * Every object is closed (`additionalProperties: false`) and requires every field,
 * as Claude Code's structured output expects. Key order is part of the stored
 * schema text, so a helper never reorders properties.
 */

export const text = (max: number): Record<string, unknown> => ({
  type: 'string',
  minLength: 1,
  maxLength: max
})

export const nullableText = (max: number): Record<string, unknown> => ({
  anyOf: [{ type: 'string', maxLength: max }, { type: 'null' }]
})

export const obj = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties
})

export const list = (
  items: Record<string, unknown>,
  max: number,
  min = 0
): Record<string, unknown> => ({
  type: 'array',
  minItems: min,
  maxItems: max,
  items
})

export const stage = { enum: [...TOPIC_STAGES] }

export const section = { enum: [...TOPIC_PROFILE_SECTIONS] }
