import type { TopicPromptKind } from '@shared/domain'
import type { ListEngineFilter, ResultWords } from '../../ui'
import type { Search, SearchFilter } from './model'
import type { TreeMode } from './model/tree'

/** What every view of a topic (or of the Questions screen) is given. */
export interface ViewEnv {
  /** Every search, before the Questions/Keywords segment and the text search. */
  searches: readonly Search[]
  /** The Questions/Keywords segment from the URL. */
  type: TopicPromptKind | null
  setType: (type: TopicPromptKind | null) => void
  q: string
  setQ: (q: string) => void
  tree: TreeMode
  setTree: (tree: TreeMode) => void
  /** The URL of a drill: these filters, on this screen. */
  drillHref: (filter: SearchFilter) => string
  /** Opens one search's question drawer (Google's answer and sources). */
  openSearch: (search: Search) => void
  /** Get fix brief: the page fix drawer for these searches, over this screen. */
  openBrief: (searches: readonly Search[]) => void
  /** Choose owner: pick the page these searches should be cited from (Change target page). */
  chooseOwner?: (searches: readonly Search[]) => void
  /** The project's own site address, so a path's copy and open buttons use the full URL. */
  site: string | null
  /** "Nov 12, 10:27 AM", for "checked again …" on No AI Overview. Null when not scheduled. */
  nextCheck: string | null
  /** The noun of the screen's tree column ("Stage › Result › Search"). */
  questionsScreen?: boolean
  /**
   * The engine filter, in the same toolbar spot of every view (audit #4). The searches
   * are already that engine's results. Absent: no engine spot (the Questions screen).
   */
  engine?: ListEngineFilter
  /** The picked answer engine's name ("ChatGPT"); absent for Google AI Overview. */
  engineName?: string
  /** The words for no answer on the picked engine ("No answer" on ChatGPT). */
  words: ResultWords
}
