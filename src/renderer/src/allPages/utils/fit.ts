import type { AllPageRow } from '@shared/ipc'
import type { GridColumn } from '../../grid'
import type { ListColumn } from '../../ui'
import { columnsFit } from '../../ui/listGrid/fit'
import { DEFAULT_HIDDEN, toListColumns } from './listColumns'

/**
 * Default columns a narrow window drops first, in order, so the grid fits
 * without scrolling sideways (a 1134px window keeps Score, Change, Page cited
 * and Status). Updated has its filter and the page's History; Next check has its
 * own "Due soon" view; the link count is in the page's Results.
 */
export const NARROW_DROPS: readonly string[] = ['updated', 'next', 'citations']

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

/**
 * The hidden columns the grid shows with. A person's own column choice is kept
 * (the grid then scrolls sideways if it must); the default set drops
 * `NARROW_DROPS` one by one until the row fits `width`. A width of 0 (not
 * measured yet) keeps the default.
 */
export function fitHidden(
  columns: readonly GridColumn<AllPageRow>[],
  hidden: readonly string[],
  width: number,
  extra: readonly ListColumn<AllPageRow>[]
): readonly string[] {
  if (width <= 0 || !sameList(hidden, DEFAULT_HIDDEN)) return hidden
  let next = hidden
  const fits = (list: readonly string[]): boolean =>
    columnsFit([...toListColumns(columns, list), ...extra], width, { selectable: true, menu: true })
  for (const id of NARROW_DROPS) {
    if (fits(next)) return next
    next = [...next, id]
  }
  return next
}
