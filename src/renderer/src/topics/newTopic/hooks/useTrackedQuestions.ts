import { useCallback, useEffect, useRef, useState } from 'react'
import type { QuestionsList } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import type { ClustersSource } from '../../clusters/source'
import { FIT_LIMIT, pickedRefs, unassignedRows } from '../utils/plan'

/** "Also move in N questions you already track that fit this topic" (topics:sortQuestions). */
export interface FitState {
  status: 'idle' | 'busy' | 'done' | 'error'
  /** Prompt ids Claude put in the new topic. */
  ids: readonly string[]
  error: string | null
}

const IDLE_FIT: FitState = { status: 'idle', ids: [], error: null }

/** The candidate id the new topic has in the sort request. */
const NEW_ID = 'new'

export interface TrackedQuestions {
  list: QuestionsList | null
  listError: string | null
  /** Tracked questions picked to move into the new topic (prompt ids). */
  picked: ReadonlySet<string>
  fit: FitState
  reload: () => Promise<void>
  toggle: (promptId: string) => void
  setPicked: (promptIds: readonly string[], on: boolean) => void
  /** Asks Claude which tracked questions not in a topic fit the new one. */
  findFit: (topic: { name: string; situation: string }) => Promise<void>
  /** The picked questions as the move channels name them. */
  refs: () => { sourceId: string; promptId: string }[]
}

/** The project's tracked questions, the ones picked for the new topic and the fit search. */
export function useTrackedQuestions(
  source: ClustersSource,
  projectId: string,
  initial: readonly string[]
): TrackedQuestions {
  const [list, setList] = useState<QuestionsList | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [picked, setPickedSet] = useState<ReadonlySet<string>>(() => new Set(initial))
  const [fit, setFit] = useState<FitState>(IDLE_FIT)
  const listRef = useRef<QuestionsList | null>(null)
  const pickedRef = useRef<ReadonlySet<string>>(picked)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      const next = await source['questions:list']({ projectId })
      if (!alive.current) return
      listRef.current = next
      setList(next)
      setListError(null)
    } catch (error) {
      if (alive.current) setListError(errorText(error, 'Could not load your tracked questions.'))
    }
  }, [source, projectId])

  useEffect(() => {
    source['questions:list']({ projectId }).then(
      (next) => {
        if (!alive.current) return
        listRef.current = next
        setList(next)
      },
      (error: unknown) => {
        if (alive.current) setListError(errorText(error, 'Could not load your tracked questions.'))
      }
    )
  }, [source, projectId])

  const update = useCallback((next: ReadonlySet<string>) => {
    pickedRef.current = next
    setPickedSet(next)
  }, [])

  const toggle = useCallback(
    (promptId: string) => {
      const next = new Set(pickedRef.current)
      if (next.has(promptId)) next.delete(promptId)
      else next.add(promptId)
      update(next)
    },
    [update]
  )

  const setPicked = useCallback(
    (promptIds: readonly string[], on: boolean) => {
      const next = new Set(pickedRef.current)
      for (const id of promptIds) {
        if (on) next.add(id)
        else next.delete(id)
      }
      update(next)
    },
    [update]
  )

  const findFit = useCallback(
    async (topic: { name: string; situation: string }) => {
      const items = unassignedRows(listRef.current)
        .filter((row) => row.promptKind === 'question')
        .slice(0, FIT_LIMIT)
        .map((row) => ({ sourceId: row.sourceId, promptId: row.promptId }))
      if (items.length === 0) {
        setFit({ status: 'done', ids: [], error: null })
        return
      }
      setFit({ status: 'busy', ids: [], error: null })
      try {
        const result = await source['topics:sortQuestions']({
          projectId,
          items,
          candidates: [{ id: NEW_ID, name: topic.name, situation: topic.situation }],
          allowNew: false
        })
        if (!alive.current) return
        const ids = result.proposals
          .filter((proposal) => proposal.topicId === NEW_ID)
          .map((proposal) => proposal.promptId)
        setFit({ status: 'done', ids, error: null })
      } catch (error) {
        if (alive.current)
          setFit({
            status: 'error',
            ids: [],
            error: errorText(error, 'Could not look through your tracked questions.')
          })
      }
    },
    [source, projectId]
  )

  const refs = useCallback(() => pickedRefs(listRef.current, pickedRef.current), [])

  return { list, listError, picked, fit, reload, toggle, setPicked, findFit, refs }
}
