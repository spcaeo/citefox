import {
  drillTitle,
  drillWhatToDo,
  filterSearches,
  wordGroupIndex,
  wordGroups,
  type Search,
  type SearchFilter
} from '../model'
import type { ViewEnv } from '../types'

export interface DrillModel {
  title: string
  rows: Search[]
  /** Every search on the view's Questions/Keywords segment: "14 of 240". */
  total: number
  whatToDo: string
}

/**
 * The searches a drill shows, its title and its "What to do" line. The view's segment
 * (`type`) narrows it too, as it narrows the count that opened it.
 */
export function drillModel(env: ViewEnv, filter: SearchFilter): DrillModel {
  const words = wordGroupIndex(
    wordGroups(env.searches.filter((search) => search.kind === 'keyword'))
  )
  const scoped: SearchFilter = filter.kind || !env.type ? filter : { ...filter, kind: env.type }
  return {
    title: drillTitle(scoped, env.words),
    rows: filterSearches(env.searches, scoped, (search) => words.get(search.id) ?? null),
    total: env.type
      ? env.searches.filter((search) => search.kind === env.type).length
      : env.searches.length,
    whatToDo: drillWhatToDo(filter, env.nextCheck, env.words)
  }
}
