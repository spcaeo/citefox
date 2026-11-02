import {
  SOURCE_MIX_ORDER,
  type AioReference,
  type CitationSourceType,
  type CommunitiesReport,
  type CommunityDiscussion,
  type CommunityLink,
  type CommunityExtras,
  type CommunityOpportunity,
  type CommunityPost,
  type CommunityScope,
  type CommunitySourceBase,
  type CommunityThread,
  type CommunityVideo,
  type OpportunitySourceType,
  type PromptCheckStatus,
  type RedditReplyState,
  type SourceMixCheck
} from '@shared/domain'
import { pointsFor } from '../engine/checks/score'
import type { Evidence, EvidenceAnswer } from './evidence'
import { ownerOf } from './owners'
import { forumSiteLabel, linkedinKind, redditThreadOf, youtubeVideoId } from './source-type'
import type { FirstSeenRow, RedditThreadRow, YoutubeVideoRow } from './store'

export interface ReportInput {
  projectId: string
  scope: CommunityScope
  pageId: string | null
  marketId: string | null
  builtAt: string
  evidence: Evidence
  threads: ReadonlyMap<string, RedditThreadRow>
  videos: ReadonlyMap<string, YoutubeVideoRow>
  firstSeen: ReadonlyMap<string, FirstSeenRow>
  /** Video ids that count as the user's own (own channel, or tracked on the YouTube screen). */
  ownVideoIds: ReadonlySet<string>
  ownChannelIds: ReadonlySet<string>
  extras: Omit<CommunityExtras, 'threadsChecked' | 'videosWithDetails'>
}

const OPPORTUNITY_TYPES = new Set<CitationSourceType>(['reddit', 'youtube', 'linkedin'])

/** `communities:get` (FR-17.2 to FR-17.5). Pure: everything comes from `input`. */
export function buildCommunitiesReport(input: ReportInput): CommunitiesReport {
  const answers = input.evidence.answers.filter((answer) => answer.hasAio)
  const latest = answers.filter((answer) => answer.checkIndex === 0)
  const reddit = buildThreads(latest, input)
  const youtube = buildVideos(latest, input)
  return {
    projectId: input.projectId,
    scope: input.scope,
    pageId: input.pageId,
    marketId: input.marketId,
    builtAt: input.builtAt,
    checkedAt: maxOf(latest.map((answer) => answer.aio.checkedAt)),
    brandNames: input.evidence.profile.brandNames,
    domain: input.evidence.profile.domain,
    markets: input.evidence.markets,
    pageCount: new Set(latest.map((answer) => answer.aio.pageId)).size,
    aios: answers.map((answer) => answer.aio),
    links: buildLinks(answers, input),
    checks: buildChecks(answers, input),
    reddit,
    youtube,
    linkedin: buildPosts(latest, input),
    forums: buildForums(latest, input),
    opportunities: buildOpportunities(latest, input, youtube),
    extras: {
      ...input.extras,
      threadsChecked: reddit.filter((thread) => thread.replyState !== 'unchecked').length,
      videosWithDetails: youtube.filter((video) => video.views !== null).length
    }
  }
}

/** FR-17.2. One column per check age, newest first. */
export function buildChecks(
  answers: readonly EvidenceAnswer[],
  input: Pick<ReportInput, 'evidence'>
): SourceMixCheck[] {
  const indexes = [...new Set(answers.map((answer) => answer.checkIndex))].sort((a, b) => a - b)
  return indexes.map((index) => {
    const column = answers.filter((answer) => answer.checkIndex === index)
    const times = column.map((answer) => answer.aio.checkedAt).sort()
    const types = SOURCE_MIX_ORDER.map((type) => {
      const hits = column.filter((answer) =>
        answer.references.some((ref) => ref.sourceType === type)
      )
      return {
        type,
        citations: sum(column, (answer) =>
          count(answer.references, (ref) => ref.sourceType === type)
        ),
        aios: hits.length,
        aioKeys: hits.map((answer) => answer.aio.key)
      }
    })
    const owners = (['yours', 'competitor', 'external'] as const).map((owner) => {
      const match = (ref: AioReference): boolean => ownerOf(ref, input.evidence.profile) === owner
      const hits = column.filter((answer) => answer.references.some(match))
      return {
        owner,
        citations: sum(column, (answer) => count(answer.references, match)),
        aios: hits.length,
        aioKeys: hits.map((answer) => answer.aio.key)
      }
    })
    return {
      index,
      from: times[0] ?? '',
      to: times.at(-1) ?? '',
      aios: column.length,
      aioKeys: column.map((answer) => answer.aio.key),
      citations: sum(column, (answer) => answer.references.length),
      types,
      owners
    }
  })
}

