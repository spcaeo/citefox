import type { CitationSourceType } from '../../domain'
import { isAnswered, isCitedRow } from '../../metrics/counts'
import type { MetricRow } from '../../metrics/types'
import { redditThreadOf } from '../../source-type'
import {
  linkedinKind,
  normalizeVideoUrl,
  redditThreadUrl,
  subredditOf,
  youtubeVideoId
} from '../../source-urls'
import type { SectionInput } from './sections'
import type {
  AnswerExtras,
  CitedSource,
  LinkedinRow,
  OutsidePage,
  SourcesView,
  SourceTypeRow,
  ThreadRow,
  VideoRow
} from './sources-types'
import type { Num } from './types'

/**
 * The Sources tab ("Who the AI answers lean on"), ported from the Full report's sources
 * section (src/main/export/model/sources.ts) to every engine: the citation split, source
 * types, YouTube, Reddit, LinkedIn and the most influential outside pages. Citations are
 * counted per answer (one answer cites many pages); every clickable number is a count of
 * questions and opens exactly those questions. Pure.
 */

const TYPE_LABELS: Readonly<Record<CitationSourceType, string>> = {
  web: 'Web pages',
  youtube: 'YouTube',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  review: 'Review sites',
  forum: 'Other forums',
  other: 'Other social and video'
}

const TYPE_ORDER: readonly CitationSourceType[] = [
  'web',
  'youtube',
  'reddit',
  'linkedin',
  'review',
  'forum',
  'other'
]

const REPLY_ORDER = { open: 0, unchecked: 1, archived: 2, locked: 3 } as const

/** One cited page in one question's answer (All engines: one per engine answer). */
interface Citation {
  questionId: string
  source: CitedSource
}

/** The engine rows behind a `to` row: itself, or an All engines row's parts. */
function engineRows(input: SectionInput, row: MetricRow): MetricRow[] {
  if (row.parts === undefined) return [row]
  return row.parts.flatMap((id) => {
    const part = input.metrics.rows[id]
    return part === undefined ? [] : [part]
  })
}

