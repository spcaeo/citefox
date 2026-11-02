import type { Row } from './catalog'
import { normalDomain, plainText } from './catalog'
import type { ImportTallies } from './tallies'

/**
 * The project's competitor and brand lists live as JSON arrays in its one
 * `project_settings` row. Each competitor counts on its own in the result, and
 * the same domain typed twice ("Acme.com", "https://www.acme.com/") is one.
 */

function readList(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function competitorKey(value: string): string {
  return value.includes('.') ? normalDomain(value) : plainText(value)
}

/** `existing` first, then each of `incoming` not already there. */
function union(
  existing: readonly string[],
  incoming: readonly string[],
  keyOf: (value: string) => string,
  onItem?: (added: boolean) => void
): string[] {
  const seen = new Set(existing.map(keyOf))
  const out = [...existing]
  for (const item of incoming) {
    const key = keyOf(item)
    if (key.length === 0 || seen.has(key)) {
      onItem?.(false)
      continue
    }
    seen.add(key)
    out.push(item)
    onItem?.(true)
  }
  return out
}

/** The competitors in a settings row (for the preview count). */
export function competitorCount(row: Row | undefined): number {
  if (row === undefined) return 0
  return union([], readList(row.competitors), competitorKey).length
}

/**
 * The settings row from the file with its lists cleaned, merged into `target`'s
 * lists when there is one (Replace). The list mirrors the product catalog's
 * competitors, which are counted row by row; only a file without a catalog
 * (`counted`) tallies the list one competitor at a time.
 */
export function mergeSettingsLists(
  file: Row,
  target: Row | null,
  tallies: ImportTallies,
  counted: boolean
): Row {
  const competitors = union(
    readList(target?.competitors),
    readList(file.competitors),
    competitorKey,
    (added) => {
      if (!counted) return
      if (added) tallies.added('competitors')
      else
        tallies.left(
          'competitors',
          'skipped',
          'competitor',
          target === null ? 'listed twice in the file' : 'already in the project',
          true
        )
    }
  )
  const brands = union(readList(target?.brand_names), readList(file.brand_names), plainText)
  return {
    ...file,
    competitors: JSON.stringify(competitors),
    brand_names: JSON.stringify(brands)
  }
}
