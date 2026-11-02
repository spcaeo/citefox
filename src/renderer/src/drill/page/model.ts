import type { ListFooterInfo } from '../../ui/listGrid/types'

function n(value: number): string {
  return value.toLocaleString('en-US')
}

/** "Showing all 14", or "Showing 3 of 14" while a search narrows it. */
export function showingText(shown: number, of: number): string {
  return shown === of ? `Showing all ${n(of)}` : `Showing ${n(shown)} of ${n(of)}`
}

/**
 * A drill page list's footer line (ListGrid `summary`): "Showing all 14",
 * "Showing 3 of 14" after a search, "1–25 of 118" while paged.
 */
export function drillSummary(info: ListFooterInfo): string {
  if (info.matching > 0 && info.last - info.first + 1 < info.matching) {
    return `${n(info.first)}–${n(info.last)} of ${n(info.matching)}`
  }
  return showingText(info.matching, info.total)
}
