import { VERDICT_WAIT_DAYS } from '../../fix-verdict'
import type { MetricsResult } from '../../metrics/types'
import type { ReportExtras } from './extras'
import type { NeedAction, ReportNeeds } from './impact-types'
import { plural } from './items'
import type { ReportContext, ReportKind, ReviewReport, ReviewSectionId } from './types'

/**
 * Little data (Docs/REPORT-SPEC.md "Little data"), for all three reports: what a report
 * needs before it can say anything, and which tabs have nothing to show yet. A tab with
 * nothing is hidden (Lost ground, Not indexed) or greyed out with one line saying what it
 * needs, never a page of zeros.
 */

/** The checks each report needs to say anything. */
const CHECKS_NEEDED: Readonly<Record<ReportKind, number>> = {
  visibility: 1,
  changed: 2,
  impact: 2,
  pitch: 1,
  content: 1,
  rival: 1
}

export function scheduleLine(extras: ReportExtras, ctx: ReportContext): string {
  if (extras.nextCheckAt === null) {
    return 'No check is scheduled. Set one in Project settings, Schedule.'
  }
  const every = extras.intervalDays
    ? `, then every ${extras.intervalDays} ${plural(extras.intervalDays, 'day')}`
    : ''
  return `Next check on ${ctx.day(extras.nextCheckAt)}${every}.`
}

export function reportNeeds(
  kind: ReportKind,
  metrics: MetricsResult,
  extras: ReportExtras,
  ctx: ReportContext
): ReportNeeds | null {
  const checks = metrics.checks.length
  const fixes = metrics.pages.published.n
  const needChecks = checks < CHECKS_NEEDED[kind]
  const needFixes = kind === 'impact' && fixes === 0
  if (!needChecks && !needFixes) return null
  const items: { done: boolean; text: string }[] = []
  if (kind === 'impact') {
    items.push(
      fixes > 0
        ? {
            done: true,
            text: `${fixes} ${plural(fixes, 'page')} published ${plural(fixes, 'is', 'are')} logged.`
          }
        : {
            done: false,
            text: 'Log the pages you published or rewrote, with the day each went live. None are logged yet.'
          }
    )
  }
  if (CHECKS_NEEDED[kind] === 1) {
    items.push({ done: false, text: 'Run a first check of your tracked questions.' })
  } else {
    items.push(
      checks >= 2
        ? { done: true, text: `${checks} checks to compare.` }
        : {
            done: false,
            text:
              checks === 1
                ? `Run a second check${kind === 'impact' ? `, about ${VERDICT_WAIT_DAYS} days after the pages go live` : ''}. There is 1 check so far.`
                : 'Run a first check, then a second one to compare with.'
          }
    )
  }
  const actions: NeedAction[] = []
  if (needFixes) actions.push('fix')
  if (needChecks) actions.push('check')
  actions.push('schedule')
  const lead =
    kind === 'impact'
      ? 'This review shows what your published pages did for your AI citations. It needs two things first.'
      : kind === 'changed'
        ? 'What changed compares two checks. There is only one so far.'
        : kind === 'visibility'
          ? 'This report reads your latest check. There is none yet.'
          : 'This report reads your latest check, so one check is enough. There is none yet.'
  return {
    title: 'What this report needs',
    lead,
    items,
    actions,
    nextCheck: scheduleLine(extras, ctx)
  }
}

/** Tabs hidden when they have nothing to show. */
const HIDE_WHEN_EMPTY: ReadonlySet<ReviewSectionId> = new Set(['lost', 'notindexed'])

type Built = Omit<ReviewReport, 'drills' | 'sections'>

/** One line per tab with nothing to show: what it needs. Tabs not listed have content. */
export function emptyLines(
  report: Built,
  metrics: MetricsResult
): Partial<Record<ReviewSectionId, string>> {
  const out: Partial<Record<ReviewSectionId, string>> = {}
  const noCheck = metrics.now.checked.n === 0
  if (noCheck) out.standing = 'Needs a finished check.'
  if (report.published.rows.length === 0) {
    out.published =
      'Needs a logged fix: log the pages you published or rewrote, and they show here.'
  }
  if (!report.comparing || metrics.checks.length < 2) {
    out.changed = 'Needs a second check to compare with.'
  }
  if (report.questions.rows.length === 0) out.questions = 'Needs a finished check.'
  if (report.competitors.all.length === 0) {
    out.competitors = 'Needs AI answers that cite other sites.'
  }
  if (report.pages.bars.length === 0) {
    out.pages = 'Needs a check where an AI answer cites one of your pages.'
  }
  if (report.lostGround.items.length === 0) out.lost = 'No page lost ground.'
  if (Object.values(report.topics.lenses).every((rows) => rows.length === 0)) {
    out.topics = 'Needs questions grouped into topics.'
  }
  const deep = report.deep
  if (
    deep.shapes === null &&
    deep.agree === null &&
    deep.spread.every((bar) => bar.now === 0 && bar.before === 0)
  ) {
    out.deep = 'Needs stored AI answers to read.'
  }
  if (report.notIndexed.rows.length === 0) out.notindexed = 'Every published page is indexed.'
  const { pitch, content, rival } = report.ready
  if (noCheck || pitch.kpis.length === 0) out.summary = 'Needs a finished check.'
  if (pitch.plan.length === 0) {
    out.plan = noCheck
      ? 'Needs a finished check.'
      : 'Nothing to fix first: every AI answer already cites the right page.'
  }
  if (content.groups.length === 0) {
    out.writeplan = noCheck
      ? 'Needs a finished check.'
      : metrics.now.answered.n === 0
        ? 'Needs a check where an AI answer shows.'
        : 'Nothing to write: every AI answer cites the right page of yours.'
  }
  if (rival.domain === null) out.h2h = 'Needs AI answers that cite another business’s site.'
  if (report.backlinks.rows.length === 0) {
    out.backlinks = `No page needs links yet. A page shows here once it is live ${VERDICT_WAIT_DAYS}+ days without a citation, or loses ground.`
  }
  return out
}

/** The report's tabs: empty ones hidden or marked with what they need. */
export function sectionsOf(
  ids: readonly ReviewSectionId[],
  titles: Readonly<Record<ReviewSectionId, string>>,
  empty: Partial<Record<ReviewSectionId, string>>,
  alerts: ReadonlySet<ReviewSectionId>
): ReviewReport['sections'] {
  return ids
    .filter((id) => !(HIDE_WHEN_EMPTY.has(id) && empty[id] !== undefined))
    .map((id) => ({
      id,
      title: titles[id],
      ...(alerts.has(id) ? { alert: true } : {}),
      ...(empty[id] !== undefined ? { empty: empty[id] } : {})
    }))
}
