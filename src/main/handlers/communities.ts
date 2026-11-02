/** Communities (SRS §4.17) and YouTube opportunities (§4.18). CiteFox never posts (FR-17.7). */

import { writeFile } from 'node:fs/promises'
import type { communitiesChannels, IpcHandlersFor } from '@shared/ipc'
import type { CommunitiesDeps } from '../communities/context'
import {
  parseCheckThreads,
  parseCommunitiesRequest,
  parseExportVideo,
  parseProjectId,
  parseSetSettings,
  parseTrackVideo,
  parseUpdateIdea,
  parseVideoIdea,
  parseVideoScreen,
  parseWriteBrief
} from '../communities/parse'
import {
  checkThreads,
  getCommunities,
  getSettings,
  refreshVideos,
  setSettings
} from '../communities/service'
import {
  exportVideoFile,
  getVideoScreen,
  markVideoSent,
  trackVideo,
  updateVideoIdea,
  writeVideoBrief
} from '../communities/videos/service'
import { currentExportSaveDialog } from '../export/ipc'
import { sleep } from '../providers/timeout'
import { guard, type EngineContext } from './context'

export interface CommunitiesHandlerOptions {
  /** Test seam. Production pauses between Reddit requests. */
  sleep?: (ms: number) => Promise<void>
  redditIntervalMs?: number
}

export function communitiesHandlers(
  ctx: EngineContext,
  options: CommunitiesHandlerOptions = {}
): IpcHandlersFor<typeof communitiesChannels> {
  const deps: CommunitiesDeps = {
    host: ctx,
    sleep: options.sleep ?? sleep,
    saveDialog: currentExportSaveDialog,
    writeFile: (filePath, content) => writeFile(filePath, content, { encoding: 'utf8' }),
    userAgent: `desktop:CiteFox:${ctx.appInfo().version} (open-source AI Overview tracker)`,
    ...(options.redditIntervalMs !== undefined
      ? { redditIntervalMs: options.redditIntervalMs }
      : {})
  }
  return {
    'communities:get': (request) =>
      guard('communities:get', ctx, () => getCommunities(deps, parseCommunitiesRequest(request))),
    'communities:checkThreads': (request) =>
      guard('communities:checkThreads', ctx, () => checkThreads(deps, parseCheckThreads(request))),
    'communities:refreshVideos': (request) =>
      guard('communities:refreshVideos', ctx, () =>
        refreshVideos(deps, parseProjectId(request, 'communities:refreshVideos').projectId)
      ),
    'communities:getSettings': (request) =>
      guard('communities:getSettings', ctx, () =>
        getSettings(deps, parseProjectId(request, 'communities:getSettings').projectId)
      ),
    'communities:setSettings': (request) =>
      guard('communities:setSettings', ctx, () => setSettings(deps, parseSetSettings(request))),
    'videos:get': (request) =>
      guard('videos:get', ctx, () => getVideoScreen(deps, parseVideoScreen(request))),
    'videos:writeBrief': (request) =>
      guard('videos:writeBrief', ctx, () => writeVideoBrief(deps, parseWriteBrief(request))),
    'videos:update': (request) =>
      guard('videos:update', ctx, () => updateVideoIdea(deps, parseUpdateIdea(request))),
    'videos:markSent': (request) =>
      guard('videos:markSent', ctx, () =>
        markVideoSent(deps, parseVideoIdea(request, 'videos:markSent'))
      ),
    'videos:track': (request) =>
      guard('videos:track', ctx, () => trackVideo(deps, parseTrackVideo(request))),
    'videos:export': (request) =>
      guard('videos:export', ctx, () => exportVideoFile(deps, parseExportVideo(request)))
  }
}
