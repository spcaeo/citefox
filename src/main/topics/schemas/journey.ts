import { list, nullableText, obj, stage, text } from './shared'

/** Topic journey schemas (Docs/PROMPT-AUDIT.md, package P3). */

export const QUESTION = obj({
  stage,
  text: text(500),
  replaces: nullableText(80),
  reason: nullableText(300)
})

/**
 * One journey stage per call. Each question still carries its stage, so code keeps only
 * the asked stage when a project's own older body writes all six.
 * `namedTool` is the tool or system the buyer names; `competitorNamed` is the
 * competitor from the list the question names (code checks both against the text).
 */
export const TOPIC_JOURNEY_QUESTIONS_SCHEMA = obj({
  questions: list(
    obj({
      stage,
      text: text(500),
      namedTool: nullableText(120),
      competitorNamed: nullableText(120)
    }),
    40,
    1
  )
})

/** discover and rewrite fill questions; gaps fills gaps only. */
export const TOPIC_QUESTIONS_DISCOVER_SCHEMA = obj({
  questions: list(QUESTION, 60),
  gaps: list(obj({ stage, note: text(300) }), 12)
})

export const TOPIC_QUESTIONS_CLEANUP_SCHEMA = obj({
  items: list(
    obj({
      id: text(80),
      after: text(500),
      stage: { anyOf: [stage, { type: 'null' }] },
      change: text(200)
    }),
    500
  )
})
