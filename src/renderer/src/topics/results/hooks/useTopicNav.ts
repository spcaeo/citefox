import { useEffect, useMemo, useState } from 'react'
import { currentClientMode } from '../../../onboarding/flags'
import { useEngineRevision } from '../../../shell/engineRevision'
import { topicHash } from '../../../shell/routes'
import { onTopicsChanged } from '../../clusters/events'
import { topicResultsSource, type TopicResultsSource } from '../source'
import type { TopicNavItem } from '../types'

const NONE: readonly TopicNavItem[] = []

/**
 * The project's topics for the sidebar Topics list: name, the topic's headline
 * (target page cited, of searches with an AI Overview) on the latest check, and the route. Empty without a project or while loading;
 * a failed load keeps the last list (the sidebar never shows an error).
 * Reloads after each finished check, and when a screen changes the topics.
 */
export function useTopicNav(
  projectId: string | null,
  source?: TopicResultsSource
): readonly TopicNavItem[] {
  const resolved = useMemo(() => source ?? topicResultsSource(currentClientMode()), [source])
  const pushed = useEngineRevision()
  // A topic made, renamed or removed on the Topics or Questions screen shows at once.
  const [changed, setChanged] = useState(0)
  useEffect(() => onTopicsChanged(() => setChanged((value) => value + 1)), [])
  const [state, setState] = useState<{ projectId: string | null; items: readonly TopicNavItem[] }>({
    projectId: null,
    items: NONE
  })

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    resolved.list(projectId).then(
      (topics) => {
        if (cancelled) return
        setState({
          projectId,
          // Deleted topics keep their rows (Undo brings them back) but leave the list.
          items: topics
            .filter((topic) => topic.status !== 'removed')
            .map((topic) => ({
              id: topic.id,
              title: topic.name,
              goalPct: topic.targetPct,
              href: topicHash(topic.id)
            }))
        })
      },
      () => {
        // Keep what the sidebar already shows.
      }
    )
    return () => {
      cancelled = true
    }
  }, [resolved, projectId, pushed, changed])

  return projectId && state.projectId === projectId ? state.items : NONE
}
