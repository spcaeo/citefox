import { useState } from 'react'
import type { CheckJob, MarketDraft, PageDetail } from '@shared/ipc'
import { checkError, checkStartMessage } from '../../m3/source'
import { marketLabel } from '../../shell/model'
import { navigateHash, runningHash } from '../../shell/routes'
import { showUndo } from '../../ui'
import { START_WAIT_MS } from '../constants'
import type { MarketsSource } from '../source'
import { addedMarketId, draftOf, sameMarket } from '../utils/model'

export type MarketActionResult = { ok: true } | { ok: false; message: string }

/**
 * Add, remove, and check markets with `pages:update` and `checks:start`.
 * `pages:update` replaces the page's market list; existing markets keep their
 * ids (and history) because every field still matches.
 */
export function useMarketActions(
  source: MarketsSource,
  projectId: string,
  page: PageDetail,
  onChanged: () => void
): {
  busy: boolean
  add: (draft: MarketDraft, check: boolean) => Promise<MarketActionResult>
  remove: (marketId: string) => Promise<MarketActionResult>
  /** Makes the market the page's default (the score's market), with Undo. */
  makeDefault: (marketId: string) => Promise<MarketActionResult>
  /** Null checks every market of the page. */
  check: (marketIds: readonly string[] | null) => Promise<MarketActionResult>
} {
  const [busy, setBusy] = useState(false)

  async function run(work: () => Promise<MarketActionResult>): Promise<MarketActionResult> {
    setBusy(true)
    try {
      return await work()
    } catch (cause) {
      return { ok: false, message: checkError(cause, 'Could not update the markets.') }
    } finally {
      setBusy(false)
    }
  }

  async function check(marketIds: readonly string[] | null): Promise<MarketActionResult> {
    const started = source['checks:start']({
      projectId,
      pageIds: [page.id],
      marketIds,
      promptIds: null
    })
    const early = await Promise.race([
      started.then(
        (job): { job: CheckJob } => ({ job }),
        (cause: unknown): { cause: unknown } => ({ cause })
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), START_WAIT_MS))
    ])
    if (early !== null && 'cause' in early) {
      return { ok: false, message: checkError(early.cause, 'Could not start the check.') }
    }
    if (early !== null && early.job.status !== 'running' && early.job.status !== 'finished') {
      return { ok: false, message: checkStartMessage(early.job) }
    }
    navigateHash(runningHash(page.id))
    return { ok: true }
  }

  return {
    busy,
    add: (draft, withCheck) =>
      run(async () => {
        const current = page.markets.map(draftOf)
        if (current.some((market) => sameMarket(market, draft))) {
          return { ok: false, message: 'This page already tracks that market.' }
        }
        const updated = await source['pages:update']({
          projectId,
          pageId: page.id,
          markets: [...current, draft],
          ...(page.defaultMarketId ? { defaultMarketId: page.defaultMarketId } : {})
        })
        onChanged()
        if (!withCheck) return { ok: true }
        const id = addedMarketId(page.markets, updated.markets, draft)
        if (!id)
          return { ok: false, message: 'The market was added. Start its check from its card.' }
        return check([id])
      }),
    remove: (marketId) =>
      run(async () => {
        const rest = page.markets.filter((market) => market.id !== marketId)
        if (rest.length === 0) {
          return { ok: false, message: 'A page needs at least one market.' }
        }
        const keepDefault = rest.some((market) => market.id === page.defaultMarketId)
        await source['pages:update']({
          projectId,
          pageId: page.id,
          markets: rest.map(draftOf),
          ...(keepDefault && page.defaultMarketId ? { defaultMarketId: page.defaultMarketId } : {})
        })
        onChanged()
        return { ok: true }
      }),
    makeDefault: (marketId) =>
      run(async () => {
        const market = page.markets.find((item) => item.id === marketId)
        if (!market) return { ok: false, message: 'That market is not on this page.' }
        const previous = page.defaultMarketId
        await source['pages:update']({ projectId, pageId: page.id, defaultMarketId: marketId })
        onChanged()
        showUndo({
          message: `${marketLabel(market)} is this page's default market now.`,
          effect: 'The page opens in it, and its score uses it.',
          ...(previous
            ? {
                undo: async () => {
                  await source['pages:update']({
                    projectId,
                    pageId: page.id,
                    defaultMarketId: previous
                  })
                  onChanged()
                }
              }
            : {})
        })
        return { ok: true }
      }),
    check: (marketIds) => run(() => check(marketIds))
  }
}
