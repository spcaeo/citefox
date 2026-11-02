import { useMemo } from 'react'
import type { AnswerEngineId } from '@shared/domain'
import { openTarget } from '../../../drill'
import { ENGINE_TAB_PARAM, engineLabel } from '../../../engines/model'
import { promptHash } from '../../../shell/routes'
import { patchHashQuery } from '../../../utils/hashQuery'
import { formatMoment } from '../../../utils/dates'
import type { TopicResults } from '../../results/types'
import type { ListEngineFilter } from '../../../ui'
import { resultWords } from '../../../ui/resultWords'
import { searchesOfTopic, type Search } from '../model'
import { openFixBrief } from '../openFixBrief'
import type { ViewEnv } from '../types'
import { useViewQuery } from './useViewQuery'

/** The Fixes screen narrowed to one topic (the Fixes agent's `topic` filter). */
export function fixesForTopicHash(topicId: string): string {
  return `#/fixes?topic=${encodeURIComponent(topicId)}`
}

/** The next scheduled check, in words, from the last check and the topic's interval. */
export function nextCheckText(results: Pick<TopicResults, 'topic'>): string | null {
  const { checkedAt, intervalDays, status } = results.topic
  if (!checkedAt || status === 'paused') return null
  const next = new Date(Date.parse(checkedAt) + intervalDays * 86_400_000)
  return formatMoment(next.toISOString())
}

/**
 * The topic's searches and the shared view environment, for the views and the drill.
 * Called before the results load (hooks run every render); the searches are empty then.
 */
export function useTopicEnv(
  results: TopicResults | null,
  options: {
    site: string | null
    onChangeTarget: (searches: readonly Search[]) => void
    /** The searches a running check is on now, and what each waits on. */
    checking?: ReadonlyMap<string, string>
    /** The engine filter for every view's toolbar (audit #4). */
    engine?: ListEngineFilter
    /** The picked answer engine: a search opens on its tab of the question. */
    answerEngine?: AnswerEngineId | null
  }
): { env: ViewEnv; query: ReturnType<typeof useViewQuery> } {
  const query = useViewQuery()
  const { checking } = options
  const searches = useMemo(() => {
    const all = results ? searchesOfTopic(results) : []
    if (!checking || checking.size === 0) return all
    return all.map((search) => {
      const words = checking.get(search.id)
      return words && search.result === 'not_checked'
        ? { ...search, live: 'checking' as const, liveWords: words }
        : search
    })
  }, [results, checking])
  const env = useMemo<ViewEnv>(() => {
    const topic = results?.topic
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
        if (!topic) return
        const hash = promptHash(topic.id, search.id, { marketId: topic.marketId })
        openTarget({
          kind: 'hash',
          hash: options.answerEngine
            ? patchHashQuery(hash, { [ENGINE_TAB_PARAM]: options.answerEngine })
            : hash
        })
      },
      openBrief: openFixBrief,
      chooseOwner: options.onChangeTarget,
      site: options.site,
      nextCheck: results ? nextCheckText(results) : null,
      ...(options.engine ? { engine: options.engine } : {}),
      ...(options.answerEngine ? { engineName: engineLabel(options.answerEngine) } : {}),
      words: resultWords(options.answerEngine)
    }
  }, [
    searches,
    query,
    options.site,
    options.onChangeTarget,
    options.engine,
    options.answerEngine,
    results
  ])
  return { env, query }
}