/** Every citation the checks count: one per distinct URL per answer, in source order. */
export function buildLinks(
  answers: readonly EvidenceAnswer[],
  input: Pick<ReportInput, 'evidence'>
): CommunityLink[] {
  return answers.flatMap((answer) =>
    answer.references.map((reference) => ({
      aioKey: answer.aio.key,
      checkIndex: answer.checkIndex,
      url: reference.url,
      normalizedUrl: reference.normalizedUrl,
      domain: reference.domain,
      title: reference.title,
      position: reference.position,
      type: reference.sourceType,
      owner: ownerOf(reference, input.evidence.profile)
    }))
  )
}

interface Group {
  url: string
  title: string | null
  reference: AioReference
  answers: EvidenceAnswer[]
}

/** Latest answers grouped by cited URL of one type, most-cited first. */
function groupsOf(
  latest: readonly EvidenceAnswer[],
  accept: (reference: AioReference) => boolean
): Group[] {
  const groups = new Map<string, Group>()
  for (const answer of latest) {
    for (const reference of answer.references) {
      if (!accept(reference)) continue
      const group = groups.get(reference.normalizedUrl) ?? {
        url: reference.normalizedUrl,
        title: null,
        reference,
        answers: []
      }
      group.title ??= reference.title
      if (!group.answers.includes(answer)) group.answers.push(answer)
      groups.set(reference.normalizedUrl, group)
    }
  }
  return [...groups.values()].sort(
    (left, right) => right.answers.length - left.answers.length || (left.url < right.url ? -1 : 1)
  )
}

function baseOf(group: Group, input: ReportInput): CommunitySourceBase {
  const gap = group.answers.filter((answer) => !answer.ownCited)
  const first = input.firstSeen.get(group.url)
  return {
    url: group.url,
    title: group.title,
    timesCited: group.answers.length,
    aioKeys: group.answers.map((answer) => answer.aio.key),
    gap: gap.length,
    gapKeys: gap.map((answer) => answer.aio.key),
    promptPositions: [...new Set(group.answers.map((answer) => answer.aio.promptPosition))].sort(
      (a, b) => a - b
    ),
    pageCount: new Set(group.answers.map((answer) => answer.aio.pageId)).size,
    marketIds: [...new Set(group.answers.map((answer) => answer.aio.marketId))].sort(),
    firstSeenAt: first?.at ?? null,
    firstSeenIn:
      first === undefined
        ? null
        : {
            runId: first.runId,
            pageId: first.pageId,
            marketId: first.marketId,
            promptId: first.promptId,
            promptPosition: first.promptPosition,
            checkedAt: first.at
          },
    namedInOverview: count(group.answers, (answer) => answer.aio.named === true)
  }
}

function buildThreads(latest: readonly EvidenceAnswer[], input: ReportInput): CommunityThread[] {
  return groupsOf(latest, (ref) => ref.sourceType === 'reddit').map((group) => {
    const parsed = redditThreadOf(group.url)
    const cached = input.threads.get(group.url)
    return {
      ...baseOf(group, input),
      title: group.title ?? cached?.title ?? null,
      subreddit: parsed?.subreddit ?? cached?.subreddit ?? null,
      threadId: parsed?.threadId ?? null,
      replyState: replyStateOf(cached),
      comments: cached?.error === null ? (cached.comments ?? null) : null,
      upvotes: cached?.error === null ? (cached.upvotes ?? null) : null,
      postedAt: cached?.error === null ? (cached.postedAt ?? null) : null,
      brandInThread: cached?.error === null ? (cached.brandNamed ?? null) : null,
      brandQuote: cached?.error === null ? (cached.brandQuote ?? null) : null,
      excerpt: cached?.error === null ? (cached.excerpt ?? null) : null,
      checkedAt: cached?.checkedAt ?? null
    }
  })
}

/** REPORT-SPEC §8 "Can we reply?". A failed or missing fetch stays unchecked. */
export function replyStateOf(row: RedditThreadRow | undefined): RedditReplyState {
  if (row === undefined || row.error !== null) return 'unchecked'
  if (row.locked === true) return 'locked'
  if (row.archived === true) return 'archived'
  return 'open'
}

function buildVideos(latest: readonly EvidenceAnswer[], input: ReportInput): CommunityVideo[] {
  return groupsOf(
    latest,
    (ref) => ref.sourceType === 'youtube' && youtubeVideoId(ref.url) !== null
  ).flatMap((group) => {
    const videoId = youtubeVideoId(group.url)
    if (videoId === null) return []
    const details = input.videos.get(videoId)
    const known = details !== undefined && !details.missing ? details : null
    const video: CommunityVideo = {
      ...baseOf(group, input),
      title: group.title ?? known?.title ?? null,
      videoId,
      channelTitle: known?.channelTitle ?? null,
      channelId: known?.channelId ?? null,
      views: known?.views ?? null,
      publishedAt: known?.publishedAt ?? null,
      durationSeconds: known?.durationSeconds ?? null,
      yours:
        input.ownVideoIds.has(videoId) ||
        (known?.channelId !== null &&
          known?.channelId !== undefined &&
          input.ownChannelIds.has(known.channelId))
    }
    return [video]
  })
}

