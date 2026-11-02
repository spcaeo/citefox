import type { Num, Part, ReviewReport } from './types'

function isNum(value: unknown): value is Num {
  return (
    typeof value === 'object' &&
    value !== null &&
    'n' in value &&
    'drill' in value &&
    typeof (value as Num).drill === 'string'
  )
}

/**
 * Every number a report shows, keyed by where it sits ("verdict.kpis.0.now", a drill
 * id's count "drill:cite:a"). The parity test compares the app's and the downloaded
 * file's reports with this, so the two can never disagree silently.
 */
export function reportFigures(report: ReviewReport): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  const walk = (value: unknown, path: string): void => {
    if (path === 'drills' || path === 'questionsById' || path === 'pagesByUrl') return
    if (typeof value === 'number') {
      out[path] = value
      return
    }
    if (value === null || typeof value !== 'object') return
    if (isNum(value)) {
      out[path] = value.n
      return
    }
    for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key)
  }
  walk(report, '')
  for (const [id, drill] of Object.entries(report.drills)) out[`drill:${id}`] = drill.ids.length
  return out
}

/** A sentence as plain text (numbers as their value), for tests and the email body. */
export function partsText(parts: readonly Part[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : String(part.n))).join('')
}
