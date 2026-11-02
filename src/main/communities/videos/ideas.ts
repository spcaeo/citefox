import type {
  CommunityExtras,
  PageSummary,
  VideoCitedNow,
  VideoIdea,
  VideoScreen,
  VideoStats,
  VideoTrackingCounts
} from '@shared/domain'
import { labelOf, type Evidence, type EvidenceAnswer } from '../evidence'
import { youtubeVideoId } from '../source-type'
import type { StoredVideoIdea, YoutubeVideoRow } from '../store'

export interface VideoScreenInput {
  projectId: string
  pageId: string | null
  marketId: string | null
  builtAt: string
  /** Every page and market, newest checks first. Ideas are clustered on all of it. */
  evidence: Evidence
  stored: readonly StoredVideoIdea[]
  videos: ReadonlyMap<string, YoutubeVideoRow>
  ownVideoIds: ReadonlySet<string>
  ownChannelIds: ReadonlySet<string>
  extras: CommunityExtras
}

/** A cited video in one answer. */
interface CitedVideo {
  videoId: string
  url: string
  title: string | null
}

/** Suggested ideas are named after the prompt they start from, so the id survives a reload. */
export function suggestionId(promptId: string): string {
  return `vi-${promptId}`
}

/** `videos:get` (FR-18.1, FR-18.2). Pure. */
export function buildVideoScreen(input: VideoScreenInput): VideoScreen {
  const inScope = (answer: EvidenceAnswer): boolean =>
    (input.marketId === null || answer.aio.marketId === input.marketId) &&
    (input.pageId === null || answer.aio.pageId === input.pageId)
  const latest = input.evidence.answers.filter((answer) => answer.checkIndex === 0)
  const scoped = latest.filter(inScope)
  const ideas = buildIdeas(input, latest)
    .map((idea) => scopeIdea(idea, input, inScope))
    .filter((idea): idea is VideoIdea => idea !== null)
    .sort(
      (left, right) =>
        right.evidence - left.evidence ||
        Number(right.deadline !== null) - Number(left.deadline !== null) ||
        left.question.localeCompare(right.question)
    )
  // The drill universe: latest answers in scope, plus every answer an idea points to.
  const keys = new Set(scoped.filter((answer) => answer.hasAio).map((answer) => answer.aio.key))
  for (const idea of ideas) {
    const tracking = idea.tracking
    for (const key of [
      ...idea.evidenceKeys,
      ...(tracking?.nowKeys ?? []),
      ...(tracking?.openKeys ?? []),
      ...(tracking?.beforeKeys ?? [])
    ]) {
      keys.add(key)
    }
  }
  return {
    projectId: input.projectId,
    pageId: input.pageId,
    marketId: input.marketId,
    builtAt: input.builtAt,
    checkedAt: scoped.reduce<string | null>(
      (best, answer) =>
        best === null || answer.aio.checkedAt > best ? answer.aio.checkedAt : best,
      null
    ),
    markets: input.evidence.markets,
    aios: input.evidence.answers.filter((answer) => keys.has(answer.aio.key)).map((a) => a.aio),
    stats: buildStats(scoped, input),
    ideas,
    extras: input.extras
  }
}

export function videosOf(answer: EvidenceAnswer): CitedVideo[] {
  const found: CitedVideo[] = []
  for (const reference of answer.references) {
    if (reference.sourceType !== 'youtube') continue
    const videoId = youtubeVideoId(reference.normalizedUrl)
    if (videoId === null || found.some((video) => video.videoId === videoId)) continue
    found.push({ videoId, url: reference.normalizedUrl, title: reference.title })
  }
  return found
}

function isYours(videoId: string, input: VideoScreenInput): boolean {
  if (input.ownVideoIds.has(videoId)) return true
  const channel = input.videos.get(videoId)?.channelId
  return channel !== null && channel !== undefined && input.ownChannelIds.has(channel)
}

/** FR-18.1 counts for the latest checks in scope. Each count is its key list's length. */
function buildStats(scoped: readonly EvidenceAnswer[], input: VideoScreenInput): VideoStats {
  const shown = scoped.filter((answer) => answer.hasAio)
  const citing = shown.filter((answer) => videosOf(answer).length > 0)
  const yours = citing.filter((answer) =>
    videosOf(answer).some((video) => isYours(video.videoId, input))
  )
  const open = citing.filter((answer) =>
    videosOf(answer).some((video) => !isYours(video.videoId, input))
  )
  const channelKeys = new Map<string, string[]>()
  for (const answer of open) {
    const named = new Set<string>()
    for (const video of videosOf(answer)) {
      if (isYours(video.videoId, input)) continue
      const title = input.videos.get(video.videoId)?.channelTitle
      if (title !== null && title !== undefined) named.add(title)
    }
    for (const title of named) {
      const list = channelKeys.get(title) ?? []
      list.push(answer.aio.key)
      channelKeys.set(title, list)
    }
  }
  const channels = [...channelKeys.keys()].sort((a, b) => a.localeCompare(b))
  return {
    aiosShown: shown.length,
    aiosShownKeys: shown.map((answer) => answer.aio.key),
    prompts: scoped.length,
    citingVideo: citing.length,
    citingVideoKeys: citing.map((answer) => answer.aio.key),
    citingYours: yours.length,
    citingYoursKeys: yours.map((answer) => answer.aio.key),
    openSlots: open.length,
    openSlotKeys: open.map((answer) => answer.aio.key),
    competitorChannels: input.extras.youtubeKey ? channels.length : null,
    competitorChannelNames: channels,
    competitorChannelKeys: channels.map((name) => ({ name, keys: channelKeys.get(name) ?? [] }))
  }
}

