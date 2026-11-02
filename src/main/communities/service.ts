import type {
  CommunitiesReport,
  CommunitySettings,
  ThreadCheckResult,
  VideoDetailsResult
} from '@shared/domain'
import type {
  CheckThreadsRequest,
  CommunitiesRequest,
  SetCommunitySettingsRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { ProviderError } from '../providers/errors'
import { inProject, isChannelId, loadState, youtubeKey, type CommunitiesDeps } from './context'
import { CHECK_DEPTH, loadEvidence } from './evidence'
import { checkRedditThreads } from './reddit'
import { buildCommunitiesReport } from './report'
import {
  firstSeenByUrl,
  listRedditThreads,
  listYoutubeVideos,
  readCommunitySettings,
  upsertYoutubeVideo,
  writeCommunitySettings
} from './store'
import { videosOf } from './videos/ideas'
import { fetchVideoDetails, resolveChannelHandle, type YoutubeApiDeps } from './youtube-api'

/** A video's API details are refreshed after this long. */
const VIDEO_DETAILS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** `communities:get` (FR-17.1 to FR-17.5). */
export function getCommunities(
  deps: CommunitiesDeps,
  request: CommunitiesRequest
): Promise<CommunitiesReport> {
  const channel = 'communities:get'
  if (request.scope === 'page' && request.pageId === null) throw new IpcRequestError(channel)
  return inProject(deps, request.projectId, channel, (opened) => {
    const pageId = request.scope === 'page' ? request.pageId : null
    if (pageId !== null && !opened.db.prepare('SELECT 1 FROM pages WHERE id = ?').get(pageId)) {
      throw new IpcRequestError(channel, 'That page was not found')
    }
    const state = loadState(deps, opened, {
      projectId: request.projectId,
      pageId,
      marketId: request.marketId,
      depth: CHECK_DEPTH
    })
    return buildCommunitiesReport({
      projectId: request.projectId,
      scope: request.scope,
      pageId,
      marketId: request.marketId,
      builtAt: deps.host.now().toISOString(),
      evidence: state.evidence,
      threads: listRedditThreads(opened.db),
      videos: state.videos,
      firstSeen: firstSeenByUrl(opened.db),
      ownVideoIds: state.own.videoIds,
      ownChannelIds: state.own.channelIds,
      extras: state.extras
    })
  })
}

/** `communities:checkThreads` (FR-17.4). Public Reddit data, on demand, through the guarded transport. */
export function checkThreads(
  deps: CommunitiesDeps,
  request: CheckThreadsRequest
): Promise<ThreadCheckResult> {
  return inProject(deps, request.projectId, 'communities:checkThreads', (opened) => {
    const evidence = loadEvidence(opened.db, opened.project.domain, {
      projectId: request.projectId,
      pageId: null,
      marketId: null,
      depth: 1
    })
    const cited = new Set(
      evidence.answers.flatMap((answer) =>
        answer.references
          .filter((ref) => ref.sourceType === 'reddit')
          .map((ref) => ref.normalizedUrl)
      )
    )
    const urls = request.urls === null ? [...cited] : request.urls.filter((url) => cited.has(url))
    return checkRedditThreads(
      {
        http: deps.host.http,
        sleep: deps.sleep,
        now: deps.host.now,
        userAgent: deps.userAgent,
        ...(deps.redditIntervalMs !== undefined ? { minIntervalMs: deps.redditIntervalMs } : {})
      },
      opened.db,
      urls,
      { force: request.force, brandNames: evidence.profile.brandNames }
    )
  })
}

/** `communities:refreshVideos` (FR-11.9). Needs the user's own YouTube Data API key. */
export function refreshVideos(
  deps: CommunitiesDeps,
  projectId: string
): Promise<VideoDetailsResult> {
  return inProject(deps, projectId, 'communities:refreshVideos', async (opened) => {
    const key = youtubeKey(deps.host, projectId)
    if (key === null) {
      return {
        fetched: 0,
        missingKey: true,
        message: 'Add a YouTube Data API key in Connections to see views and publish dates.'
      }
    }
    const api = apiDeps(deps)
    const evidence = loadEvidence(opened.db, opened.project.domain, {
      projectId,
      pageId: null,
      marketId: null,
      depth: CHECK_DEPTH
    })
    const cached = listYoutubeVideos(opened.db)
    const nowMs = deps.host.now().getTime()
    const wanted = new Set(
      evidence.answers.flatMap((answer) => videosOf(answer).map((video) => video.videoId))
    )
    const due = [...wanted].filter((id) => {
      const row = cached.get(id)
      return row === undefined || nowMs - Date.parse(row.fetchedAt) > VIDEO_DETAILS_MAX_AGE_MS
    })
    try {
      await resolveOwnHandle(deps, opened.db, key, api)
      const rows = await fetchVideoDetails(api, key, due)
      for (const row of rows) upsertYoutubeVideo(opened.db, row)
      return {
        fetched: rows.filter((row) => !row.missing).length,
        missingKey: false,
        message: null
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        return { fetched: 0, missingKey: false, message: error.message }
      }
      throw error
    }
  })
}

export function getSettings(deps: CommunitiesDeps, projectId: string): Promise<CommunitySettings> {
  return inProject(deps, projectId, 'communities:getSettings', (opened) => ({
    youtubeChannel: readCommunitySettings(opened.db).youtubeChannel
  }))
}

/** Saves the project's own channel. A handle is resolved to its id when a key is stored. */
export function setSettings(
  deps: CommunitiesDeps,
  request: SetCommunitySettingsRequest
): Promise<CommunitySettings> {
  return inProject(deps, request.projectId, 'communities:setSettings', async (opened) => {
    const channel = request.youtubeChannel
    writeCommunitySettings(
      opened.db,
      {
        youtubeChannel: channel,
        youtubeChannelId: channel !== null && isChannelId(channel) ? channel : null
      },
      deps.host.now().toISOString()
    )
    const key = youtubeKey(deps.host, request.projectId)
    if (key !== null && channel !== null && !isChannelId(channel)) {
      try {
        await resolveOwnHandle(deps, opened.db, key, apiDeps(deps))
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error
        deps.host.logger.warn('youtube handle not resolved', { message: error.message })
      }
    }
    return { youtubeChannel: channel }
  })
}

async function resolveOwnHandle(
  deps: CommunitiesDeps,
  db: Parameters<typeof readCommunitySettings>[0],
  key: string,
  api: YoutubeApiDeps
): Promise<void> {
  const settings = readCommunitySettings(db)
  const channel = settings.youtubeChannel
  if (channel === null || isChannelId(channel) || settings.youtubeChannelId !== null) return
  const handle = channel.startsWith('@') ? channel : `@${channel}`
  const id = await resolveChannelHandle(api, key, handle)
  writeCommunitySettings(db, { ...settings, youtubeChannelId: id }, deps.host.now().toISOString())
}

function apiDeps(deps: CommunitiesDeps): YoutubeApiDeps {
  return {
    http: deps.host.http,
    sleep: deps.sleep,
    now: deps.host.now,
    secrets: deps.host.knownSecrets()
  }
}