function buildPosts(latest: readonly EvidenceAnswer[], input: ReportInput): CommunityPost[] {
  return groupsOf(latest, (ref) => ref.sourceType === 'linkedin').map((group) => ({
    ...baseOf(group, input),
    kind: linkedinKind(group.url)
  }))
}

function buildForums(latest: readonly EvidenceAnswer[], input: ReportInput): CommunityDiscussion[] {
  return groupsOf(latest, (ref) => ref.sourceType === 'forum' || ref.sourceType === 'review').map(
    (group) => ({
      ...baseOf(group, input),
      site: forumSiteLabel(group.reference.domain),
      type: group.reference.sourceType === 'review' ? 'review' : 'forum'
    })
  )
}

/** FR-17.5. Answers that cite Reddit, YouTube or LinkedIn but not the page, most to gain first. */
function buildOpportunities(
  latest: readonly EvidenceAnswer[],
  input: ReportInput,
  videos: readonly CommunityVideo[]
): CommunityOpportunity[] {
  const channelOf = new Map(videos.map((video) => [video.url, video.channelTitle]))
  const rows = latest.flatMap((answer) => {
    if (answer.aio.status === 'page_cited') return []
    const community = answer.references.filter((ref) => OPPORTUNITY_TYPES.has(ref.sourceType))
    const top = community[0]
    if (top === undefined) return []
    const type = top.sourceType as OpportunitySourceType
    const gainPoints = 3 - (pointsFor(answer.aio.status) ?? 0)
    const channel = channelLabel(type, top, channelOf.get(top.normalizedUrl) ?? null)
    return [
      {
        answer,
        top,
        row: {
          rank: 0,
          aioKey: answer.aio.key,
          sourceType: type,
          sourceUrl: top.normalizedUrl,
          sourceTitle: top.title,
          channel,
          sourcePosition: top.position,
          otherSources: community.length - 1,
          gainPoints,
          action: actionFor(type, channel),
          why: whyFor(answer.aio.status, type, channel, top.position, input)
        } satisfies CommunityOpportunity
      }
    ]
  })
  rows.sort(
    (left, right) =>
      right.row.gainPoints - left.row.gainPoints ||
      left.row.sourcePosition - right.row.sourcePosition ||
      right.row.otherSources - left.row.otherSources ||
      left.answer.aio.promptPosition - right.answer.aio.promptPosition ||
      (left.answer.aio.key < right.answer.aio.key ? -1 : 1)
  )
  return rows.map((item, index) => ({ ...item.row, rank: index + 1 }))
}

function channelLabel(
  type: OpportunitySourceType,
  reference: AioReference,
  videoChannel: string | null
): string {
  if (type === 'reddit') return redditThreadOf(reference.normalizedUrl)?.subreddit ?? 'Reddit'
  if (type === 'youtube') return videoChannel ?? 'YouTube'
  const kind = linkedinKind(reference.normalizedUrl)
  return kind === 'article' ? 'LinkedIn article' : kind === 'post' ? 'LinkedIn post' : 'LinkedIn'
}

function actionFor(type: OpportunitySourceType, channel: string): string {
  if (type === 'reddit') {
    return `Answer the ${channel} thread with the steps from your page, then say who you are. Post it yourself.`
  }
  if (type === 'youtube') {
    return 'Make a short video that answers this prompt, and link the page in its description.'
  }
  return "Write a LinkedIn article from your page's answer to this prompt, and link the page."
}

function whyFor(
  status: PromptCheckStatus,
  type: OpportunitySourceType,
  channel: string,
  position: number,
  input: ReportInput
): string {
  const where = `${type === 'reddit' ? `A ${channel} thread` : type === 'youtube' ? 'A video' : `A ${channel}`} is source ${position} in this answer`
  if (status === 'other_own_page')
    return `${where}, and Google cites another of your pages instead of this one.`
  if (status === 'brand_mentioned') {
    return `${where}. ${input.evidence.profile.brandNames[0] ?? 'Your brand'} is named but no page of yours is linked.`
  }
  return `${where}, and nothing of yours is cited or named.`
}

function count<T>(items: readonly T[], test: (item: T) => boolean): number {
  let total = 0
  for (const item of items) if (test(item)) total += 1
  return total
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
  let total = 0
  for (const item of items) total += value(item)
  return total
}

function maxOf(values: readonly string[]): string | null {
  let best: string | null = null
  for (const value of values) if (best === null || value > best) best = value
  return best
}
