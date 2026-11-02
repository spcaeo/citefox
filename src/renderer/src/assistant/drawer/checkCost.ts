import { useEffect, useState } from 'react'
import type { AllPagesData, AssistantAction } from '@shared/ipc'
import {
  costLine,
  estimateSearches,
  scopePageFromRow,
  type ScopeOptions,
  type SearchEstimate
} from '../../scope'
import type { AssistantClient } from '../client'

/**
 * What a "start a check" card costs, worked out with the Check now drawer's
 * own searches model (`scope/estimateSearches` + `costLine`): the picked
 * questions in the picked markets, times the page's samples, up to twice that
 * when Google loads the overview separately, against the searches left this
 * month. Read from `allpages:list`, the same numbers Check now reads.
 */
export interface CheckCost {
  estimate: SearchEstimate
  searchesLeft: number | null
  /** "About 2–4 searches · 210 left this month". */
  line: string
  /** True when even the fewest searches it can use are more than are left. */
  tooMany: boolean
}

export function checkCost(action: AssistantAction, data: AllPagesData): CheckCost | null {
  const subject = action.pageId ?? action.topicId
  if (action.kind !== 'start-check' || subject === null) return null
  const pages = data.rows.filter((row) => row.status !== 'removed').map(scopePageFromRow)
  const asked = action.promptIds.length
  const options: ScopeOptions = {
    projectId: data.projectId,
    domain: data.domain,
    pages,
    groups: [],
    clusters: [],
    // A topic is checked as its own subject, in every project market (one sample each).
    topics: pages.some((page) => page.id === subject)
      ? []
      : [{ id: subject, name: '', kind: 'topic', count: 0, questions: asked }],
    views: [],
    markets: data.markets,
    defaultMarketId: data.defaultMarketId,
    searchesLeft: data.searchesLeft
  }
  const marketIds = action.marketIds.length > 0 ? action.marketIds : null
  const estimate = estimateSearches(options, [subject], marketIds, asked > 0 ? () => asked : null)
  if (estimate.pages === 0) return null
  return {
    estimate,
    searchesLeft: data.searchesLeft,
    line: costLine(estimate, data.searchesLeft),
    tooMany: data.searchesLeft !== null && estimate.min > data.searchesLeft
  }
}

/** The card's cost, loaded once per card. Null while loading or when it cannot be read. */
export function useCheckCost(
  action: AssistantAction,
  projectId: string,
  client: AssistantClient
): CheckCost | null {
  const [cost, setCost] = useState<CheckCost | null>(null)
  const wanted = action.kind === 'start-check'
  useEffect(() => {
    if (!wanted) return
    let live = true
    void Promise.resolve()
      .then(() => client.listPages({ projectId }))
      .then(
        (data) => {
          if (live && data) setCost(checkCost(action, data))
        },
        () => undefined
      )
    return () => {
      live = false
    }
  }, [wanted, action, projectId, client])
  return wanted ? cost : null
}
