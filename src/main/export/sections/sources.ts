/**
 * REPORT-SPEC §8 Sources (SRS §4.17, FR-17.8): the export model's `sources`
 * block. Producers call {@link buildExportSources}; the HTML, PDF, XLSX, CSV
 * and JSON renderers read only this block, never the database, so every output
 * agrees with the Communities tab for the same scope, markets and check.
 *
 * Units: citations are links (one per distinct URL per answer); prompts are
 * answers (one prompt in one market with an AI Overview). They are never mixed.
 */

import {
  SOURCE_MIX_ORDER,
  type AioReference,
  type CitationOwner,
  type CitationSourceType,
  type PromptCheckRow,
  type PromptCheckStatus,
  type RedditReplyState
} from '@shared/domain'
import { linkedinKind, redditThreadOf, youtubeVideoId } from '../../communities/source-type'
import type { ExportCheck, ExportDataset } from '../types'

export const SOURCES_NOTE =
  'These are citations, not prompts: one AI Overview answer can cite many pages.'

export const NOTHING_TO_REPLY =
  'None of the cited threads is open, so there is nothing to reply to here.'

export const SOURCE_TYPE_LABELS: Readonly<Record<CitationSourceType, string>> = {
  web: 'Web pages',
  youtube: 'YouTube',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  review: 'Review sites',
  forum: 'Other forums',
  other: 'Other'
}

export interface ExportSourceTotals {
  citations: number
  yours: number
  /** 0–100, one decimal. Null when there are no citations. */
  yoursShare: number | null
  competitor: number
  external: number
  /** Citations on answers where your domain is absent (gaps to win). */
  gapCitations: number
}

export interface ExportSourceOwner {
  owner: CitationOwner
  citations: number
  share: number | null
}

export interface ExportSourcePlatform {
  type: CitationSourceType
  label: string
  /** Distinct cited URLs of this type. */
  pages: number
  citations: number
  share: number | null
  /** Answers citing at least one URL of this type. */
  prompts: number
}

export interface ExportSourceVideo {
  videoId: string
  url: string
  title: string | null
  /** From the user's YouTube Data API key; null ("—") without one. */
  channel: string | null
  views: number | null
  publishedAt: string | null
  prompts: number
  citations: number
  gap: number
}

export interface ExportSourceChannel {
  /** Null groups videos whose channel is unknown (no YouTube key). */
  channel: string | null
  videos: number
  citations: number
}

export interface ExportSourceThread {
  url: string
  title: string | null
  canReply: RedditReplyState
  upvotes: number | null
  comments: number | null
  prompts: number
  citations: number
}

export interface ExportSourceSubreddit {
  /** `r/name`, or null for short links whose subreddit is unknown. */
  subreddit: string | null
  threads: readonly ExportSourceThread[]
}

export interface ExportSourcePost {
  url: string
  title: string | null
  kind: 'post' | 'article' | 'newsletter' | 'profile' | 'other'
  prompts: number
  citations: number
}

export interface ExportSourcePage {
  url: string
  domain: string
  owner: CitationOwner
  type: CitationSourceType
  prompts: number
  citations: number
  gap: number
}

export interface ExportSources {
  note: string
  totals: ExportSourceTotals
  owners: readonly ExportSourceOwner[]
  platforms: readonly ExportSourcePlatform[]
  youtube: readonly ExportSourceVideo[]
  youtubeChannels: readonly ExportSourceChannel[]
  reddit: readonly ExportSourceSubreddit[]
  /** {@link NOTHING_TO_REPLY} when threads were checked and none is open. Otherwise null. */
  redditNote: string | null
  linkedin: readonly ExportSourcePost[]
  /** Ranked by prompts cited, then citations. */
  influential: readonly ExportSourcePage[]
}

/** Optional extras read from the Communities caches (FR-17.4, FR-11.9). */
export interface ExportSourceExtras {
  videos?: ReadonlyMap<
    string,
    {
      title: string | null
      channelTitle: string | null
      views: number | null
      publishedAt: string | null
    }
  >
  threads?: ReadonlyMap<
    string,
    { replyState: RedditReplyState; upvotes: number | null; comments: number | null }
  >
}

