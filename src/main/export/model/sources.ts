import type { CitationSourceType } from '@shared/domain'
import { percent } from '@shared/report-copy'
import { referenceDomain, referenceWho } from './competition'
import type { DrillRegistry } from './drills'
import type { ScopeData } from './rows'
import {
  linkedinKind,
  normalizeVideoUrl,
  redditThreadUrl,
  subredditOf,
  youtubeVideoId
} from './source-urls'
import type {
  InfluentialPage,
  PlatformRow,
  RedditThread,
  ReportReference,
  SourcesSection,
  YoutubeVideo
} from './types'

export const SOURCES_NOTE =
  'These are citations, not prompts: one answer can cite many pages, so the totals here are larger than the prompt counts elsewhere.'

const PLATFORM_LABELS: Record<CitationSourceType, string> = {
  web: 'Web pages',
  youtube: 'YouTube',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  review: 'Review sites',
  forum: 'Other forums',
  other: 'Other'
}

const PLATFORM_ORDER: readonly CitationSourceType[] = [
  'web',
  'youtube',
  'reddit',
  'linkedin',
  'review',
  'forum',
  'other'
]

/**
 * Section 8, Sources, from the stored references alone. The communities feature adds
 * channel, views, reply status and thread stats through `ReportSectionBuilders.sources`.
 */
export function buildSources(
  scope: ScopeData,
  ownDomain: string,
  drills: DrillRegistry
): SourcesSection {
  const aioRows = new Map(scope.rows.filter((row) => row.aio).map((row) => [row.id, row]))
  const references = scope.references.filter((reference) => aioRows.has(reference.rowId))
  const youCited = new Set([...aioRows.values()].filter((row) => row.cited).map((row) => row.id))
  const who = references.map(referenceWho)
  const yours = who.filter((value) => value === 'you').length
  const competitor = who.filter((value) => value === 'competitor').length
  const external = who.length - yours - competitor
  const gapsToWin = references.filter((reference) => !youCited.has(reference.rowId)).length

  const platforms: PlatformRow[] = PLATFORM_ORDER.flatMap((type) => {
    const list = references.filter((reference) => reference.sourceType === type)
    if (list.length === 0) return []
    return [
      {
        type,
        label: PLATFORM_LABELS[type],
        pages: new Set(list.map((reference) => keyOf(reference))).size,
        citations: list.length,
        share: percent(list.length, references.length),
        prompts: drills.count(
          `platform:${type}`,
          list.map((reference) => reference.rowId)
        )
      }
    ]
  })

  const videos = groupBy(
    references.filter((reference) => youtubeVideoId(reference.url) !== null),
    (reference) => youtubeVideoId(reference.url) ?? ''
  )
  const youtube: YoutubeVideo[] = [...videos.entries()]
    .map(([videoId, list]) => {
      const rows = list.map((reference) => reference.rowId)
      return {
        videoId,
        url: normalizeVideoUrl(list[0]?.url ?? ''),
        title: list.find((reference) => reference.title !== null)?.title ?? null,
        channel: null,
        views: null,
        publishedAt: null,
        prompts: drills.count(`video:${videoId}`, rows),
        citations: list.length,
        gap: drills.count(
          `video:${videoId}:gap`,
          rows.filter((id) => !youCited.has(id))
        )
      }
    })
    .sort(byPromptsThenCitations)

  const reddit = references.filter((reference) => subredditOf(reference.url) !== null)
  const threads: RedditThread[] = [
    ...groupBy(reddit, (reference) => redditThreadUrl(reference.url)).entries()
  ]
    .map(([url, list]) => ({
      url,
      title: list.find((reference) => reference.title !== null)?.title ?? null,
      subreddit: subredditOf(url) ?? subredditOf(list[0]?.url ?? '') ?? 'r/unknown',
      replyStatus: 'unchecked' as const,
      upvotes: null,
      comments: null,
      prompts: drills.count(
        `thread:${url}`,
        list.map((reference) => reference.rowId)
      ),
      citations: list.length
    }))
    .sort(byPromptsThenCitations)
  const subreddits = [...groupBy(threads, (thread) => thread.subreddit).entries()]
    .map(([name, list]) => ({
      name,
      threads: list.length,
      prompts: drills.count(
        `subreddit:${name}`,
        reddit
          .filter((reference) => subredditOf(reference.url) === name)
          .map((reference) => reference.rowId)
      ),
      citations: list.reduce((total, thread) => total + thread.citations, 0)
    }))
    .sort(byPromptsThenCitations)

  const linkedin = [
    ...groupBy(
      references.filter((reference) => reference.sourceType === 'linkedin'),
      (reference) => reference.normalizedUrl
    ).entries()
  ]
    .map(([normalized, list]) => ({
      url: list[0]?.url ?? normalized,
      title: list.find((reference) => reference.title !== null)?.title ?? null,
      kind: linkedinKind(list[0]?.url ?? normalized),
      prompts: drills.count(
        `linkedin:${normalized}`,
        list.map((reference) => reference.rowId)
      ),
      citations: list.length
    }))
    .sort(byPromptsThenCitations)

  const influential: InfluentialPage[] = [...groupBy(references, keyOf).entries()]
    .map(([key, list]) => {
      const first = list[0]
      const rows = list.map((reference) => reference.rowId)
      return {
        url: first?.url ?? key,
        domain: first === undefined ? key : referenceDomain(first, ownDomain),
        who: first === undefined ? ('observed' as const) : referenceWho(first),
        title: list.find((reference) => reference.title !== null)?.title ?? null,
        prompts: drills.count(`url:${key}`, rows),
        citations: list.length,
        gap: drills.count(
          `url:${key}:gap`,
          rows.filter((id) => !youCited.has(id))
        )
      }
    })
    .sort(byPromptsThenCitations)
    .slice(0, 25)

  const open = threads.filter((thread) => thread.replyStatus === 'open').length
  return {
    empty:
      references.length === 0
        ? {
            title: 'No citations yet',
            message: 'Sources are counted from the pages AI Overviews cite.',
            nextStep: 'Run a check with prompts that show an AI Overview.'
          }
        : null,
    note: SOURCES_NOTE,
    total: references.length,
    yours,
    yoursPct: percent(yours, references.length),
    competitor,
    external,
    gapsToWin,
    platforms,
    youtube: {
      videos: youtube,
      channels: [],
      detailsMissing: youtube.length > 0
    },
    reddit: {
      threads,
      subreddits,
      sentence:
        threads.length === 0
          ? 'No Reddit threads are cited, so there is nothing to reply to here.'
          : open === 0
            ? `${threads.length} Reddit ${threads.length === 1 ? 'thread is' : 'threads are'} cited. Reply status has not been checked yet, so open the threads before replying.`
            : `${open} of ${threads.length} cited Reddit threads are open for replies.`
    },
    linkedin,
    influential
  }
}

/** The counting key for a cited page: YouTube videos by id, everything else by normalized URL. */
function keyOf(reference: ReportReference): string {
  const video = youtubeVideoId(reference.url)
  return video === null ? reference.normalizedUrl : `youtube:${video}`
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const id = key(item)
    const list = map.get(id)
    if (list === undefined) map.set(id, [item])
    else list.push(item)
  }
  return map
}

function byPromptsThenCitations(
  left: { prompts: { n: number }; citations: number },
  right: { prompts: { n: number }; citations: number }
): number {
  return right.prompts.n - left.prompts.n || right.citations - left.citations
}
