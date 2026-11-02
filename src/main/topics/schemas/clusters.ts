import { list, nullableText, obj, stage, text } from './shared'

/**
 * Topics and clusters schemas (Docs/TOPICS-SPEC.md §8). Names may run past 80
 * characters here; code trims them. Ids and URLs are checked against the lists the
 * prompt sent, so a reply can never point at a topic or page that was not offered.
 */

export const TOPIC_CLUSTER_SUGGEST_SCHEMA = obj({
  ideas: list(
    obj({
      name: text(120),
      situation: text(500),
      example: text(300),
      questions: list(obj({ text: text(500), stage }), 12, 4),
      fitsUrl: nullableText(2000)
    }),
    6,
    1
  )
})

export const TOPIC_CLUSTER_SORT_SCHEMA = obj({
  proposals: list(
    obj({
      id: text(40),
      topicId: nullableText(40),
      newTopic: nullableText(120),
      reason: text(300)
    }),
    100,
    1
  )
})

export const TOPIC_CLUSTER_NAME_SCHEMA = obj({
  name: text(120),
  situation: text(500)
})
