import type { IntervalDays, SampleCount } from '@shared/domain'
import type { EngineHost } from '../engine/host'
import { STAGGER_WINDOW_DAYS } from '../scheduler/intervals'
import { staggerFirstChecks } from '../scheduler/stagger'
import type { SqliteDatabase } from '../storage/database'
import { readProjectProfile } from '../storage/project-profile'
import { trackPages } from '../storage/structure-pages'

export interface TrackOptions {
  marketIds: readonly string[]
  intervalDays: IntervalDays
  samples: SampleCount
  promptCount: number
  /** SCH-12 and FR-20.6: spread first checks over 7 days. */
  stagger: boolean
}

export interface TrackOutcome {
  changed: string[]
  firstCheckFrom: string | null
  firstCheckUntil: string | null
}

/** Project default market id, or an empty list when the project has none. */
export function defaultMarketIds(db: SqliteDatabase): string[] {
  const market = readProjectProfile(db)?.market
  return market === undefined ? [] : [market.id]
}

/**
 * Tracks pages in one transaction (Import pages, Track cluster, Track silo,
 * and the sitemap sync rules). With `stagger`, page `i` of `n` waits
 * `floor(i * 7 / n)` local days before its first check (SCH-12).
 */
export function trackInProject(
  host: Pick<EngineHost, 'now'>,
  db: SqliteDatabase,
  pageIds: readonly string[],
  options: TrackOptions
): TrackOutcome {
  const unique = [...new Set(pageIds)]
  const now = host.now().toISOString()
  const holds = new Map<string, string>()
  if (options.stagger && unique.length > 1) {
    const slots = staggerFirstChecks(unique, {
      startAt: now,
      timeZone: systemTimeZone(),
      days: STAGGER_WINDOW_DAYS
    })
    for (const slot of slots) {
      if (slot.dayOffset > 0) holds.set(slot.pageId, slot.firstCheckNotBefore)
    }
  }
  const changed = db.transaction(() =>
    trackPages(db, unique, {
      marketIds: options.marketIds,
      intervalDays: options.intervalDays,
      samples: options.samples,
      promptCount: options.promptCount,
      addedAt: now,
      firstCheckNotBefore: holds
    })
  )()
  if (changed.length === 0) return { changed, firstCheckFrom: null, firstCheckUntil: null }
  let until = now
  for (const id of changed) {
    const at = holds.get(id)
    if (at !== undefined && at > until) until = at
  }
  return { changed, firstCheckFrom: now, firstCheckUntil: until }
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
