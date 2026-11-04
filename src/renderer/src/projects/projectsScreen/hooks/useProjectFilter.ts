import { useCallback, useMemo } from 'react'
import { EMPTY_PROJECT_FILTER, type ProjectFilter } from '../../listModel'
import { parseList, readQueryValue, useQueryState, writeQuery } from '../../../utils/queryState'

type StatusWord = ProjectFilter['statuses'][number]
type KindWord = ProjectFilter['clients'][number]

const STATUS_KEY = 'pstatus'
const KIND_KEY = 'pkind'
const STATUSES: readonly StatusWord[] = ['Active', 'Paused', 'Archived']
const KINDS: readonly KindWord[] = ['Client', 'Own']

/** `active,paused` in the URL back to the words the filter uses; unknown words are dropped. */
function wordsOf<T extends string>(value: string | null, known: readonly T[]): T[] {
  return parseList(value).flatMap((item) => {
    const found = known.find((word) => word.toLowerCase() === item.toLowerCase())
    return found ? [found] : []
  })
}

function valueOf(words: readonly string[]): string | null {
  return words.length > 0 ? words.map((word) => word.toLowerCase()).join(',') : null
}

/**
 * The Projects list filter (status and kind) kept in the route as
 * `?pstatus=active,paused&pkind=client`. The empty filter has no values, so it
 * adds nothing to the address. A change is a new history entry: Back undoes it.
 */
export function useProjectFilter(): [
  ProjectFilter,
  (next: ProjectFilter | ((current: ProjectFilter) => ProjectFilter)) => void
] {
  const [status] = useQueryState(STATUS_KEY)
  const [kind] = useQueryState(KIND_KEY)
  const filter = useMemo<ProjectFilter>(() => {
    const statuses = wordsOf(status, STATUSES)
    const clients = wordsOf(kind, KINDS)
    return statuses.length === 0 && clients.length === 0
      ? EMPTY_PROJECT_FILTER
      : { statuses, clients }
  }, [status, kind])
  const setFilter = useCallback(
    (next: ProjectFilter | ((current: ProjectFilter) => ProjectFilter)) => {
      const hash = window.location.hash
      const current: ProjectFilter = {
        statuses: wordsOf(readQueryValue(hash, STATUS_KEY), STATUSES),
        clients: wordsOf(readQueryValue(hash, KIND_KEY), KINDS)
      }
      const value = typeof next === 'function' ? next(current) : next
      writeQuery(
        { [STATUS_KEY]: valueOf(value.statuses), [KIND_KEY]: valueOf(value.clients) },
        'push'
      )
    },
    []
  )
  return [filter, setFilter]
}
