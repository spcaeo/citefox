import { list, nullableText, obj, text } from './shared'

/** Topic page schemas (Docs/PROMPT-AUDIT.md, package P5). */

export const TOPIC_PAGE_MATCH_SCHEMA = obj({
  matches: list(
    obj({
      id: text(80),
      url: nullableText(2000),
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      reason: text(300)
    }),
    600
  )
})

export const TOPIC_PAGE_BRIEF_SCHEMA = obj({
  summary: text(600),
  outline: list(text(200), 10, 1),
  text: text(4000)
})

export const TOPIC_TARGET_SUGGEST_SCHEMA = obj({
  picks: list(obj({ url: text(2000), reason: text(300) }), 3),
  newPage: {
    anyOf: [obj({ title: text(120), path: text(200), about: text(300) }), { type: 'null' }]
  }
})
