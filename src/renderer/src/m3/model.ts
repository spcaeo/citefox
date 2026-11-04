import type {
  AioReference,
  CoverageLevel,
  FunnelStep,
  FunnelStepId,
  IntentStage,
  LeaderboardBadge,
  OpportunityBucketId,
  PageResults,
  PromptCheckRow,
  PromptCheckStatus,
  PromptMovement
} from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { REPORT_DEFINITIONS, REPORT_KPI_LABELS } from '@shared/report-copy'
import { promptSetVersionLabel } from './promptSetVersion'
import { formatClock, formatDay, formatMoment, formatWhen } from '../utils/dates'
import { cycleSort, type SortSpec } from '../utils/sort'

export { cycleSort, formatClock, formatDay, formatMoment, formatWhen, type SortSpec }

/** Order arrays. The matching consts in `src/shared` are not exported. */
export const FUNNEL_STEPS: readonly FunnelStepId[] = [
  'checked',
  'aio_shown',
  'own_domain',
  'this_page',
  'cited_and_named'
]
export const OPPORTUNITY_BUCKETS: readonly OpportunityBucketId[] = [
  'winning',
  'cited_only',
  'named_not_linked',
  'invisible'
]
export const LEADERBOARD_BADGES: readonly LeaderboardBadge[] = ['you', 'tracked', 'observed']
export const STATUS_ORDER: readonly PromptCheckStatus[] = [
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited',
  'no_aio',
  'error'
]
export const MOVEMENT_ORDER: readonly PromptMovement[] = [
  'gained',
  'improved',
  'unchanged',
  'declined',
  'lost'
]
export const COVERAGE_ORDER: readonly CoverageLevel[] = ['strong', 'partial', 'weak', 'none']

