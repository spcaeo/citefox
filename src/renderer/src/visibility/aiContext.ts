import type { Market } from '@shared/domain'
import type { AiEntityRef } from '../assistant/context/types'
import { formatMonthDay } from '../m3/model'
import { marketLabel } from '../shell/model'

/**
 * The page, market and check a page tab shows, named for Ask CiteFox. Each
 * part is left out when the screen does not know it.
 */
export function pageScopeRefs(scope: {
  pageId?: string | null
  /** The page's title, else its URL. */
  page?: string | null
  market?: Pick<Market, 'id' | 'country' | 'language' | 'location'> | null
  runId?: string | null
  checkedAt?: string | null
}): AiEntityRef[] {
  const out: AiEntityRef[] = []
  if (scope.page) out.push({ kind: 'page', id: scope.pageId ?? null, label: scope.page })
  if (scope.market) {
    out.push({ kind: 'market', id: scope.market.id, label: marketLabel(scope.market) })
  }
  if (scope.checkedAt) {
    out.push({ kind: 'check', id: scope.runId ?? null, label: formatMonthDay(scope.checkedAt) })
  }
  return out
}
