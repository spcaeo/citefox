import type {
  Market,
  PageResults,
  PageScoreList,
  ProjectScoreList,
  ResultsHistory
} from '@shared/domain'
import { marketLabel } from '../shell/model'
import type { VisibilitySource } from './source'

/** Progress data for one page: every check in the shown market, and each market's history. */
export interface MarketHistory {
  id: string
  name: string
  history: ResultsHistory
}

export interface Loaded {
  runs: ReadonlyMap<string, PageResults>
  pages: PageScoreList
  projects: ProjectScoreList
  history: ResultsHistory
  marketHistories: readonly MarketHistory[]
}

export async function loadScores(
  client: VisibilitySource,
  projectId: string,
  pageId: string,
  marketId: string | null,
  markets: readonly Market[]
): Promise<Loaded> {
  const requested =
    markets.length > 0
      ? markets.map((item) => ({ id: item.id, label: marketLabel(item) }))
      : [{ id: marketId ?? '', label: 'This market' }]
  const [pages, projects, histories] = await Promise.all([
    client['scores:listPages']({ projectId }),
    client['scores:listProjects'](),
    Promise.all(
      requested.map(async (item) => {
        const id = item.id.length > 0 ? item.id : null
        const history = await client['results:history']({ projectId, pageId, marketId: id })
        return { id: history.marketId, name: item.label, history }
      })
    )
  ])
  const history = histories.find((item) => item.id === marketId)?.history ??
    histories[0]?.history ?? {
      pageId,
      marketId: marketId ?? '',
      promptSetVersion: null,
      points: []
    }
  const runs = new Map<string, PageResults>()
  if (history.points.length === 0) {
    await client['results:get']({ projectId, pageId, marketId, runId: null })
  } else {
    await Promise.all(
      history.points.map(async (point) => {
        const results = await client['results:get']({
          projectId,
          pageId,
          marketId,
          runId: point.runId
        })
        runs.set(point.runId, results)
      })
    )
  }
  return { runs, pages, projects, history, marketHistories: histories }
}