const AIO_STATUS: ReadonlySet<PromptCheckStatus> = new Set([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

/**
 * A check's result in the four shared words (owner, 2026-10-29): Target page, Your other
 * page, Not cited, No AI Overview. The brand named without a link is Not cited with a
 * "named" note, never a fifth result; a failed search reads "Check failed".
 */
export function statusLabel(status: PromptCheckStatus): string {
  switch (status) {
    case 'page_cited':
      return 'Right page'
    case 'other_own_page':
      return 'Your other page'
    case 'brand_mentioned':
      return 'Not cited · named'
    case 'not_cited':
      return 'Not cited'
    case 'no_aio':
      return 'No AI Overview'
    case 'error':
      return 'Check failed'
  }
}

export function movementLabel(
  movement: PromptMovement | null,
  previousStatus: PromptCheckStatus | null = null,
  previousPosition: number | null = null
): string {
  switch (movement) {
    case null:
      return '—'
    case 'gained':
      return 'Gained'
    case 'improved':
      return 'Improved'
    case 'declined':
      return 'Declined'
    case 'unchanged':
      return 'Unchanged'
    case 'lost':
      return previousStatus
        ? `Lost (was ${statusLabel(previousStatus)} · ${previousPosition ?? '—'})`
        : 'Lost'
  }
}

export function stageLabel(stage: IntentStage): string {
  switch (stage) {
    case 'problem':
      return 'Problem'
    case 'solution':
      return 'Solution'
    case 'trigger':
      return 'Trigger'
    case 'comparison':
      return 'Comparison'
    case 'objection':
      return 'Objection'
    case 'unset':
      return 'Unset'
  }
}

export function coverageLabel(level: CoverageLevel | null): string {
  switch (level) {
    case 'strong':
      return 'Strong'
    case 'partial':
      return 'Partial'
    case 'weak':
      return 'Weak'
    case 'none':
      return 'None'
    case null:
      return '—'
  }
}

export function badgeLabel(badge: LeaderboardBadge): 'You' | 'Tracked' | 'Observed' {
  if (badge === 'you') return 'You'
  if (badge === 'tracked') return 'Tracked'
  return 'Observed'
}

export function badgeFilterLabel(badge: LeaderboardBadge): string {
  return badge === 'tracked' ? 'Tracked competitor' : badgeLabel(badge)
}

export function countNoun(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "N of M prompts". The noun agrees with the total, and both counts use en-US grouping. */
function countOf(shown: number, total: number, singular: string, plural = `${singular}s`): string {
  return `${shown.toLocaleString('en-US')} of ${pluralize(total, singular, plural)}`
}

export function showingPrompts(shown: number, total: number): string {
  return `Showing ${countOf(shown, total, 'question')}`
}

export function checkingHeading(prompts: number, markets: number): string {
  return `Checking ${pluralize(prompts, 'question')} in ${pluralize(markets, 'market')}`
}

export function buyerPromptsLabel(count: number): string {
  return pluralize(count, 'buyer question')
}

export function scoredPromptsLabel(count: number): string {
  return `See the ${pluralize(count, 'scored question')}`
}

export function ofPrompts(count: number): string {
  return `of ${pluralize(count, 'question')}`
}

export function funnelPrompts(count: number, total: number, pct: number): string {
  return `${countOf(count, total, 'question')} · ${pct}%`
}

export function aiOverviewLabel(count: number): string {
  return pluralize(count, 'AI Overview')
}

export function showingDomains(shown: number, total: number): string {
  return `showing ${countOf(shown, total, 'domain')}`
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

export function signed(delta: number, suffix = ''): string {
  if (delta === 0) return `0${suffix}`
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${Math.abs(delta)}${suffix}`
}

export function hasAio(row: Pick<PromptCheckRow, 'status'>): boolean {
  return AIO_STATUS.has(row.status)
}

/** Drawer and CSV "AIO" cell. A failed search did not see Google's answer, so it is unknown. */
export function aioLabel(row: Pick<PromptCheckRow, 'status'>): 'Yes' | 'No' | 'Unknown' {
  if (row.status === 'error') return 'Unknown'
  return hasAio(row) ? 'Yes' : 'No'
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function displayUrl(url: string | null): string {
  if (!url) return '—'
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

/**
 * When a check ran, as the computer shows it: "Oct 19, 3:12 PM" in its own zone and
 * clock (12- or 24-hour), with the year only when it is not this year (formatMoment).
 */
export function formatStamp(iso: string | null): string {
  return formatMoment(iso)
}

/** A row's "Checked …" time: the same as {@link formatStamp}. */
export function formatChecked(iso: string | null): string {
  return formatMoment(iso)
}

/** "Oct 19", in the computer's own day order. */
export function formatMonthDay(iso: string | null): string {
  return formatDay(iso, { year: false })
}

export function sameLocalDay(iso: string | null, now: Date): boolean {
  if (!iso) return false
  const date = new Date(iso)
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

export function freshnessLine(results: PageResults, now = new Date()): string {
  if (!results.scope.checkedAt) return 'No check yet'
  if (results.scope.stale) return 'Latest check is more than 7 days old'
  if (sameLocalDay(results.scope.checkedAt, now))
    return 'Up to date: the latest check is from today'
  return `Up to date: the latest check is from ${formatMoment(results.scope.checkedAt)}`
}

export function brandName(results: PageResults): string {
  return results.scope.brands[0] ?? hostFromUrl(results.scope.pageUrl)
}

export function ownDomain(results: PageResults): string {
  return hostFromUrl(results.scope.pageUrl)
}

export function rowsById(results: PageResults): ReadonlyMap<string, PromptCheckRow> {
  return new Map(results.prompts.map((row) => [row.promptId, row]))
}

export function rowsFor(results: PageResults, ids: readonly string[]): PromptCheckRow[] {
  const byId = rowsById(results)
  const rows: PromptCheckRow[] = []
  for (const id of ids) {
    const row = byId.get(id)
    if (row) rows.push(row)
  }
  return rows
}

/** Other domains the overview cited, in position order. */
export function citedInstanceNames(
  refs: readonly AioReference[] | undefined,
  domain: string
): string[] {
  if (!refs || refs.length === 0) return []
  return refs
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((ref) => ref.domain !== domain)
    .map((ref) => ref.domain)
}

export function citedInstead(refs: readonly AioReference[] | undefined, domain: string): string {
  const names = citedInstanceNames(refs, domain)
  return names.length > 0 ? names.join(', ') : '—'
}

/**
 * Visible cited-instance text. At most `limit` names, then "+N more" when
 * the overview cited more than that. `full` is the complete list.
 */
export function citedInstancePreview(
  names: readonly string[],
  limit = 2
): { shown: string; more: number; full: string } {
  if (names.length === 0) return { shown: '—', more: 0, full: '—' }
  const full = names.join(', ')
  if (names.length <= limit) return { shown: full, more: 0, full }
  const more = names.length - limit
  return { shown: `${names.slice(0, limit).join(', ')} +${more} more`, more, full }
}

export function ownLinkCount(refs: readonly AioReference[] | undefined): number {
  if (!refs) return 0
  return refs.filter((ref) => ref.classification === 'target' || ref.classification === 'own')
    .length
}

export function positionText(row: PromptCheckRow): string {
  return row.position === null ? '—' : String(row.position)
}

export function namedLabel(row: PromptCheckRow): string {
  if (row.named === null) return '—'
  return row.named ? 'Yes' : 'No'
}

function andList(items: readonly string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function positions(rows: readonly PromptCheckRow[]): string {
  return rows
    .slice()
    .sort((a, b) => a.promptPosition - b.promptPosition)
    .map((row) => row.promptPosition)
    .join(', ')
}

/**
 * The opportunity groups in the result words: cited (a page of yours is in the sources)
 * or Not cited, each with or without the brand named in the text.
 */
export function bucketLabel(id: OpportunityBucketId): string {
  switch (id) {
    case 'winning':
      return 'Cited · named'
    case 'cited_only':
      return 'Cited · not named'
    case 'named_not_linked':
      return 'Not cited · named'
    case 'invisible':
      return 'Not cited'
  }
}

export function promptNumberLabel(rows: readonly PromptCheckRow[]): string {
  if (rows.length === 0) return 'None'
  const nums = positions(rows)
  return rows.length === 1 ? `Question ${nums}` : `Questions ${nums}`
}

export function bucketSentence(results: PageResults): string {
  const counts = results.buckets.map((bucket) => bucket.count)
  const sum = counts.reduce((total, count) => total + count, 0)
  const head = `${counts.join(' + ')} = ${aiOverviewLabel(sum)}.`
  const excluded = results.prompts.filter((row) => !hasAio(row))
  if (excluded.length === 0) return `${head} Every question had an AI Overview.`
  const errors = excluded.filter((row) => row.status === 'error')
  const quiet = excluded.filter((row) => row.status === 'no_aio')
  if (errors.length === 0) {
    return `${head} The ${countNoun(quiet.length, 'question', 'questions')} with no AI Overview (${positions(quiet)}) are in no bucket.`
  }
  if (quiet.length === 0) {
    return `${head} The ${countNoun(errors.length, 'question', 'questions')} with an error (${positions(errors)}) are in no bucket.`
  }
  return `${head} The ${countNoun(excluded.length, 'question', 'questions')} with no AI Overview or an error (${positions(excluded)}) are in no bucket.`
}

export function overlaySplit(results: PageResults): string {
  const overlay = new Set(results.ugcOverlay.promptIds)
  const parts = results.buckets
    .map((bucket) => {
      const count = bucket.promptIds.filter((id) => overlay.has(id)).length
      return count > 0 ? `${count} ${bucketLabel(bucket.id)}` : null
    })
    .filter((part): part is string => part !== null)
  if (results.ugcOverlay.count === 0 || parts.length === 0) {
    return 'None of these AI Overviews put a Reddit or YouTube source above you.'
  }
  const rows = rowsFor(results, results.ugcOverlay.promptIds)
  return `Of those ${results.ugcOverlay.count}: ${parts.join(' · ')}. Questions ${positions(rows)}.`
}

export interface DrillSpec {
  id: string
  title: string
  description: string
  omitCount: boolean
  promptIds: readonly string[]
}

export function drawerTitle(drill: DrillSpec, rows: readonly PromptCheckRow[]): string {
  if (drill.omitCount) return drill.title
  return `${drill.title} · ${countNoun(rows.length, 'question', 'questions')}`
}

function funnelCopy(
  id: FunnelStepId,
  domain: string,
  brand: string,
  version: number | null | undefined
): { label: string; description: string } {
  switch (id) {
    case 'checked':
      return {
        label: 'Questions checked',
        description: `Every question in question set ${promptSetVersionLabel(version)}.`
      }
    case 'aio_shown':
      return {
        label: REPORT_KPI_LABELS.aio,
        description: 'Google showed an AI Overview for these questions.'
      }
    case 'own_domain':
      return {
        label: `${domain} cited`,
        description: `The overview links at least one ${domain} page.`
      }
    case 'this_page':
      return { label: REPORT_KPI_LABELS.pageCited, description: 'The overview links this page.' }
    case 'cited_and_named':
      return {
        label: 'Cited and named in the text',
        description: `The overview links this page and names ${brand} in the answer text.`
      }
  }
}

function dropTitle(id: FunnelStepId, domain: string, brand: string, reason: string): string {
  switch (id) {
    case 'checked':
      return 'Lost'
    case 'aio_shown':
      // A failed search is in this drop too; its overview is unknown, not missing.
      return reason === 'No AI Overview' ? 'Lost: no AI Overview' : `Lost: ${lowerFirst(reason)}`
    case 'own_domain':
      return `Lost: overview cites no ${domain} page`
    case 'this_page':
      return `Lost: another ${domain} page cited`
    case 'cited_and_named':
      return `Lost: this page linked, ${brand} not named`
  }
}

export function funnelStep(results: PageResults, id: FunnelStepId): FunnelStep | undefined {
  return results.funnel.find((step) => step.id === id)
}

export function drillFor(results: PageResults, id: string): DrillSpec | null {
  const domain = ownDomain(results)
  const brand = brandName(results)
  const version = results.scope.promptSetVersion
  if (id.startsWith('funnel:')) {
    const stepId = id.slice('funnel:'.length) as FunnelStepId
    const step = funnelStep(results, stepId)
    if (!step || !FUNNEL_STEPS.includes(stepId)) return null
    const copy = funnelCopy(stepId, domain, brand, version)
    return {
      id,
      title: copy.label,
      description: copy.description,
      omitCount: false,
      promptIds: step.promptIds
    }
  }
  if (id.startsWith('drop:')) {
    const stepId = id.slice('drop:'.length) as FunnelStepId
    const step = funnelStep(results, stepId)
    if (!step?.drop || !FUNNEL_STEPS.includes(stepId)) return null
    return {
      id,
      title: dropTitle(stepId, domain, brand, step.drop.reason),
      description: `The questions that drop out between the two steps: ${step.drop.reason}.`,
      omitCount: false,
      promptIds: step.drop.promptIds
    }
  }
  if (id.startsWith('bucket:')) {
    const bucketId = id.slice('bucket:'.length) as OpportunityBucketId
    const bucket = results.buckets.find((item) => item.id === bucketId)
    if (!bucket || !OPPORTUNITY_BUCKETS.includes(bucketId)) return null
    const copy = bucketCopy(bucketId, domain, brand)
    return {
      id,
      title: copy.title,
      description: copy.description,
      omitCount: false,
      promptIds: bucket.promptIds
    }
  }
  if (id === 'ugc') {
    return {
      id,
      title: 'Reddit or YouTube cited above you',
      description: `Overviews where a reddit.com or youtube.com source sits higher than any ${domain} link, or there is no ${domain} link. These overlap the buckets.`,
      omitCount: false,
      promptIds: results.ugcOverlay.promptIds
    }
  }
  if (id === 'kpi:score' || id === 'kpi:aio') {
    const step = funnelStep(results, 'aio_shown')
    const run = results.run
    const points = run
      ? `${run.points} of ${run.pointsPossible} points = ${run.visibilityScore ?? '—'}`
      : ''
    return {
      id,
      title: id === 'kpi:score' ? 'Scored questions' : REPORT_KPI_LABELS.aio,
      description:
        id === 'kpi:score'
          ? `Questions with an AI Overview. Each can earn 3 points: target page 3, your other page 1, not cited but named 1. ${points}.`
          : 'Questions where Google showed an AI Overview.',
      omitCount: false,
      promptIds: step?.promptIds ?? []
    }
  }
  if (id === 'kpi:page') {
    const step = funnelStep(results, 'this_page')
    return {
      id,
      title: REPORT_KPI_LABELS.pageCited,
      description: 'AI Overviews that link this page.',
      omitCount: false,
      promptIds: step?.promptIds ?? []
    }
  }
  if (id === 'kpi:links') {
    const step = funnelStep(results, 'own_domain')
    const run = results.run
    const links = run ? run.citationsThisPage + run.citationsOtherOwn : 0
    const prompts = step?.count ?? 0
    const same = links === prompts
    return {
      id,
      title: `Citations to ${domain} · ${countNoun(links, 'link', 'links')} in ${countNoun(prompts, 'question', 'questions')}`,
      description: same
        ? `Each of these overviews has 1 ${domain} link, so ${countNoun(prompts, 'question', 'questions')} = ${countNoun(links, 'link', 'links')}: ${run?.citationsThisPage ?? 0} to this page, ${run?.citationsOtherOwn ?? 0} to other ${domain} pages.`
        : `${countNoun(links, 'link', 'links')} in ${countNoun(prompts, 'question', 'questions')}: ${run?.citationsThisPage ?? 0} to this page, ${run?.citationsOtherOwn ?? 0} to other ${domain} pages.`,
      omitCount: true,
      promptIds: step?.promptIds ?? []
    }
  }
  if (id.startsWith('domain:')) {
    const name = id.slice('domain:'.length)
    const row = results.leaderboard.find((item) => item.domain === name)
    if (!row) return null
    if (row.badge === 'you') {
      const step = funnelStep(results, 'own_domain')
      const copy = funnelCopy('own_domain', domain, brand, version)
      return {
        id,
        title: copy.label,
        description: copy.description,
        omitCount: false,
        promptIds: step?.promptIds ?? []
      }
    }
    return {
      id,
      title: `${name} cited`,
      description: `AI Overviews that list ${name} as a source, in any position.`,
      omitCount: false,
      promptIds: row.promptIds
    }
  }
  if (id.startsWith('gap:')) {
    const name = id.slice('gap:'.length)
    const row = results.leaderboard.find((item) => item.domain === name)
    if (!row || row.badge === 'you') return null
    return {
      id,
      title: `${name} cited, ${domain} not`,
      description: `AI Overviews that cite ${name} but no ${domain} page. This is the list to attack.`,
      omitCount: false,
      promptIds: row.gapPromptIds
    }
  }
  if (id.startsWith('overlap:')) {
    const name = id.slice('overlap:'.length)
    const row = results.leaderboard.find((item) => item.domain === name)
    if (!row || row.badge === 'you') return null
    const gap = new Set(row.gapPromptIds)
    return {
      id,
      title: `${name} cited with ${domain}`,
      description: `AI Overviews that cite both ${name} and a ${domain} page.`,
      omitCount: false,
      promptIds: row.promptIds.filter((promptId) => !gap.has(promptId))
    }
  }
  if (id.startsWith('stage:')) {
    const [stagePart = '', part] = id.slice('stage:'.length).split(':')
    const stage = stagePart as IntentStage
    const rate = results.stageRates.find((item) => item.stage === stage)
    if (!rate || (part !== undefined && part !== 'aio' && part !== 'page')) return null
    const promptIds = results.prompts
      .filter(
        (row) =>
          row.intentStage === stage &&
          (part === 'aio' ? hasAio(row) : part === 'page' ? row.status === 'page_cited' : true)
      )
      .map((row) => row.promptId)
    return {
      id,
      title:
        part === 'aio'
          ? `${stageLabel(stage)} · ${REPORT_KPI_LABELS.aio}`
          : part === 'page'
            ? `${stageLabel(stage)} · page cited`
            : stageLabel(stage),
      description:
        part === 'aio'
          ? 'Questions in this buyer stage where Google showed an AI Overview.'
          : part === 'page'
            ? 'Questions in this buyer stage whose AI Overview links this page.'
            : 'Questions in this buyer stage.',
      omitCount: false,
      promptIds
    }
  }
  if (id === 'named') {
    return {
      id,
      title: `${brand} named`,
      description: `AI Overviews that name ${brand} (or an alias) in the answer text, with or without a link.`,
      omitCount: false,
      promptIds: results.prompts.filter((row) => row.named === true).map((row) => row.promptId)
    }
  }
  if (id.startsWith('prompt:')) {
    const promptId = id.slice('prompt:'.length)
    const row = rowsById(results).get(promptId)
    if (!row) return null
    return {
      id,
      title: `Question ${row.promptPosition} · ${row.label}`,
      description: row.text,
      omitCount: true,
      promptIds: [row.promptId]
    }
  }
  return null
}

function bucketCopy(
  id: OpportunityBucketId,
  domain: string,
  brand: string
): { title: string; description: string } {
  switch (id) {
    case 'winning':
      return {
        title: `${bucketLabel(id)}: already winning`,
        description: REPORT_DEFINITIONS.winning
      }
    case 'cited_only':
      return {
        title: bucketLabel(id),
        description: `The AI Overview links a ${domain} page, but its text does not name ${brand}.`
      }
    case 'named_not_linked':
      return {
        title: bucketLabel(id),
        description: `${brand} is in the answer text, with no link to a page of yours.`
      }
    case 'invisible':
      return {
        title: bucketLabel(id),
        description: `No ${brand} link or mention in the AI Overview.`
      }
  }
}

export interface StageView {
  stage: IntentStage
  prompts: number
  aio: number
  pageCited: number
  rate: number | null
  rank: 'best' | 'weakest' | 'middle' | 'unranked'
  promptIds: readonly string[]
}

export function stageViews(results: PageResults): StageView[] {
  const views: StageView[] = results.stageRates.map((rate) => {
    const promptIds = results.prompts
      .filter((row) => row.intentStage === rate.stage)
      .map((row) => row.promptId)
    const aio = results.prompts.filter(
      (row) => row.intentStage === rate.stage && hasAio(row)
    ).length
    return {
      stage: rate.stage,
      prompts: rate.prompts,
      aio,
      pageCited: rate.pageCited,
      rate: aio === 0 ? null : percent(rate.pageCited, aio),
      rank: rate.prompts >= 2 ? 'middle' : 'unranked',
      promptIds
    }
  })
  const ranked = views.filter((view) => view.rank !== 'unranked' && view.rate !== null)
  const best = ranked.reduce(
    (max, view) => (view.rate !== null && (max === null || view.rate > max) ? view.rate : max),
    null as number | null
  )
  const weakest = ranked.reduce(
    (min, view) => (view.rate !== null && (min === null || view.rate < min) ? view.rate : min),
    null as number | null
  )
  for (const view of views) {
    if (view.rank === 'unranked' || view.rate === null) continue
    if (view.rate === best && view.rate === weakest) view.rank = 'middle'
    else if (view.rate === best) view.rank = 'best'
    else if (view.rate === weakest) view.rank = 'weakest'
  }
  return views
}

export function stageSummary(views: readonly StageView[]): string {
  const best = views.filter((view) => view.rank === 'best')
  const weakest = views.filter((view) => view.rank === 'weakest')
  const unranked = views.filter((view) => view.rank === 'unranked')
  const parts: string[] = []
  const bestRate = best[0]?.rate
  const weakRate = weakest[0]?.rate
  if (bestRate !== undefined && bestRate !== null) {
    parts.push(
      `Best: ${andList(best.map((view) => stageLabel(view.stage)))} (${bestRate}% of overviews cite this page).`
    )
  }
  if (weakRate !== undefined && weakRate !== null) {
    parts.push(`Weakest: ${andList(weakest.map((view) => stageLabel(view.stage)))} (${weakRate}%).`)
  }
  if (unranked.length === 1) {
    const only = unranked[0]
    if (only) {
      parts.push(
        `${stageLabel(only.stage)} has ${countNoun(only.prompts, 'question', 'questions')}, so it isn’t ranked.`
      )
    }
  } else if (unranked.length > 1) {
    const listed = unranked
      .map(
        (view) =>
          `${stageLabel(view.stage)} has ${countNoun(view.prompts, 'question', 'questions')}`
      )
      .join(', ')
    parts.push(`${listed}, so they aren’t ranked.`)
  }
  return parts.join(' ')
}

export function sortRows<T>(
  items: readonly T[],
  sorts: readonly SortSpec<string>[],
  value: (item: T, key: string) => string | number | null
): T[] {
  const indexed = items.map((item, index) => ({ item, index }))
  indexed.sort((a, b) => {
    for (const sort of sorts) {
      const left = value(a.item, sort.key)
      const right = value(b.item, sort.key)
      if (left === null && right === null) continue
      if (left === null) return 1
      if (right === null) return -1
      const compared =
        typeof left === 'string' || typeof right === 'string'
          ? String(left).localeCompare(String(right))
          : left - right
      if (compared !== 0) return sort.dir === 'desc' ? -compared : compared
    }
    return a.index - b.index
  })
  return indexed.map((row) => row.item)
}

/**
 * NFR-14 checks against a `PageResults` payload.
 * Segment counts equal their prompt id lists, buckets partition the AIOs, and
 * funnel drops equal the difference between adjacent steps.
 */
export function identityIssues(results: PageResults): string[] {
  const issues: string[] = []
  results.funnel.forEach((step, index) => {
    if (step.promptIds.length !== step.count) {
      issues.push(`funnel ${step.id} count ${step.count} lists ${step.promptIds.length}`)
    }
    if (step.drop && step.drop.promptIds.length !== step.drop.count) {
      issues.push(`drop ${step.id} count ${step.drop.count} lists ${step.drop.promptIds.length}`)
    }
    const previous = results.funnel[index - 1]
    if (index > 0 && previous && step.drop && step.drop.count !== previous.count - step.count) {
      issues.push(`drop ${step.id} is ${step.drop.count}, expected ${previous.count - step.count}`)
    }
  })
  const seen = new Set<string>()
  let bucketSum = 0
  for (const bucket of results.buckets) {
    bucketSum += bucket.count
    if (bucket.promptIds.length !== bucket.count) {
      issues.push(`bucket ${bucket.id} count ${bucket.count} lists ${bucket.promptIds.length}`)
    }
    for (const id of bucket.promptIds) {
      if (seen.has(id)) issues.push(`question ${id} is in more than one bucket`)
      seen.add(id)
    }
  }
  const aioIds = results.prompts.filter(hasAio).map((row) => row.promptId)
  if (results.run && bucketSum !== results.run.promptsWithAio) {
    issues.push(`buckets sum ${bucketSum}, promptsWithAio ${results.run.promptsWithAio}`)
  }
  if (bucketSum !== aioIds.length)
    issues.push(`buckets sum ${bucketSum}, aio rows ${aioIds.length}`)
  for (const id of aioIds) {
    if (!seen.has(id)) issues.push(`aio question ${id} is in no bucket`)
  }
  for (const row of results.prompts) {
    if (!hasAio(row) && seen.has(row.promptId))
      issues.push(`${row.status} question ${row.promptId} is in a bucket`)
  }
  if (results.ugcOverlay.promptIds.length !== results.ugcOverlay.count) {
    issues.push(
      `ugc count ${results.ugcOverlay.count} lists ${results.ugcOverlay.promptIds.length}`
    )
  }
  for (const row of results.leaderboard) {
    if (row.promptIds.length !== row.aioCount) {
      issues.push(`${row.domain} aioCount ${row.aioCount} lists ${row.promptIds.length}`)
    }
    if (row.badge === 'you') {
      if (row.overlap !== null || row.gap !== null) issues.push('you row has overlap or gap')
    } else if (row.gap !== null && row.gapPromptIds.length !== row.gap) {
      issues.push(`${row.domain} gap ${row.gap} lists ${row.gapPromptIds.length}`)
    }
  }
  if (results.run) {
    const run = results.run
    const score =
      run.pointsPossible === 0 ? null : Math.round((run.points / run.pointsPossible) * 100)
    if (score !== run.visibilityScore) issues.push(`score ${run.visibilityScore} expected ${score}`)
    const pageCited = results.prompts.filter((row) => row.status === 'page_cited').length
    if (pageCited !== run.pageCited) issues.push(`pageCited ${run.pageCited} rows ${pageCited}`)
    const stageCited = results.stageRates.reduce((sum, rate) => sum + rate.pageCited, 0)
    if (stageCited !== run.pageCited)
      issues.push(`stage pageCited ${stageCited} run ${run.pageCited}`)
  }
  return issues
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}
