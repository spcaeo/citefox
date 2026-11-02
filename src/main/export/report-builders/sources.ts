import type { RedditReplyState } from '@shared/domain'
import { redditThreadOf } from '../../communities/source-type'
import { youtubeVideoId } from '../model/source-urls'
import type { ReportBuildContext, SourcesSection } from '../model/types'
import { NOTHING_TO_REPLY, type ExportSourceExtras } from '../sections/sources'

interface ThreadDetails {
  replyState: RedditReplyState
  upvotes: number | null
  comments: number | null
}

/**
 * REPORT-SPEC section 8 with the Communities data (FR-17.4, FR-11.9): YouTube channel,
 * views and publish date from "Get views", and Reddit open / archived / locked with
 * upvotes and comments from "Check threads". The counts and drills stay the base
 * section's (built from the same stored references), so every drill still lists
 * exactly `n` rows. Without Communities data the base section is returned unchanged.
 */
export function communitySources(
  base: SourcesSection,
  context: ReportBuildContext,
  extras: ExportSourceExtras
): SourcesSection {
  const videoDetails = extras.videos ?? new Map()
  const threadDetails = new Map<string, ThreadDetails>()
  for (const [url, details] of extras.threads ?? new Map()) {
    const id = redditThreadOf(url)?.threadId
    if (id !== null && id !== undefined) threadDetails.set(id.toLowerCase(), details)
  }
  if (videoDetails.size === 0 && threadDetails.size === 0) return base

  const videos = base.youtube.videos.map((video) => {
    const details = videoDetails.get(video.videoId)
    if (details === undefined) return video
    return {
      ...video,
      title: video.title ?? details.title,
      channel: details.channelTitle,
      views: details.views,
      publishedAt: details.publishedAt
    }
  })
  const aioRows = new Set(context.rows.filter((row) => row.aio).map((row) => row.id))
  const rowsOfVideo = new Map<string, string[]>()
  for (const reference of context.references) {
    if (!aioRows.has(reference.rowId)) continue
    const id = youtubeVideoId(reference.url)
    if (id === null) continue
    rowsOfVideo.set(id, [...(rowsOfVideo.get(id) ?? []), reference.rowId])
  }
  const byChannel = new Map<string, { videos: number; citations: number; rows: string[] }>()
  for (const video of videos) {
    if (video.channel === null) continue
    const entry = byChannel.get(video.channel) ?? { videos: 0, citations: 0, rows: [] }
    entry.videos += 1
    entry.citations += video.citations
    entry.rows.push(...(rowsOfVideo.get(video.videoId) ?? []))
    byChannel.set(video.channel, entry)
  }
  const channels = [...byChannel.entries()]
    .map(([channel, entry]) => ({
      channel,
      videos: entry.videos,
      prompts: context.count(`channel:${channel}`, entry.rows),
      citations: entry.citations
    }))
    .sort(
      (left, right) => right.citations - left.citations || left.channel.localeCompare(right.channel)
    )

  const threads = base.reddit.threads.map((thread) => {
    const id = redditThreadOf(thread.url)?.threadId
    const details =
      id === null || id === undefined ? undefined : threadDetails.get(id.toLowerCase())
    if (details === undefined) return thread
    return {
      ...thread,
      replyStatus: details.replyState,
      upvotes: details.upvotes,
      comments: details.comments
    }
  })
  const checked = threads.filter((thread) => thread.replyStatus !== 'unchecked')
  const open = threads.filter((thread) => thread.replyStatus === 'open').length
  const sentence =
    threads.length === 0 || checked.length === 0
      ? base.reddit.sentence
      : open === 0
        ? NOTHING_TO_REPLY
        : `${open} of ${threads.length} cited Reddit threads are open for replies.`

  return {
    ...base,
    youtube: {
      videos,
      channels,
      detailsMissing: videos.some((video) => video.channel === null && video.views === null)
    },
    reddit: { ...base.reddit, threads, sentence }
  }
}
