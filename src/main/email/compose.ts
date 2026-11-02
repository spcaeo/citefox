import type { CheckFinishedNotice } from '@shared/ipc'
import { normalizeCheckRunResult, type CheckRunResult } from '../queue/runner'
import { VIEW_RESULTS } from './types'
import { matchesOnChange } from './reports/changes'
import type { ChangeEvent, ChangeKind, DesktopNotice, PageCheckFacts, ReportFacts } from './types'

/** FR-23.7. Unknown tokens stay as written. A null fact leaves its token in place. */
export function renderSubject(template: string, facts: ReportFacts): string {
  return template
    .replaceAll('{project}', facts.project ?? '{project}')
    .replaceAll('{date_range}', facts.dateRange ?? '{date_range}')
    .replaceAll('{market}', facts.market ?? '{market}')
    .replaceAll('{score}', facts.score ?? '{score}')
}

/**
 * FR-24.7. The body uses only the notice fields.
 * `No score yet` is the conservative wording when `score` is null. Copy is an open question.
 */
export function desktopNoticeFor(notice: CheckFinishedNotice): DesktopNotice {
  const cited = `AIOs citing this page: ${notice.pageCited} of ${notice.aiosShown}${formatChange(notice.pageCitedChange)}`
  const score =
    notice.score === null
      ? 'No score yet'
      : `Score: ${notice.score}${formatChange(notice.scoreChange)}`
  const changed = `Page changed: ${notice.contentChanged ? 'yes' : 'no'}`
  return {
    projectId: notice.projectId,
    pageId: notice.pageId,
    title: notice.pageLabel,
    body: [cited, score, changed].join('\n'),
    action: VIEW_RESULTS
  }
}

/**
 * Facts for one page from the runner result the queue consumed.
 * The engine reports a user cancel as `{ outcome: 'error', message: 'Check cancelled.' }`.
 * That page is `cancelled`, not `failed`.
 */
export function pageCheckFactsForRun(
  notice: CheckFinishedNotice,
  result: CheckRunResult
): PageCheckFacts {
  const normalized = normalizeCheckRunResult(result)
  if (normalized.outcome === 'cancelled') return { notice, failed: false, cancelled: true }
  return { notice, failed: normalized.outcome === 'error' }
}

/** The check-summary email uses the same facts as the desktop notice (FR-23.13, FR-24.7). */
export function checkSummaryLines(projectName: string, pages: readonly PageCheckFacts[]): string {
  const blocks = pages
    .filter((page) => page.cancelled !== true)
    .map((page) => [page.notice.pageLabel, desktopNoticeFor(page.notice).body].join('\n'))
  return [projectName, ...blocks].join('\n\n')
}

/**
 * FR-23.8. Lost and gained use `pageCitedChange` on the tracked page.
 * A null change is the first check: no lost or gained event is invented.
 * Score drop is included only when the drop is greater than N.
 */
export function changeEventsFromPages(
  pages: readonly PageCheckFacts[],
  scoreDropPoints: number | null
): ChangeEvent[] {
  const events: ChangeEvent[] = []
  for (const page of pages) {
    if (page.cancelled === true) continue
    const notice = page.notice
    if (notice.pageCitedChange !== null && notice.pageCitedChange < 0) {
      events.push(event('lost_citation', notice))
    }
    if (notice.pageCitedChange !== null && notice.pageCitedChange > 0) {
      events.push(event('gained_citation', notice))
    }
    if (
      scoreDropPoints !== null &&
      notice.scoreChange !== null &&
      -notice.scoreChange > scoreDropPoints
    ) {
      events.push({
        kind: 'score_drop',
        pageId: notice.pageId,
        pageLabel: notice.pageLabel,
        points: -notice.scoreChange
      })
    }
    if (page.failed) events.push(event('check_failed', notice))
  }
  return events
}

/** One line per event. The email lists every event (FR-23.8). */
export function changeEventLines(events: readonly ChangeEvent[]): string {
  return events.map(lineForEvent).join('\n')
}

export function applicableChangeEvents(
  events: readonly ChangeEvent[],
  scoreDropPoints: number,
  selected: readonly ChangeKind[]
): ChangeEvent[] {
  return events.filter((event) => matchesOnChange(event, { events: selected, scoreDropPoints }))
}

function event(
  kind: 'lost_citation' | 'gained_citation' | 'check_failed',
  notice: CheckFinishedNotice
): ChangeEvent {
  return { kind, pageId: notice.pageId, pageLabel: notice.pageLabel, points: null }
}

function lineForEvent(event: ChangeEvent): string {
  if (event.kind === 'lost_citation') return `${event.pageLabel} lost a citation`
  if (event.kind === 'gained_citation') return `${event.pageLabel} gained a citation`
  if (event.kind === 'score_drop')
    return `${event.pageLabel} score dropped by ${event.points} points`
  return `${event.pageLabel} check failed`
}

function formatChange(change: number | null): string {
  if (change === null) return ''
  if (change > 0) return ` (+${change})`
  return ` (${change})`
}