interface Cluster {
  promptIds: string[]
}

/**
 * FR-18.2. Prompts whose answers cite the same video ask the same question, so
 * they form one idea. Saved ideas keep their prompts and absorb any suggestion
 * that shares one. Suggestions with no open video slot are dropped.
 */
function buildIdeas(input: VideoScreenInput, latest: readonly EvidenceAnswer[]): IdeaDraft[] {
  const citing = latest.filter((answer) => answer.hasAio && videosOf(answer).length > 0)
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) ?? root
    parent.set(id, root)
    return root
  }
  const union = (left: string, right: string): void => {
    parent.set(find(left), find(right))
  }
  const firstPromptForVideo = new Map<string, string>()
  for (const answer of citing) {
    const promptId = answer.aio.promptId
    if (!parent.has(promptId)) parent.set(promptId, promptId)
    for (const video of videosOf(answer)) {
      const seen = firstPromptForVideo.get(video.videoId)
      if (seen === undefined) firstPromptForVideo.set(video.videoId, promptId)
      else union(seen, promptId)
    }
  }
  const clusters = new Map<string, Cluster>()
  for (const promptId of parent.keys()) {
    const root = find(promptId)
    const cluster = clusters.get(root) ?? { promptIds: [] }
    cluster.promptIds.push(promptId)
    clusters.set(root, cluster)
  }
  const claimed = new Set(input.stored.flatMap((idea) => idea.promptIds))
  const drafts: IdeaDraft[] = input.stored.map((idea) => ({
    stored: idea,
    promptIds: idea.promptIds
  }))
  for (const cluster of clusters.values()) {
    if (cluster.promptIds.some((id) => claimed.has(id))) continue
    const evidenceFor = (promptId: string): number =>
      citing.filter((answer) => answer.aio.promptId === promptId).length
    const ordered = [...cluster.promptIds].sort(
      (left, right) =>
        evidenceFor(right) - evidenceFor(left) || positionOf(left) - positionOf(right)
    )
    const answers = citing.filter((answer) => ordered.includes(answer.aio.promptId))
    const open = answers.some((answer) =>
      videosOf(answer).some((video) => !isYours(video.videoId, input))
    )
    if (!open) continue
    drafts.push({ stored: null, promptIds: ordered })
  }
  return drafts

  function positionOf(promptId: string): number {
    return latest.find((answer) => answer.aio.promptId === promptId)?.aio.promptPosition ?? 999
  }
}

interface IdeaDraft {
  stored: StoredVideoIdea | null
  promptIds: readonly string[]
}

