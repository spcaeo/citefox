import type {
  CitationOwner,
  CitationSourceType,
  CommunitiesReport,
  CommunityAio,
  CommunityScope,
  LinkedinPostKind,
  Market,
  PageSummary,
  PromptCheckStatus,
  RedditReplyState,
  SourceMixCheck
} from '@shared/domain'
import { formatDay } from '../../utils/dates'
import { marketLabel } from '../../shell/model'

/** Pages and topics the project screen's page filter offers: the ones CiteFox checks. */
export function communityScopes(pages: readonly PageSummary[]): PageSummary[] {
  return pages.filter((page) => page.status === 'tracked' || page.status === 'paused')
}

/** A tracked page or topic as the page filter and the scope line name it. */
export function scopeName(page: Pick<PageSummary, 'kind' | 'label' | 'title' | 'url'>): string {
  const name = page.label ?? page.title ?? page.url ?? 'Untitled'
  return page.kind === 'topic' ? `Topic · ${name}` : name
}

const TYPE_LABELS: Readonly<Record<CitationSourceType, string>> = {
  web: 'Web pages',
  reddit: 'Reddit',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  review: 'Review sites',
  forum: 'Other forums',
  other: 'Other'
}

export function sourceTypeLabel(type: CitationSourceType): string {
  return TYPE_LABELS[type]
}

const OWNER_LABELS: Readonly<Record<CitationOwner, string>> = {
  yours: 'Your site',
  competitor: 'Competitors',
  external: 'Everyone else'
}

export function ownerLabel(owner: CitationOwner): string {
  return OWNER_LABELS[owner]
}

const REPLY_LABELS: Readonly<Record<RedditReplyState, string>> = {
  open: 'Open',
  archived: 'Archived',
  locked: 'Locked',
  unchecked: 'Unchecked'
}

export function replyLabel(state: RedditReplyState): string {
  return REPLY_LABELS[state]
}

/** A check's result in the app's words (ui/resultTones.ts). */
const STATUS_LABELS: Readonly<Record<PromptCheckStatus, string>> = {
  page_cited: 'Right page',
  other_own_page: 'Your other page',
  brand_mentioned: 'Named, not linked',
  not_cited: 'Not cited',
  no_aio: 'No AI Overview',
  error: 'Check failed'
}

export function statusLabel(status: PromptCheckStatus): string {
  return STATUS_LABELS[status]
}

const KIND_LABELS: Readonly<Record<LinkedinPostKind, string>> = {
  post: 'Post',
  article: 'Article',
  newsletter: 'Newsletter',
  profile: 'Profile',
  other: 'Other'
}

export function linkedinKindLabel(kind: LinkedinPostKind): string {
  return KIND_LABELS[kind]
}

/** Share of `part` in `whole`, rounded to a whole percent. 0 when the whole is 0. */
export function share(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/** CSS width for a stacked-bar segment, unrounded so segments fill the bar. */
export function segmentWidth(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  return `${((part / whole) * 100).toFixed(2)}%`
}

/** The answers behind `keys`, in key order, skipping unknown keys. */
export function resolveDrill(
  report: Pick<CommunitiesReport, 'aios'>,
  keys: readonly string[]
): CommunityAio[] {
  const byKey = new Map(report.aios.map((aio) => [aio.key, aio]))
  return keys.flatMap((key) => {
    const found = byKey.get(key)
    return found === undefined ? [] : [found]
  })
}

/** Keys among `keys` whose overview names the brand. */
export function namedKeys(
  report: Pick<CommunitiesReport, 'aios'>,
  keys: readonly string[]
): string[] {
  return resolveDrill(report, keys)
    .filter((aio) => aio.named === true)
    .map((aio) => aio.key)
}

export function marketName(markets: readonly Market[], marketId: string): string {
  const market = markets.find((item) => item.id === marketId)
  return market === undefined ? marketId : marketLabel(market)
}

/** Short market list for a table cell: flag and country only. */
export function marketsShort(markets: readonly Market[], ids: readonly string[]): string {
  return ids
    .map((id) => {
      const market = markets.find((item) => item.id === id)
      if (market === undefined) return id
      return marketLabel({ ...market, location: null }).split(' · ')[0] ?? id
    })
    .join(', ')
}

/** "Prompts 1, 2" in page scope; "3 pages" in project scope. */
export function citedOnLabel(
  scope: CommunityScope,
  positions: readonly number[],
  pageCount: number
): string {
  if (scope === 'project') return pageCount === 1 ? '1 page' : `${pageCount} pages`
  if (positions.length === 0) return '—'
  return `${positions.length === 1 ? 'Question' : 'Questions'} ${positions.join(', ')}`
}

/** "5 days", "3 weeks", "4 months", "1 year" between two instants. Null when either is missing. */
export function ageLabel(from: string | null, to: string): string | null {
  if (from === null) return null
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  const days = Math.max(0, Math.floor((end - start) / 86_400_000))
  if (days < 14) return days === 1 ? '1 day' : `${days} days`
  if (days < 60) return `${Math.floor(days / 7)} weeks`
  if (days < 365) return `${Math.floor(days / 30)} months`
  const years = Math.floor(days / 365)
  return years === 1 ? '1 year' : `${years} years`
}

/** Age in days, for sorting. Null sorts last. */
export function ageDays(from: string | null, to: string): number | null {
  if (from === null) return null
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.max(0, Math.floor((end - start) / 86_400_000))
}

export function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
}

/** 312 → "5:12"; 3723 → "1:02:03". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

const COLUMN_NAMES = ['Latest check', 'Check before', 'Two checks before']

/** Column heading for a check age. Page scope names the date; project scope names the age. */
export function checkColumnLabel(check: SourceMixCheck, scope: CommunityScope): string {
  if (scope === 'project') return COLUMN_NAMES[check.index] ?? `${check.index} checks before`
  return dateRange(check)
}

/** "Oct 19", or "Oct 5 – Oct 6" when the runs in a column fall on different days. */
export function dateRange(check: Pick<SourceMixCheck, 'from' | 'to'>): string {
  const from = formatDay(check.from, { year: false })
  const to = formatDay(check.to, { year: false })
  return from === to ? to : `${from} – ${to}`
}

/** Citations of one type in one check column. */
export function typeCitations(check: SourceMixCheck, type: CitationSourceType): number {
  return check.types.find((segment) => segment.type === type)?.citations ?? 0
}

/** "+3", "−2", or "0". */
export function signedChange(delta: number): string {
  if (delta > 0) return `+${delta.toLocaleString('en-US')}`
  if (delta < 0) return `−${Math.abs(delta).toLocaleString('en-US')}`
  return '0'
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}
