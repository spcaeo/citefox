import Ajv from 'ajv'
import type { AssistDefinition, AssistReply } from './types'

/** The one reply schema every assist shares. Limits per assist are checked after it. */
export const ASSIST_REPLY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items', 'caution'],
  properties: {
    summary: { anyOf: [{ type: 'string', minLength: 1, maxLength: 4000 }, { type: 'null' }] },
    items: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'detail', 'tag', 'verify', 'sign'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 4000 },
          detail: { anyOf: [{ type: 'string', minLength: 1, maxLength: 4000 }, { type: 'null' }] },
          tag: { anyOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'null' }] },
          verify: { anyOf: [{ type: 'string', minLength: 1, maxLength: 600 }, { type: 'null' }] },
          sign: { anyOf: [{ type: 'string', enum: ['add', 'remove'] }, { type: 'null' }] }
        }
      }
    },
    caution: { anyOf: [{ type: 'string', minLength: 1, maxLength: 1000 }, { type: 'null' }] }
  }
}

/**
 * FR-25.5. True when text says a page edit caused a citation change, in either
 * order ("the new FAQ led to the citation", "cited because of the update").
 * Plain "because" in a reason is fine; only cause-of-citation wording is caught.
 */
export function claimsEditCausedCitation(text: string): boolean {
  const forward =
    /\b(caused|causing|led to|leads to|resulted in|produced|drove|won|earned|thanks to)\b[^.]{0,80}\b(citation|cited|citing|visibility|ai overview)/i
  const backward =
    /\b(citation|cited|citing|visibility)\b[^.]{0,60}\b(because of|due to|as a result of|thanks to)\b[^.]{0,40}\b(edit|edits|change|changes|update|updates|rewrite|fix|fixes)\b/i
  return forward.test(text) || backward.test(text)
}

const ajv = new Ajv({ allErrors: true, strict: false })
const valid = ajv.compile(ASSIST_REPLY_SCHEMA)

/**
 * The reply as an `AssistReply`, or the sentence that rejects it. FR-25.5: a reply
 * that claims an edit caused a citation change is rejected and retried.
 */
export function readAssistReply(
  value: unknown,
  definition: Pick<AssistDefinition, 'minItems' | 'maxItems' | 'signedItems'>
): { reply: AssistReply } | { problem: string } {
  const normalized = normalizeNulls(value)
  if (!valid(normalized)) return { problem: 'The reply did not match the schema.' }
  const reply = normalized as AssistReply
  const min = definition.minItems ?? 0
  const max = definition.maxItems ?? 12
  if (reply.items.length < min) return { problem: `Give at least ${min} items.` }
  if (reply.items.length > max) return { problem: `Give at most ${max} items.` }
  if (definition.signedItems === true && reply.items.some((item) => item.sign === null)) {
    return { problem: 'Mark every line "add" or "remove".' }
  }
  const texts = [
    reply.summary,
    reply.caution,
    ...reply.items.flatMap((item) => [item.text, item.detail])
  ]
  if (texts.some((text) => text !== null && claimsEditCausedCitation(text))) {
    return { problem: 'Do not say that a page edit caused a citation change.' }
  }
  return {
    reply: {
      summary: clean(reply.summary),
      caution: clean(reply.caution),
      items: reply.items.map((item) => ({
        text: item.text.trim(),
        detail: clean(item.detail),
        tag: clean(item.tag),
        verify: clean(item.verify),
        sign: item.sign
      }))
    }
  }
}

/** Fills missing optional keys with null, so a terse but correct reply still passes. */
function normalizeNulls(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const record = { ...(value as Record<string, unknown>) }
  for (const key of ['summary', 'caution']) if (!(key in record)) record[key] = null
  if (!('items' in record)) record.items = []
  if (Array.isArray(record.items)) {
    record.items = record.items.map((item: unknown) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
      const copy = { ...(item as Record<string, unknown>) }
      for (const key of ['detail', 'tag', 'verify', 'sign']) if (!(key in copy)) copy[key] = null
      return copy
    })
  }
  return record
}

function clean(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
