import type { Count } from './types'

/**
 * Drill lists for one report (NFR-14). Every clickable number is registered here, so the
 * drawer that opens for it lists exactly `n` rows.
 *
 * A token is re-used when the same token is registered with the same ids. The same token
 * with different ids gets a `#2`, `#3` suffix, so two numbers can never share a list that
 * matches only one of them.
 */
export class DrillRegistry {
  private readonly lists = new Map<string, readonly string[]>()

  count(token: string, ids: Iterable<string>): Count {
    const list = unique(ids)
    const existing = this.lists.get(token)
    if (existing === undefined) {
      this.lists.set(token, list)
      return { n: list.length, drill: token }
    }
    if (sameIds(existing, list)) return { n: list.length, drill: token }
    for (let suffix = 2; ; suffix += 1) {
      const next = `${token}#${suffix}`
      const taken = this.lists.get(next)
      if (taken === undefined) {
        this.lists.set(next, list)
        return { n: list.length, drill: next }
      }
      if (sameIds(taken, list)) return { n: list.length, drill: next }
    }
  }

  /** A number that does not drill (pages, citations, claims). */
  static plain(n: number): Count {
    return { n, drill: null }
  }

  toRecord(): Record<string, readonly string[]> {
    const record: Record<string, readonly string[]> = {}
    for (const [token, ids] of this.lists) record[token] = ids
    return record
  }
}

function unique(ids: Iterable<string>): string[] {
  const seen = new Set<string>()
  const list: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    list.push(id)
  }
  return list
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}