export interface ExportSourcesQuery {
  /** Null is every page in the dataset. */
  pageIds: readonly string[] | null
  /** Null is every market. */
  marketIds: readonly string[] | null
  /** Rows kept in `influential`. */
  influentialLimit?: number
}

const AIO_STATUSES = new Set<PromptCheckStatus>([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

interface Answer {
  key: string
  references: readonly AioReference[]
  ownCited: boolean
}

/** The `sources` block for the newest check of each page and market in scope. */
export function buildExportSources(
  dataset: ExportDataset,
  query: ExportSourcesQuery,
  extras: ExportSourceExtras = {}
): ExportSources {
  const answers = latestAnswers(dataset, query)
  const all = answers.flatMap((answer) => answer.references.map((ref) => ({ answer, ref })))
  const citations = all.length
  const ownerCount = (owner: CitationOwner): number =>
    all.filter((item) => ownerOf(item.ref) === owner).length
  const totals: ExportSourceTotals = {
    citations,
    yours: ownerCount('yours'),
    yoursShare: share(ownerCount('yours'), citations),
    competitor: ownerCount('competitor'),
    external: ownerCount('external'),
    gapCitations: all.filter((item) => !item.answer.ownCited).length
  }
  const reddit = redditGroups(answers, extras)
  const threads = reddit.flatMap((group) => group.threads)
  const checked = threads.filter((thread) => thread.canReply !== 'unchecked')
  return {
    note: SOURCES_NOTE,
    totals,
    owners: (['yours', 'competitor', 'external'] as const).map((owner) => ({
      owner,
      citations: ownerCount(owner),
      share: share(ownerCount(owner), citations)
    })),
    platforms: SOURCE_MIX_ORDER.map((type) => {
      const items = all.filter((item) => item.ref.sourceType === type)
      return {
        type,
        label: SOURCE_TYPE_LABELS[type],
        pages: new Set(items.map((item) => item.ref.normalizedUrl)).size,
        citations: items.length,
        share: share(items.length, citations),
        prompts: new Set(items.map((item) => item.answer.key)).size
      }
    }),
    youtube: videoRows(answers, extras),
    youtubeChannels: channelRows(videoRows(answers, extras)),
    reddit,
    redditNote:
      checked.length > 0 && !checked.some((thread) => thread.canReply === 'open')
        ? NOTHING_TO_REPLY
        : null,
    linkedin: grouped(answers, (ref) => ref.sourceType === 'linkedin').map((group) => ({
      url: group.url,
      title: group.title,
      kind: linkedinKind(group.url),
      prompts: group.answers.size,
      citations: group.citations
    })),
    influential: grouped(answers, () => true)
      .map((group) => ({
        url: group.url,
        domain: group.ref.domain,
        owner: ownerOf(group.ref),
        type: group.ref.sourceType,
        prompts: group.answers.size,
        citations: group.citations,
        gap: [...group.answers.values()].filter((answer) => !answer.ownCited).length
      }))
      .sort(
        (a, b) => b.prompts - a.prompts || b.citations - a.citations || (a.url < b.url ? -1 : 1)
      )
      .slice(0, query.influentialLimit ?? 25)
  }
}

function latestAnswers(dataset: ExportDataset, query: ExportSourcesQuery): Answer[] {
  const answers: Answer[] = []
  for (const page of dataset.pages) {
    if (query.pageIds !== null && !query.pageIds.includes(page.pageId)) continue
    for (const market of page.markets) {
      if (query.marketIds !== null && !query.marketIds.includes(market.marketId)) continue
      const check = newest(market.checks)
      if (check === null) continue
      for (const row of check.prompts) {
        if (!AIO_STATUSES.has(row.status)) continue
        const references = distinct(row)
        answers.push({
          key: `${page.pageId}|${market.marketId}|${row.promptId}`,
          references,
          ownCited: references.some((ref) => ownerOf(ref) === 'yours')
        })
      }
    }
  }
  return answers
}

function newest(checks: readonly ExportCheck[]): ExportCheck | null {
  const current = checks.find((check) => check.role === 'current')
  if (current !== undefined) return current
  return [...checks].sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : 1)).at(-1) ?? null
}

