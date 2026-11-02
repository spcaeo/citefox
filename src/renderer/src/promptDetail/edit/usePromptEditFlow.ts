import { useCallback, useEffect, useState } from 'react'
import type { EngineId, Market } from '@shared/domain'
import { errorText } from '../../components/errorText'
import { useLegacyPanel } from '../../pageSetup/legacyPanel'
import { closeDrawersThen, openDrawer, useDrawerEntry } from '../../shell/drawers'
import { parseHash, promptHash, replaceHash } from '../../shell/routes'
import type { PromptDetailSource } from '../source'
import type { PromptPanel } from './model'
import type { PromptEditSource } from './source'
import { usePromptRecheck, type RecheckState } from './usePromptRecheck'

export interface SaveWording {
  text: string
  /** The market whose wording is shown and edited. */
  marketId: string
  allMarkets: boolean
  /** Null saves only. */
  recheck: readonly Market[] | null
}

export interface PromptEditFlow {
  panel: PromptPanel | null
  /** The open drawer's depth on the URL's stack. */
  depth: number
  open: (panel: PromptPanel) => void
  close: () => void
  saving: boolean
  saveError: string | null
  searchesLeft: number | null
  recheck: RecheckState
  dismiss: () => void
  save: (request: SaveWording) => Promise<void>
  /** Re-checks the prompt as it is, in `markets`; `shownMarketId` is where the page lands after. */
  /** `engines`: only these (null: every engine the page checks). */
  recheckNow: (
    markets: readonly Market[],
    shownMarketId: string,
    engines?: readonly EngineId[] | null
  ) => void
}

/** The drawer each Prompt detail panel opens. */
const DRAWER_OF = { edit: 'pd-edit', recheck: 'pd-recheck' } as const

/** Resolves once the URL has no drawer on it (a close's history step landed), or after `ms`. */
function drawersGone(ms = 1500): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = (): void => {
      if (!window.location.hash.includes('drawer=') || Date.now() - started > ms) resolve()
      else setTimeout(tick, 25)
    }
    tick()
  })
}

/**
 * "Edit question" and "Re-check now" on Prompt detail. Each is a drawer on the URL
 * (`?drawer=pd-edit`, `?drawer=pd-recheck`; old `?panel=edit|recheck` links open
 * them too), so Back closes it and a copied link reopens it. A saved wording is a
 * new prompt id: the page moves to it. A re-check is a follow-up check (partial);
 * when it finishes the page pins that check so the new result shows, with the
 * page's own "showing a re-check" note.
 */
export function usePromptEditFlow({
  editSource,
  client,
  projectId,
  pageId,
  promptId,
  routeMarketId,
  panel
}: {
  editSource: PromptEditSource
  client: PromptDetailSource
  projectId: string
  pageId: string
  promptId: string
  /** The market on the route or the page picker; kept on the URLs this flow opens. */
  routeMarketId: string | undefined
  /** An old `?panel=` link: opened as its drawer. */
  panel: PromptPanel | null
}): PromptEditFlow {
  const recheck = usePromptRecheck(editSource, projectId, pageId)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [searchesLeft, setSearchesLeft] = useState<number | null>(null)
  useLegacyPanel(panel ? { key: 'panel', id: DRAWER_OF[panel] } : null)
  const editing = useDrawerEntry('pd-edit')
  const rechecking = useDrawerEntry('pd-recheck')
  const entry = editing ?? rechecking
  const open_: PromptPanel | null = editing ? 'edit' : rechecking ? 'recheck' : null

  useEffect(() => {
    if (open_ === null) return
    let cancelled = false
    // Only feeds the cost line; a failure leaves the count out.
    Promise.resolve()
      .then(() => editSource['status:getCapsule']())
      .then(
        (capsule) => {
          if (!cancelled) setSearchesLeft(capsule.searchesLeft)
        },
        () => undefined
      )
    return () => {
      cancelled = true
    }
  }, [editSource, open_])

  // A drawer never changes the route under it, so the open tab (`?view=`) stays.
  const open = (next: PromptPanel): void => {
    setSaveError(null)
    openDrawer(DRAWER_OF[next])
  }
  const close = (): void => {
    setSaveError(null)
    entry?.close()
  }

  const pinRecheck = useCallback(
    async (
      target: string,
      markets: readonly Market[],
      shownMarketId: string,
      engines: readonly EngineId[] | null = null
    ): Promise<void> => {
      const job = await recheck.start(target, markets, engines)
      if (job === null) return
      // The drawer's close (a history step) lands before the pin rewrites the URL.
      await drawersGone()
      const market = markets.find((item) => item.id === shownMarketId) ?? markets[0]
      if (!market) return
      const history = await Promise.resolve()
        .then(() => client['results:history']({ projectId, pageId, marketId: market.id }))
        .catch(() => null)
      const run =
        [...(history?.points ?? [])].reverse().find((point) => job.runIds.includes(point.runId))
          ?.runId ?? null
      // Only when the person is still on this prompt; never pull them back from elsewhere.
      const here = parseHash(window.location.hash)
      if (here.kind !== 'prompt' || here.pageId !== pageId || here.promptId !== target) return
      replaceHash(promptHash(pageId, target, { marketId: market.id, runId: run }))
    },
    [client, projectId, pageId, recheck]
  )

  async function save(request: SaveWording): Promise<void> {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    let next: string
    try {
      const result = await editSource['prompts:reword']({
        projectId,
        pageId,
        promptId,
        marketId: request.marketId,
        text: request.text,
        allMarkets: request.allMarkets
      })
      next = result.promptId
    } catch (cause) {
      setSaveError(errorText(cause, 'Could not save the wording.'))
      return
    } finally {
      setSaving(false)
    }
    closeDrawersThen(promptHash(pageId, next, { marketId: routeMarketId ?? null }))
    if (request.recheck !== null) void pinRecheck(next, request.recheck, request.marketId)
  }

  return {
    panel: open_,
    depth: entry?.depth ?? 0,
    open,
    close,
    saving,
    saveError,
    searchesLeft,
    recheck: recheck.state,
    dismiss: recheck.dismiss,
    save,
    recheckNow: (markets, shownMarketId, engines = null) => {
      close()
      void pinRecheck(promptId, markets, shownMarketId, engines)
    }
  }
}
