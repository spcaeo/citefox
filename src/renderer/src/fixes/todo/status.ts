import type { ProjectFix } from '@shared/ipc'
import type { PageFix } from '@shared/page-fixes'

/**
 * What to fix › Status (a status column): where each page fix stands.
 *
 * - New: nothing done yet.
 * - Brief ready: CiteFox AI wrote its brief, and the brief is saved (`fixes:saveBrief`).
 * - Logged: it was published ("I published this"), or a change was logged on its page
 *   after the searches were last checked, so it sits in Changes made until measured.
 *
 * Derived, never typed in: a brief saved, or a change logged, moves it on. Pure.
 */
export const FIX_STATUSES = ['new', 'brief', 'logged'] as const
export type FixStatus = (typeof FIX_STATUSES)[number]

export const FIX_STATUS_LABEL: Readonly<Record<FixStatus, string>> = {
  new: 'New',
  brief: 'Brief ready',
  logged: 'Logged'
}

export const FIX_STATUS_TONE = { new: 'neutral', brief: 'info', logged: 'ok' } as const

/** The status filter from the URL (`?state=`), or null for every status. */
export function statusFilter(value: string | null): FixStatus | null {
  return FIX_STATUSES.find((status) => status === value) ?? null
}

/**
 * The newest change logged from this page fix ("I published this"), else on the fix's
 * page after its searches were last checked, or null.
 */
export function loggedChange(fix: PageFix, logged: readonly ProjectFix[]): ProjectFix | null {
  const own = logged.filter((item) => item.fix.pageFixId === fix.id)
  if (own.length > 0) {
    return own.reduce((best, item) => (item.fix.goLiveAt > best.fix.goLiveAt ? item : best))
  }
  const pageId = fix.page?.pageId ?? null
  if (pageId === null) return null
  const lastCheck = fix.searches.reduce<number>((latest, search) => {
    const at = search.checkedAt === null ? Number.NaN : Date.parse(search.checkedAt)
    return Number.isNaN(at) ? latest : Math.max(latest, at)
  }, Number.NEGATIVE_INFINITY)
  let best: { item: ProjectFix; at: number } | null = null
  for (const item of logged) {
    if (item.fix.pageId !== pageId) continue
    const at = Date.parse(item.fix.createdAt ?? item.fix.goLiveAt)
    if (Number.isNaN(at) || at < lastCheck) continue
    if (best === null || at > best.at) best = { item, at }
  }
  return best?.item ?? null
}

/** Logged beats Brief ready beats New. */
export function fixStatusOf(
  fix: PageFix,
  briefs: ReadonlySet<string>,
  logged: readonly ProjectFix[]
): FixStatus {
  if (loggedChange(fix, logged) !== null) return 'logged'
  return briefs.has(fix.id) ? 'brief' : 'new'
}
