import type { ListFooterInfo } from './types'

/** Default footer line: "1–25 of 118" while paged, else "118 keywords" (owner 2026-10-30: just the count). */
export function defaultSummary(
  info: ListFooterInfo,
  noun: readonly [string, string],
  paged: boolean
): string {
  const count = (n: number): string => n.toLocaleString('en-US')
  if (info.matching === 0) return `0 ${noun[1]}`
  if (paged) return `${count(info.first)}–${count(info.last)} of ${count(info.matching)}`
  return `${count(info.matching)} ${info.matching === 1 ? noun[0] : noun[1]}`
}
