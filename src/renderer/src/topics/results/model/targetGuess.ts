import type { TopicResultRow } from '@shared/domain'
import { SURE_FIT } from '@shared/topic-scoring'
import { targetPagePath } from '@shared/target-page'

export interface TargetGuess {
  url: string
  /** Questions this page is the sure best page for. */
  fits: number
  /** Their average fit %. */
  avgFit: number
}

/** The page that is the sure best page for most questions (two at least), or null. */
export function targetGuess(rows: readonly TopicResultRow[]): TargetGuess | null {
  const tally = new Map<string, { url: string; fits: number; total: number }>()
  for (const row of rows) {
    const url = row.aiPageUrl ?? null
    const fit = row.matchConfidence
    if (url === null || fit === null || fit < SURE_FIT) continue
    const key = targetPagePath(url)
    const entry = tally.get(key) ?? { url, fits: 0, total: 0 }
    entry.fits += 1
    entry.total += fit
    tally.set(key, entry)
  }
  const best = [...tally.values()].sort((a, b) => b.fits - a.fits || b.total - a.total)[0]
  if (best === undefined || best.fits < 2) return null
  return { url: best.url, fits: best.fits, avgFit: Math.round(best.total / best.fits) }
}