function distinct(row: PromptCheckRow): AioReference[] {
  const seen = new Set<string>()
  return [...row.references]
    .sort((a, b) => a.position - b.position)
    .filter((ref) => {
      if (seen.has(ref.normalizedUrl)) return false
      seen.add(ref.normalizedUrl)
      return true
    })
}

export function ownerOf(reference: AioReference): CitationOwner {
  if (reference.classification === 'target' || reference.classification === 'own') return 'yours'
  if (reference.classification === 'competitor') return 'competitor'
  return 'external'
}

interface Group {
  url: string
  title: string | null
  ref: AioReference
  citations: number
  answers: Map<string, Answer>
}

function grouped(answers: readonly Answer[], accept: (ref: AioReference) => boolean): Group[] {
  const groups = new Map<string, Group>()
  for (const answer of answers) {
    for (const ref of answer.references) {
      if (!accept(ref)) continue
      const group = groups.get(ref.normalizedUrl) ?? {
        url: ref.normalizedUrl,
        title: ref.title,
        ref,
        citations: 0,
        answers: new Map<string, Answer>()
      }
      group.title ??= ref.title
      group.citations += 1
      group.answers.set(answer.key, answer)
      groups.set(ref.normalizedUrl, group)
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.answers.size - a.answers.size || b.citations - a.citations || (a.url < b.url ? -1 : 1)
  )
}

function videoRows(answers: readonly Answer[], extras: ExportSourceExtras): ExportSourceVideo[] {
  return grouped(answers, (ref) => ref.sourceType === 'youtube').flatMap((group) => {
    const videoId = youtubeVideoId(group.url)
    if (videoId === null) return []
    const details = extras.videos?.get(videoId)
    return [
      {
        videoId,
        url: group.url,
        title: group.title ?? details?.title ?? null,
        channel: details?.channelTitle ?? null,
        views: details?.views ?? null,
        publishedAt: details?.publishedAt ?? null,
        prompts: group.answers.size,
        citations: group.citations,
        gap: [...group.answers.values()].filter((answer) => !answer.ownCited).length
      }
    ]
  })
}

function channelRows(videos: readonly ExportSourceVideo[]): ExportSourceChannel[] {
  const channels = new Map<string | null, ExportSourceChannel>()
  for (const video of videos) {
    const row = channels.get(video.channel) ?? { channel: video.channel, videos: 0, citations: 0 }
    row.videos += 1
    row.citations += video.citations
    channels.set(video.channel, row)
  }
  return [...channels.values()].sort(
    (a, b) => b.citations - a.citations || (a.channel ?? '~').localeCompare(b.channel ?? '~')
  )
}

function redditGroups(
  answers: readonly Answer[],
  extras: ExportSourceExtras
): ExportSourceSubreddit[] {
  const bySub = new Map<string | null, ExportSourceThread[]>()
  for (const group of grouped(answers, (ref) => ref.sourceType === 'reddit')) {
    const cached = extras.threads?.get(group.url)
    const subreddit = redditThreadOf(group.url)?.subreddit ?? null
    const list = bySub.get(subreddit) ?? []
    list.push({
      url: group.url,
      title: group.title,
      canReply: cached?.replyState ?? 'unchecked',
      upvotes: cached?.upvotes ?? null,
      comments: cached?.comments ?? null,
      prompts: group.answers.size,
      citations: group.citations
    })
    bySub.set(subreddit, list)
  }
  return [...bySub.entries()]
    .map(([subreddit, threads]) => ({ subreddit, threads }))
    .sort(
      (a, b) =>
        sumOf(b.threads) - sumOf(a.threads) ||
        (a.subreddit ?? '~').localeCompare(b.subreddit ?? '~')
    )
}

function sumOf(threads: readonly ExportSourceThread[]): number {
  return threads.reduce((total, thread) => total + thread.citations, 0)
}

function share(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 1000) / 10
}
