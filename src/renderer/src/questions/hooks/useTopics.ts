import { useEffect, useState } from 'react'
import type { TopicSummary } from '@shared/domain'
import { onTopicsChanged } from '../../topics/clusters'
import type { QuestionsSource } from '../source'

/**
 * The project's topics (`topics:list`), for each topic's band and the Move menu's
 * topics that have no question yet. Loads again when topics change anywhere and when
 * `revision` changes (each questions reload). Empty while loading or on an error:
 * the screen still works from the question list alone.
 */
export function useTopics(
  source: QuestionsSource,
  projectId: string,
  revision: unknown
): readonly TopicSummary[] {
  const [topics, setTopics] = useState<readonly TopicSummary[]>([])
  const [changed, setChanged] = useState(0)

  useEffect(() => onTopicsChanged(() => setChanged((n) => n + 1)), [])

  useEffect(() => {
    let cancelled = false
    source['topics:list']({ projectId }).then(
      (list) => {
        if (!cancelled) setTopics(list.topics)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, revision, changed])

  return topics
}
