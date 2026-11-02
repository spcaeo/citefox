import type { MetricCheck, MetricScope } from '@shared/metrics'
import {
  ONE_CHECK_KINDS,
  REPORT_KINDS,
  REPORT_SECTIONS,
  REVIEW_LENSES,
  type ReportKind,
  type ReviewLens,
  type ReviewSectionId
} from '@shared/report/review'

/**
 * Reports' place on the URL (`#/reports?…`), so every view has a link:
 *
 *   tab      ready (default) | emails
 *   view     schedules (default) | history | sends   (inside Scheduled emails)
 *   report   visibility | changed | impact | pitch | content | rival  (absent: the home)
 *   section  the report's tab, such as `verdict`
 *   scope    project (default) | topic:<id> | page:<id>
 *   from     a check id, `none`, or absent (the first check)
 *   to       a check id, or absent (the latest check)
 *   market   a market id, or absent (each page's default market)
 *   engine   an engine id, or absent (All engines; engines/useEngineFilter owns it)
 *   seg      the Topics lens (topic, funnel, intent, pageType)
 *   show     the Questions chip;  pshow  the Published pages chip;  q  the table search
 *   qt       the Questions topic filter;  kind  the Competitors kind of site
 *   layout   the Reports home view: goals (default, absent) or reports
 *   rival    Head-to-head: the rival's domain (absent: the top competitor)
 *
 * The open drawers are `drawer=report-drill&rd=<drill>` and, over it,
 * `drawer=report-detail&rd2=<item>` (shell/drawerUrl).
 */
export const REVIEW_KEYS = [
  'tab',
  'view',
  'delivery',
  'report',
  'section',
  'scope',
  'from',
  'to',
  'market',
  'seg',
  'show',
  'pshow',
  'q',
  'qt',
  'kind',
  'layout',
  'rival'
] as const

export type ReviewKey = (typeof REVIEW_KEYS)[number]
export type ReviewQuery = Partial<Record<ReviewKey, string | null | undefined>>

export type HomeTab = 'ready' | 'emails'

/** Old links to a schedule list (`view=history`) open Scheduled emails. */
export function homeTabOf(query: ReviewQuery, ready = true): HomeTab {
  if (query.tab === 'emails' || query.view === 'history' || query.view === 'sends') return 'emails'
  if (query.report) return 'ready'
  return ready ? 'ready' : 'emails'
}

export function reportOf(query: ReviewQuery): ReportKind | null {
  const value = query.report
  return REPORT_KINDS.find((kind) => kind === value) ?? null
}

export function sectionOf(kind: ReportKind, query: ReviewQuery): ReviewSectionId {
  const sections = REPORT_SECTIONS[kind]
  return sections.find((id) => id === query.section) ?? sections[0]!
}

export function lensOf(query: ReviewQuery): ReviewLens {
  return REVIEW_LENSES.find((lens) => lens === query.seg) ?? 'topic'
}

export function scopeOf(query: ReviewQuery): MetricScope {
  const value = query.scope ?? ''
  const at = value.indexOf(':')
  if (at > 0) {
    const kind = value.slice(0, at)
    const id = value.slice(at + 1)
    if ((kind === 'topic' || kind === 'page') && id.length > 0) return { kind, id }
  }
  return { kind: 'project' }
}

export function scopeValue(scope: MetricScope): string | null {
  return scope.kind === 'project' ? null : `${scope.kind}:${scope.id}`
}

/** One pickable check: a day's last finished check stands for that day. */
export interface CheckOption {
  id: string
  at: string
}

/** The checks to pick from, one per calendar day (in `dayOf`'s zone), oldest first. */
export function checkOptions(
  checks: readonly MetricCheck[],
  dayOf: (iso: string) => string
): CheckOption[] {
  const byDay = new Map<string, MetricCheck>()
  for (const check of checks) {
    const day = dayOf(check.at)
    const known = byDay.get(day)
    if (known === undefined || check.at > known.at) byDay.set(day, check)
  }
  return [...byDay.values()]
    .map((check) => ({ id: check.id, at: check.at }))
    .sort((left, right) => left.at.localeCompare(right.at))
}

/**
 * The window asked of `reports:metrics`. The Visibility report reads the latest check
 * only. The others compare From with To: by default the first check (`first`) with the
 * latest.
 */
export function windowOf(
  kind: ReportKind,
  query: ReviewQuery
): { from: string | null; to: string | null } {
  const to = query.to || null
  if (ONE_CHECK_KINDS.has(kind) || query.from === 'none') return { from: null, to }
  return { from: query.from || 'first', to }
}
