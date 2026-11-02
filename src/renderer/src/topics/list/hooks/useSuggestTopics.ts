import { useCallback, useState } from 'react'
import type { TopicIdea } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { notifyTopicsChanged, type ClustersSource } from '../../clusters'

/**
 * Ideas already asked for, per project, so Back and Forward over `?suggest=1` show
 * them again instead of asking Claude again. "Suggest others" replaces them.
 */
const asked = new Map<string, { ideas: readonly TopicIdea[]; shown: readonly string[] }>()

export type SuggestPhase = 'idle' | 'asking' | 'ready' | 'creating' | 'error'

export interface SuggestTopics {
  phase: SuggestPhase
  ideas: readonly TopicIdea[]
  ticked: ReadonlySet<string>
  /** Why nothing was asked, or what went wrong. */
  message: string | null
  toggle: (id: string) => void
  /** Asks Claude for ideas (again, avoiding the ones shown, when `others`). */
  ask: (others?: boolean) => void
  /** Creates the ticked ideas as topics; resolves to the created ids. */
  create: () => Promise<readonly string[]>
}

/** Suggest topics: Claude's ideas for new topics, ticked and created without a check. */
export function useSuggestTopics(source: ClustersSource, projectId: string): SuggestTopics {
  const cached = asked.get(projectId)
  const [ideas, setIdeas] = useState<readonly TopicIdea[]>(cached?.ideas ?? [])
  const [phase, setPhase] = useState<SuggestPhase>(cached ? 'ready' : 'idle')
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set((cached?.ideas ?? []).slice(0, 2).map((idea) => idea.id))
  )
  const [message, setMessage] = useState<string | null>(null)

  const ask = useCallback(
    (others = false) => {
      const shown = others ? [...(asked.get(projectId)?.shown ?? [])] : []
      setPhase('asking')
      setMessage(null)
      source['topics:suggestTopics']({ projectId, ...(shown.length > 0 ? { avoid: shown } : {}) })
        .then((result) => {
          const names = [...shown, ...result.ideas.map((idea) => idea.name)]
          asked.set(projectId, { ideas: result.ideas, shown: names })
          setIdeas(result.ideas)
          setTicked(new Set(result.ideas.slice(0, 2).map((idea) => idea.id)))
          setMessage(result.message)
          setPhase('ready')
        })
        .catch((cause: unknown) => {
          setMessage(errorText(cause, 'CiteFox AI could not suggest topics.'))
          setPhase('error')
        })
    },
    [source, projectId]
  )

  const toggle = useCallback((id: string) => {
    setTicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const create = useCallback(async (): Promise<readonly string[]> => {
    const picked = ideas.filter((idea) => ticked.has(idea.id))
    if (picked.length === 0) return []
    setPhase('creating')
    setMessage(null)
    try {
      const result = await source['topics:createTopics']({
        projectId,
        topics: picked.map((idea) => ({
          name: idea.name,
          situation: idea.situation,
          questions: idea.questions,
          targetUrl: idea.fitsUrl
        }))
      })
      const left = ideas.filter((idea) => !ticked.has(idea.id))
      const entry = asked.get(projectId)
      asked.set(projectId, { ideas: left, shown: entry?.shown ?? [] })
      setIdeas(left)
      setTicked(new Set())
      setMessage(result.message)
      setPhase('ready')
      notifyTopicsChanged()
      return result.topicIds
    } catch (cause) {
      setMessage(errorText(cause, 'Could not create the topics.'))
      setPhase('error')
      return []
    }
  }, [source, projectId, ideas, ticked])

  return { phase, ideas, ticked, message, toggle, ask, create }
}

/** Test hook: forget the asked ideas. */
export function resetSuggestCache(): void {
  asked.clear()
}
