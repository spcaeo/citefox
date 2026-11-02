import { list, nullableText, obj, text } from './shared'

/** Topic discovery schema (Docs/PROMPT-AUDIT.md, package P2): seeds only. */

export const TOPIC_SEED_DISCOVER_SCHEMA = obj({
  seeds: list(
    obj({
      text: text(200),
      productId: nullableText(120),
      evidence: nullableText(200),
      caution: nullableText(200)
    }),
    8
  ),
  segments: list(obj({ name: text(120), reason: text(300) }), 8),
  why: nullableText(400)
})