/** Fills one idea for the screen's market and page. Null hides a suggestion with no evidence here. */
function scopeIdea(
  draft: IdeaDraft,
  input: VideoScreenInput,
  inScope: (answer: EvidenceAnswer) => boolean
): VideoIdea | null {
  const promptSet = new Set(draft.promptIds)
  const latestAll = input.evidence.answers.filter(
    (answer) => answer.checkIndex === 0 && promptSet.has(answer.aio.promptId)
  )
  const latest = latestAll.filter(inScope)
  const evidence = latest.filter((answer) => answer.hasAio && videosOf(answer).length > 0)
  const touchesPage =
    input.pageId === null ||
    draft.stored?.pageId === input.pageId ||
    latestAll.some((answer) => answer.aio.pageId === input.pageId)
  if (draft.stored === null && (evidence.length === 0 || !touchesPage)) return null
  if (draft.stored !== null && !touchesPage) return null
  const anchorId = draft.promptIds[0] ?? ''
  const anchors = [
    ...latestAll.filter((answer) => answer.aio.promptId === anchorId),
    ...input.evidence.answers.filter((answer) => answer.aio.promptId === anchorId)
  ]
  const anchorPage = input.evidence.pages.get(anchors[0]?.aio.pageId ?? '')
  // The question is worded as in the page's default market (FR-9.3).
  const anchor =
    anchors.find((answer) => answer.aio.marketId === anchorPage?.defaultMarketId) ?? anchors[0]
  const pageId = draft.stored?.pageId ?? anchor?.aio.pageId ?? ''
  const page: PageSummary | undefined = input.evidence.pages.get(pageId)
  const videos = new Map<string, VideoCitedNow>()
  for (const answer of evidence) {
    for (const video of videosOf(answer)) {
      if (videos.has(video.videoId)) continue
      const details = input.videos.get(video.videoId)
      videos.set(video.videoId, {
        videoId: video.videoId,
        url: video.url,
        title: video.title ?? details?.title ?? null,
        channelTitle: details?.channelTitle ?? null,
        yours: isYours(video.videoId, input)
      })
    }
  }
  const stored = draft.stored
  return {
    id: stored?.id ?? suggestionId(anchorId),
    saved: stored !== null,
    step: stored?.step ?? 'idea',
    question: stored?.question ?? anchor?.aio.text ?? '',
    pageId,
    pageLabel: page === undefined ? (anchor?.aio.pageLabel ?? '') : labelOf(page),
    pageUrl: page?.url ?? '',
    promptIds: draft.promptIds,
    prompts: draft.promptIds.flatMap((id) => {
      const found = input.evidence.answers.find((answer) => answer.aio.promptId === id)
      return found === undefined
        ? []
        : [{ promptId: id, pageId: found.aio.pageId, position: found.aio.promptPosition }]
    }),
    promptPositions: [
      ...new Set(
        draft.promptIds.flatMap((id) => {
          const found = input.evidence.answers.find((answer) => answer.aio.promptId === id)
          return found === undefined ? [] : [found.aio.promptPosition]
        })
      )
    ],
    evidence: evidence.length,
    evidenceKeys: evidence.map((answer) => answer.aio.key),
    evidencePages: new Set(evidence.map((answer) => answer.aio.pageId)).size,
    marketIds: [...new Set(evidence.map((answer) => answer.aio.marketId))].sort(),
    videos: [...videos.values()],
    competitorVideo: [...videos.values()].some((video) => !video.yours),
    deadline: stored?.deadline ?? null,
    brief: stored?.brief ?? null,
    checklist: stored?.checklist ?? [],
    sentToFoxcueAt: stored?.sentToFoxcueAt ?? null,
    videoUrl: stored?.videoUrl ?? null,
    trackingStartedAt: stored?.trackingStartedAt ?? null,
    tracking:
      stored?.videoId === null || stored?.videoId === undefined
        ? null
        : trackingCounts(input, promptSet, stored.videoId, stored.trackingStartedAt, inScope)
  }
}

/**
 * FR-18.7. Answers in the idea's prompts that cite the tracked video: at the
 * newest check before tracking began, and now. Two facts side by side; nothing
 * here says the video caused a change.
 */
export function trackingCounts(
  input: Pick<VideoScreenInput, 'evidence'>,
  promptIds: ReadonlySet<string>,
  videoId: string,
  startedAt: string | null,
  inScope: (answer: EvidenceAnswer) => boolean
): VideoTrackingCounts {
  const answers = input.evidence.answers.filter(
    (answer) => answer.hasAio && promptIds.has(answer.aio.promptId) && inScope(answer)
  )
  const cites = (answer: EvidenceAnswer): boolean =>
    videosOf(answer).some((video) => video.videoId === videoId)
  const now = answers.filter((answer) => answer.checkIndex === 0)
  const before =
    startedAt === null
      ? []
      : newestPerPageMarket(answers.filter((answer) => answer.aio.checkedAt <= startedAt))
  const latestTime = (list: readonly EvidenceAnswer[]): string | null =>
    list.reduce<string | null>(
      (best, answer) =>
        best === null || answer.aio.checkedAt > best ? answer.aio.checkedAt : best,
      null
    )
  return {
    beforeAt: latestTime(before),
    beforeCiting: before.length === 0 ? null : before.filter(cites).length,
    beforeAios: before.length === 0 ? null : before.length,
    nowAt: latestTime(now),
    nowCiting: now.filter(cites).length,
    nowAios: now.length,
    nowKeys: now.filter(cites).map((answer) => answer.aio.key),
    openKeys: now.filter((answer) => !cites(answer)).map((answer) => answer.aio.key),
    beforeKeys: before.filter(cites).map((answer) => answer.aio.key)
  }
}

/** For each page and market, the answers of its newest run in `answers`. */
function newestPerPageMarket(answers: readonly EvidenceAnswer[]): EvidenceAnswer[] {
  const newestRun = new Map<string, { runId: string; at: string }>()
  for (const answer of answers) {
    const key = `${answer.aio.pageId}\n${answer.aio.marketId}`
    const current = newestRun.get(key)
    if (current === undefined || answer.aio.checkedAt > current.at) {
      newestRun.set(key, { runId: answer.aio.runId, at: answer.aio.checkedAt })
    }
  }
  const runs = new Set([...newestRun.values()].map((item) => item.runId))
  return answers.filter((answer) => runs.has(answer.aio.runId))
}
