import { list, nullableText, obj, section, text } from './shared'

/** Topic profile schemas (Docs/PROMPT-AUDIT.md, package P3). */

export const PROFILE_POINT = obj({
  section,
  text: text(400),
  foundIn: nullableText(200),
  verify: nullableText(300)
})

/** Six sections of 3 to 6 points; code checks the per-section counts. */
export const TOPIC_BUYER_PROFILE_SCHEMA = obj({ points: list(PROFILE_POINT, 48, 6) })

/** Retired with `topic_profile_discover` (rule 6); kept for its old project versions. */
export const TOPIC_PROFILE_DISCOVER_SCHEMA = obj({
  points: list(
    obj({
      section,
      text: text(400),
      foundIn: nullableText(200),
      verify: nullableText(300),
      replaces: nullableText(80)
    }),
    24
  ),
  explanation: nullableText(2000)
})

/** discover (new points with sources) or explain (an explanation, no points). */
export const TOPIC_PROFILE_DISCOVER_V2_SCHEMA = obj({
  points: list(PROFILE_POINT, 24),
  explanation: nullableText(2000)
})

/** rewrite or shorter: one point per point given, each naming the id it replaces. */
export const TOPIC_PROFILE_REWRITE_SCHEMA = obj({
  points: list(obj({ section, text: text(400), replaces: text(80) }), 48, 1)
})
