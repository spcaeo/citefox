import type { FixKind, LoggedFix } from '@shared/domain'
import type { CreateFixRequest, ProjectFix, QuestionTarget } from '@shared/ipc'
import type { PageFix } from '@shared/page-fixes'
import { pluralize } from '@shared/pluralize'
import { sameTargetPage, targetPagePath } from '@shared/target-page'
import { localMidnightIso, todayInput } from '../../progress/model'
import type { FixVerdictView } from '@shared/fix-verdict'
import { formatDay } from '../../utils/dates'
import type { FixPrefill } from '../drawer/model'

/**
 * "I published this" on a page fix, pure: which page the fix is about, where it is
 * stored, its searches and markets, the words it is logged with, and the logged fix
 * the drawer then shows ("Live since …"). One click logs it with today's date.
 */

/** Where a published page fix is stored: a tracked page, else a topic with the page's address. */
export interface PublishSubject {
  /** The tracked page, or a topic of the fix when the page is not tracked. */
  pageId: string
  /** The page address, sent when `pageId` is a topic (null when the page is tracked). */
  url: string | null
  /** The other pages and topics whose searches the fix carries (the Log a fix form lists them). */
  also: string[]
}

/** The longest description `fixes:create` takes. */
const DESCRIPTION_MAX = 4000

/**
 * The page the fix is about. An owner fix uses the page "Why Google picks" recommends
 * (`ownerUrl`), else the target, else the page Google cites. A new page has no address
 * until the person types it (`typedUrl`).
 */
export function publishedPageUrl(
  fix: Pick<PageFix, 'kind' | 'page' | 'citedUrl'>,
  ownerUrl: string | null,
  typedUrl: string | null = null
): string | null {
  if (fix.kind === 'new') return typedUrl?.trim() || null
  if (fix.kind === 'owner') return ownerUrl ?? fix.page?.url ?? fix.citedUrl
  return fix.page?.url ?? null
}

/** Each page or topic the fix's searches come from, once, in the fix's order. */
function sourceIds(fix: Pick<PageFix, 'sources' | 'searches'>): string[] {
  return [
    ...new Set([...fix.sources.map((item) => item.id), ...fix.searches.map((s) => s.sourceId)])
  ]
}

/**
 * The tracked page with that address when there is one; else the fix's first topic
 * (or page) still open, carrying the address. Null when nothing is open to store it on.
 */
export function publishSubject(
  fix: Pick<PageFix, 'sources' | 'searches'>,
  url: string | null,
  targets: readonly QuestionTarget[]
): PublishSubject | null {
  const open = targets.filter((target) => target.status !== 'removed')
  const sources = sourceIds(fix)
  const tracked =
    url === null
      ? undefined
      : open.find((target) => target.kind === 'page' && sameTargetPage(target.url, url))
  const fallback =
    sources
      .map((id) => open.find((target) => target.id === id && target.kind === 'topic'))
      .find(Boolean) ?? sources.map((id) => open.find((target) => target.id === id)).find(Boolean)
  const subject = tracked ?? fallback
  if (subject === undefined) return null
  return {
    pageId: subject.id,
    url: tracked !== undefined ? null : url,
    also: sources.filter((id) => id !== subject.id && open.some((target) => target.id === id))
  }
}

/** Every search's own market that the subject is checked in; all of its markets otherwise. */
export function publishMarkets(
  fix: Pick<PageFix, 'searches'>,
  subject: Pick<QuestionTarget, 'marketIds'> | undefined
): string[] {
  const own = subject?.marketIds ?? []
  const wanted = [...new Set(fix.searches.flatMap((search) => search.marketId ?? []))]
  const picked = wanted.filter((id) => own.includes(id))
  return picked.length > 0 ? picked : [...own]
}

/** Write a new page logs a new page; the others log a fix. */
export function publishKind(fix: Pick<PageFix, 'kind'>): FixKind {
  return fix.kind === 'new' ? 'new_page' : 'fix'
}

/** What the fix is logged with: the kept page edits, else the brief, else a short line. */
export function publishText(
  fix: Pick<PageFix, 'kind' | 'searches'>,
  url: string | null,
  written: { edits: string | null; brief: string | null }
): string {
  const chosen = [written.edits, written.brief].find(
    (text): text is string => text !== null && text.trim().length > 0
  )
  if (chosen !== undefined) return chosen.trim().slice(0, DESCRIPTION_MAX)
  const path = url === null ? 'the page' : targetPagePath(url)
  const searches = pluralize(fix.searches.length, 'search', 'searches')
  switch (fix.kind) {
    case 'new':
      return `Published the new page ${path} for ${searches}.`
    case 'owner':
      return `Made ${path} the page for ${searches}.`
    default:
      return `Updated ${path} for ${searches}.`
  }
}

/** Page edits count once there is a line past "Page edits on …:" (every edit undone has none). */
export function editsText(summary: string | null): string | null {
  if (summary === null) return null
  return summary.split('\n').length > 1 ? summary : null
}

/** `fixes:create` for the one click: today (local midnight), every search, the page fix's id. */
export function publishRequest(input: {
  projectId: string
  fix: Pick<PageFix, 'id' | 'kind' | 'searches'>
  subject: PublishSubject
  marketIds: readonly string[]
  text: string
  now: Date
}): CreateFixRequest {
  const goLiveAt = localMidnightIso(todayInput(input.now)) ?? input.now.toISOString()
  return {
    projectId: input.projectId,
    pageId: input.subject.pageId,
    description: input.text,
    kind: publishKind(input.fix),
    goLiveAt,
    rule: 'after_3_days',
    promptIds: [...new Set(input.fix.searches.map((search) => search.promptId))],
    marketIds: [...input.marketIds],
    ...(input.subject.url !== null ? { url: input.subject.url } : {}),
    pageFixId: input.fix.id
  }
}

/** The full Log a fix form with the same fix filled in ("Pick another date", Log a fix). */
export function publishPrefill(input: {
  fix: Pick<PageFix, 'id' | 'kind' | 'searches'>
  subject: PublishSubject | null
  text: string
}): FixPrefill {
  return {
    pageId: input.subject?.pageId ?? null,
    promptIds: [...new Set(input.fix.searches.map((search) => search.promptId))],
    kind: publishKind(input.fix),
    text: input.text,
    also: input.subject?.also ?? [],
    url: input.subject?.url ?? null,
    pageFixId: input.fix.id
  }
}

/** The newest fix logged from this page fix, or null. */
export function publishedFixOf(pageFixId: string, fixes: readonly ProjectFix[]): LoggedFix | null {
  let best: LoggedFix | null = null
  for (const { fix } of fixes) {
    if (fix.pageFixId !== pageFixId) continue
    if (best === null || fix.goLiveAt > best.goLiveAt) best = fix
  }
  return best
}

/** "Live since Oct 31 · measuring, 13 days left", or the verdict once measured. */
export function liveLine(
  view: Pick<FixVerdictView, 'state' | 'daysLeft'>,
  goLiveAt: string
): string {
  const day = formatDay(goLiveAt, { year: false })
  switch (view.state) {
    case 'planned':
      return `Goes live ${day}`
    case 'too_early':
      return `Live since ${day} · measuring, ${view.daysLeft} ${view.daysLeft === 1 ? 'day' : 'days'} left`
    case 'waiting':
      return `Live since ${day} · waiting for the next check`
    default:
      return `Live since ${day}`
  }
}
