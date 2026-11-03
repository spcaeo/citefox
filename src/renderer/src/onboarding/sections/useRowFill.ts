import { useCallback, useLayoutEffect, useRef } from 'react'
import type { RowFillList, SetupItem } from '@shared/ipc'
import { useFillQueue } from '../../utils/useFillQueue'
import { contextFromDraft, rowOf } from '../setupDraft'
import { withList } from './draftOps'
import { applyFill, needsFill } from './merge'
import type { SectionEnv } from './types'

/** Example rows sent for style. */
const EXAMPLES_MAX = 6

export interface RowFillState {
  /** True while CiteFox AI is writing (or about to write) this row's second part. */
  filling: (id: string) => boolean
  /** Starts a fill for a row (queued behind the running ones). A no-op for a row that needs none. */
  start: (id: string) => void
  /** True when the row can offer "✦ Fill in": it needs a fill, none is running, AI is ready. */
  canRetry: (item: SetupItem) => boolean
}

/**
 * ✦ Fill in for a list's hand-added rows: after a manual add the row's second part is
 * written by CiteFox AI in the background. Up to two rows at a time; the rest queue. A
 * failure or a blank answer changes nothing (the row keeps "Added by you"). The result
 * is merged by `applyFill`, so what the person typed meanwhile always wins.
 */
export function useRowFill(
  env: SectionEnv,
  list: RowFillList,
  enabled: boolean,
  available: boolean
): RowFillState {
  const latest = useRef({ env, enabled })
  useLayoutEffect(() => {
    latest.current = { env, enabled }
  })

  const queue = useFillQueue(
    useCallback(
      (id: string) => {
        const { env: now, enabled: on } = latest.current
        const item = now.draft.lists[list].find((entry) => entry.id === id)
        if (!on || item === undefined || !needsFill(item)) return null
        const askedName = item.name
        const examples = now.draft.lists[list]
          .filter((entry) => entry.id !== id && entry.detail.trim().length > 0)
          .slice(0, EXAMPLES_MAX)
          .map(rowOf)
        return now.client
          .rowFill({ list, context: contextFromDraft(now.draft), name: askedName, examples })
          .then((fill) => {
            const current = latest.current.env
            const before = current.draft.lists[list]
            const after = applyFill(before, id, askedName, fill)
            current.onDraft((draft) =>
              withList(draft, list, (items) => applyFill(items, id, askedName, fill))
            )
            if (after.some((entry, at) => entry !== before[at])) {
              current.announce(`CiteFox AI filled in “${askedName}”.`)
            }
          })
        // A failure leaves the row as typed ("Added by you"); ✦ Fill in offers another try.
      },
      [list]
    )
  )

  const { pending, start } = queue
  const filling = useCallback((id: string) => pending.has(id), [pending])
  const begin = useCallback(
    (id: string) => {
      if (latest.current.enabled) start(id)
    },
    [start]
  )
  const canRetry = useCallback(
    (item: SetupItem) => enabled && available && !pending.has(item.id) && needsFill(item),
    [enabled, available, pending]
  )
  return { filling, start: begin, canRetry }
}
