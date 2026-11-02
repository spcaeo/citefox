import { KEYWORD_INTENT_FAMILIES, PAGE_TYPES } from '@shared/domain'
import { list, obj, text } from './shared'

/** Topic keyword schemas (Docs/PROMPT-AUDIT.md, package P4). */

export const TOPIC_KEYWORD_TERMS_SCHEMA = obj({
  terms: list(obj({ term: text(80), synonyms: list(text(80), 12) }), 8, 1),
  patterns: list(text(60), 8)
})

const group = (families: readonly string[]): Record<string, unknown> =>
  obj({
    name: text(120),
    kind: { enum: ['coverage', 'intent'] },
    family: { anyOf: [{ enum: [...families] }, { type: 'null' }] },
    intent: { enum: ['informational', 'commercial', 'navigational'] },
    funnel: { enum: ['tofu', 'mofu', 'bofu'] },
    pageType: { enum: [...PAGE_TYPES] },
    keywords: list(text(120), 100)
  })

export const TOPIC_KEYWORD_EXPAND_SCHEMA = obj({
  groups: list(group(KEYWORD_INTENT_FAMILIES), 20)
})

/** The same groups shape, for the two competitor families only. */
export const TOPIC_KEYWORD_COMPETITOR_SCHEMA = obj({
  groups: list(group(['alternatives_vs', 'competitor_vs']), 2)
})
