import { useCallback, useEffect, useState } from 'react'
import type { PromptCheckDetail } from '@shared/domain'
import type { PromptVersions } from '@shared/ipc'
import { checkError } from '../../m3/source'
import { useEngineRevision } from '../../shell/engineRevision'
import { versionLinks } from '../edit/model'
import type { PromptEditSource } from '../edit/source'
import type { PromptDetailSource } from '../source'
import type { PromptDetailData, PromptTimeRow } from '../types'
import { overTimeRows, recentPoints } from '../utils/model'

export type PromptDetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      data: PromptDetailData
      timeline: PromptTimeRow[] | null
      /** Set when the market's check history could not be loaded. */
      historyError: string | null
    }

interface Loaded {
  key: string
  state: PromptDetailState
}

/**
 * Loads one prompt in one market: the page, that market's results (prompt
 * order, brand, domain), `checks:getPrompt`, and the market's run history.
 * "Over time" then reads `checks:getPrompt` once per recent run, asking each check
 * for the version of the prompt it ran (`prompts:versions`): a reworded prompt has a
 * new id, and its earlier checks stay with the earlier id and wording.
 * A `marketId` the page no longer has falls back to the page's default market.
 */
export function usePromptDetail(
  source: PromptDetailSource,
  projectId: string,
  pageId: string,
  promptId: string,
  marketId: string | null,
  /** A check pinned by the route. Null is the latest check in that market. */
  runId: string | null = null,
  /** The prompt's saved versions. Absent: Over time reads this prompt id only. */
  versionsSource?: Pick<PromptEditSource, 'prompts:versions'>
): { state: PromptDetailState; reload: () => void } {
  const [attempt, setAttempt] = useState(0)
  const key = `${projectId}\0${pageId}\0${promptId}\0${marketId ?? ''}\0${runId ?? ''}\0${attempt}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const revision = useEngineRevision()

  useEffect(() => {
    let cancelled = false
    const settle = (state: PromptDetailState): void => {
      if (!cancelled) setLoaded({ key, state })
    }
    async function load(): Promise<void> {
      const page = await source['pages:get']({ projectId, pageId })
      const market = page.markets.some((item) => item.id === marketId) ? marketId : null
      let historyError: string | null = null
      const readVersions = (): Promise<PromptVersions | null> =>
        versionsSource === undefined
          ? Promise.resolve(null)
          : Promise.resolve()
              .then(() => versionsSource['prompts:versions']({ projectId, pageId, promptId }))
              .catch(() => null)
      const [results, detail, history, versions] = await Promise.all([
        source['results:get']({ projectId, pageId, marketId: market, runId }),
        source['checks:getPrompt']({ projectId, pageId, promptId, marketId: market, runId }),
        source['results:history']({ projectId, pageId, marketId: market }).catch(
          (cause: unknown) => {
            historyError = checkError(cause, 'Could not load earlier checks.')
            return null
          }
        ),
        readVersions()
      ])
      const data: PromptDetailData = { page, results, detail, history, versions }
      settle({ status: 'ready', data, timeline: null, historyError })
      if (!history || history.points.length === 0) {
        settle({ status: 'ready', data, timeline: [], historyError })
        return
      }
      const links = versionLinks(versions, detail.marketId)
      const details = new Map<string, PromptCheckDetail>()
      if (detail.runId) details.set(detail.runId, detail)
      const missing = recentPoints(history.points).filter((point) => !details.has(point.runId))
      const fetched = await Promise.all(
        missing.map((point) =>
          source['checks:getPrompt']({
            projectId,
            pageId,
            promptId:
              (point.promptSetVersion === null
                ? undefined
                : links.get(point.promptSetVersion)?.promptId) ?? promptId,
            marketId: detail.marketId,
            runId: point.runId
          }).catch(() => null)
        )
      )
      fetched.forEach((item, index) => {
        const point = missing[index]
        if (item && point) details.set(point.runId, item)
      })
      settle({
        status: 'ready',
        data,
        timeline: overTimeRows(history.points, details, links),
        historyError
      })
    }
    load().catch((cause: unknown) => {
      settle({ status: 'error', message: checkError(cause, 'Could not load this question.') })
    })
    return () => {
      cancelled = true
    }
  }, [source, versionsSource, projectId, pageId, promptId, marketId, runId, key, revision])

  if (!loaded || loaded.key !== key) return { state: { status: 'loading' }, reload }
  return { state: loaded.state, reload }
}