/** The counting key of a cited page: a YouTube video by id, everything else by URL. */
function keyOf(source: CitedSource): string {
  const video = youtubeVideoId(source.url)
  if (video !== null) return `youtube:${video}`
  return source.url.replace(/[?#].*$/, '').replace(/\/+$/, '')
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

function share(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100)
}

function firstTitle(list: readonly Citation[]): string | null {
  return list.find((item) => item.source.title !== null)?.source.title ?? null
}

function byQuestions(
  left: { questions: Num; citations: number },
  right: { questions: Num; citations: number }
): number {
  return right.questions.n - left.questions.n || right.citations - left.citations
}

export function sourcesView(input: SectionInput, extras: AnswerExtras): SourcesView {
  const { metrics, book } = input
  const citations: Citation[] = []
  const cited = new Set<string>()
  for (const id of metrics.now.checked.ids) {
    const row = metrics.rows[id]
    if (row === undefined || !isAnswered(row)) continue
    if (isCitedRow(row)) cited.add(id)
    for (const part of engineRows(input, row)) {
      if (!isAnswered(part)) continue
      for (const source of extras.citations[part.id] ?? []) {
        citations.push({ questionId: id, source })
      }
    }
  }
  const questions = (key: string, title: string, list: readonly Citation[], sub?: string): Num =>
    book.add(`src:${key}`, {
      title,
      kind: 'questions',
      ids: [...new Set(list.map((item) => item.questionId))],
      ...(sub === undefined ? {} : { sub })
    })
  const gapOf = (key: string, title: string, list: readonly Citation[]): Num =>
    questions(
      `${key}:gap`,
      title,
      list.filter((item) => !cited.has(item.questionId)),
      'Answers that cite this and not you.'
    )

  const total = citations.length
  const yours = citations.filter((item) => item.source.who === 'you').length
  const competitor = citations.filter((item) => item.source.who === 'competitor').length
  const gapList = citations.filter((item) => !cited.has(item.questionId))

  const types: SourceTypeRow[] = TYPE_ORDER.flatMap((type) => {
    const list = citations.filter((item) => item.source.type === type)
    if (list.length === 0) return []
    return [
      {
        type,
        label: TYPE_LABELS[type],
        pages: new Set(list.map((item) => keyOf(item.source))).size,
        citations: list.length,
        share: share(list.length, total),
        questions: questions(`type:${type}`, `Answers citing ${TYPE_LABELS[type]}`, list)
      }
    ]
  })

  const videoList = citations.filter((item) => youtubeVideoId(item.source.url) !== null)
  const videos: VideoRow[] = [
    ...groupBy(videoList, (item) => youtubeVideoId(item.source.url) ?? '').entries()
  ]
    .map(([videoId, list]) => {
      const facts = extras.videos[videoId]
      const title = firstTitle(list) ?? facts?.title ?? null
      const name = title ?? 'this video'
      return {
        videoId,
        url: normalizeVideoUrl(list[0]?.source.url ?? ''),
        title,
        channel: facts?.channel ?? null,
        views: facts?.views ?? null,
        publishedAt: facts?.publishedAt ?? null,
        posted: facts?.publishedAt ? input.ctx.day(facts.publishedAt) : null,
        citations: list.length,
        questions: questions(`video:${videoId}`, `Answers citing ${name}`, list),
        gap: gapOf(`video:${videoId}`, `Cite ${name}, not you`, list)
      }
    })
    .sort(byQuestions)
  const channels = [
    ...groupBy(
      videos.filter((video) => video.channel !== null),
      (video) => video.channel ?? ''
    ).entries()
  ]
    .map(([channel, list]) => {
      const ids = new Set(list.map((video) => video.videoId))
      return {
        channel,
        videos: list.length,
        citations: list.reduce((sum, video) => sum + video.citations, 0),
        questions: questions(
          `channel:${channel}`,
          `Answers citing ${channel} videos`,
          videoList.filter((item) => ids.has(youtubeVideoId(item.source.url) ?? ''))
        )
      }
    })
    .sort(byQuestions)

  const redditList = citations.filter((item) => subredditOf(item.source.url) !== null)
  const threads: ThreadRow[] = [
    ...groupBy(redditList, (item) => redditThreadUrl(item.source.url)).entries()
  ]
    .map(([url, list]) => {
      const id = redditThreadOf(url)?.threadId?.toLowerCase() ?? null
      const facts = id === null ? undefined : extras.threads[id]
      const subreddit = subredditOf(url) ?? subredditOf(list[0]?.source.url ?? '') ?? 'r/unknown'
      // Search titles end in " - Reddit"; the subreddit column says that already.
      const title = firstTitle(list)?.replace(/\s+[-–|:]\s*r?\/?reddit$/i, '') ?? null
      const name = title ?? `a thread in ${subreddit}`
      return {
        url,
        title,
        subreddit,
        reply: facts?.reply ?? 'unchecked',
        upvotes: facts?.upvotes ?? null,
        comments: facts?.comments ?? null,
        citations: list.length,
        questions: questions(`thread:${url}`, `Answers citing ${name}`, list),
        gap: gapOf(`thread:${url}`, `Cite ${name}, not you`, list)
      }
    })
    .sort(
      (a, b) =>
        REPLY_ORDER[a.reply] - REPLY_ORDER[b.reply] ||
        (b.upvotes ?? -1) - (a.upvotes ?? -1) ||
        byQuestions(a, b)
    )
  const subreddits = [...groupBy(threads, (thread) => thread.subreddit).entries()]
    .map(([name, list]) => ({
      name,
      threads: list.length,
      citations: list.reduce((sum, thread) => sum + thread.citations, 0),
      questions: questions(
        `subreddit:${name}`,
        `Answers citing ${name}`,
        redditList.filter((item) => (subredditOf(item.source.url) ?? 'r/unknown') === name)
      )
    }))
    .sort(byQuestions)
  const open = threads.filter((thread) => thread.reply === 'open').length
  const checked = threads.filter((thread) => thread.reply !== 'unchecked').length
  const sentence =
    threads.length === 0
      ? 'No Reddit threads are cited, so there is nothing to reply to.'
      : checked === 0
        ? `${threads.length} Reddit ${threads.length === 1 ? 'thread is' : 'threads are'} cited. Open them to see if they still take replies.`
        : open === 0
          ? 'None of the cited threads take replies any more.'
          : `${open} of ${threads.length} cited Reddit ${threads.length === 1 ? 'thread takes' : 'threads take'} replies. Start with those.`

  const linkedin: LinkedinRow[] = [
    ...groupBy(
      citations.filter((item) => item.source.type === 'linkedin'),
      (item) => keyOf(item.source)
    ).entries()
  ]
    .map(([key, list]) => {
      const url = list[0]?.source.url ?? key
      const kind = linkedinKind(url)
      const profile = /linkedin\.com\/(company|in|school|showcase)\//i.test(url)
      return {
        url,
        title: firstTitle(list),
        kind: kind === 'other' && profile ? ('profile' as const) : kind,
        citations: list.length,
        questions: questions(`linkedin:${key}`, `Answers citing ${firstTitle(list) ?? url}`, list)
      }
    })
    .sort(byQuestions)

  const influential: OutsidePage[] = [
    ...groupBy(
      citations.filter((item) => item.source.who !== 'you'),
      (item) => keyOf(item.source)
    ).entries()
  ]
    .map(([key, list]) => {
      const first = list[0]?.source
      const title = firstTitle(list)
      const name = title ?? first?.url ?? key
      return {
        url: first?.url ?? key,
        domain: first?.domain ?? '',
        title,
        who: first?.who ?? ('other' as const),
        type: first?.type ?? ('web' as const),
        citations: list.length,
        questions: questions(`page:${key}`, `Answers citing ${name}`, list),
        gap: gapOf(`page:${key}`, `Cite ${name}, not you`, list)
      }
    })
    .sort(byQuestions)
    .slice(0, 25)

  return {
    total,
    yours,
    competitor,
    other: total - yours - competitor,
    yoursShare: share(yours, total),
    gapCitations: gapList.length,
    answers: questions('answers', 'Answers that cite a source', citations),
    citingYou: questions(
      'you',
      'Answers that cite your pages',
      citations.filter((item) => item.source.who === 'you')
    ),
    citingCompetitor: questions(
      'competitor',
      'Answers that cite a competitor',
      citations.filter((item) => item.source.who === 'competitor')
    ),
    gaps: questions(
      'gaps',
      'Gaps to win: answers that cite others, not you',
      gapList,
      'Each answer here cites other pages and none of yours.'
    ),
    types,
    youtube: {
      channels,
      videos,
      detailsMissing: videos.some((video) => video.channel === null && video.views === null)
    },
    reddit: { subreddits, threads, sentence },
    linkedin,
    influential
  }
}
