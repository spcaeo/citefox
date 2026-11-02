import { useMemo } from 'react'
import type { QuestionRow, QuestionSource } from '@shared/ipc'
import { engineLabel, isAnswerFilter, type EngineFilter } from '../../engines/model'
import type { ListEngineFilter } from '../../ui'
import { resultWords } from '../../ui/resultWords'
import { useViewQuery } from '../../topics/views/hooks/useViewQuery'
import { searchesOfQuestions, type Search } from '../../topics/views/model'
import { openFixBrief } from '../../topics/views/openFixBrief'
import type { ViewEnv } from '../../topics/views/types'
import { QUESTIONS_DRILL_PREFIX } from '../../topics/views/url'

/**
 * The Questions screen's searches (every topic and page, or one folder's) and the view
 * environment the shared Tree, Grid, Pages and drill views take. The drill keys carry
 * the `d.` prefix, since the List uses `result` and `source` for its own filters.
 */
export function useQuestionsEnv(
  rows: readonly QuestionRow[],
  sources: readonly QuestionSource[],
  options: {
    site: string | null
    openRow: (row: QuestionRow) => void
    chooseOwner: (searches: readonly Search[]) => void
    /** The picked engine: an answer engine says "No answer" for no AI Overview. */
    engine?: EngineFilter
    /** The engine filter, in every view's toolbar spot (audit2 #8). */
    engineSlot?: ListEngineFilter
  }
): { env: ViewEnv; query: ReturnType<typeof useViewQuery> } {
  const query = useViewQuery(QUESTIONS_DRILL_PREFIX)
  const searches = useMemo(() => searchesOfQuestions(rows, sources), [rows, sources])
  const { site, openRow, chooseOwner, engine, engineSlot } = options
  const env = useMemo<ViewEnv>(() => {
    const byId = new Map(rows.map((row) => [row.promptId, row]))
    return {
      searches,
      type: query.type,
      setType: query.setType,
      q: query.q,
      setQ: query.setQ,
      tree: query.tree,
      setTree: query.setTree,
      drillHref: query.drillHref,
      openSearch: (search) => {
        const row = byId.get(search.id)
        if (row) openRow(row)
      },
      openBrief: openFixBrief,
      chooseOwner,
      site,
      nextCheck: null,
      questionsScreen: true,
      words: resultWords(engine),
      ...(engineSlot ? { engine: engineSlot } : {}),
      ...(engine !== undefined && isAnswerFilter(engine) ? { engineName: engineLabel(engine) } : {})
    }
  }, [rows, searches, query, site, openRow, chooseOwner, engine, engineSlot])
  return { env, query }
}
