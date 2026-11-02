/** Communities (SRS §4.17) and YouTube opportunities (§4.18). CiteFox never posts (FR-17.7). */

import type {
  CommunitiesReport,
  CommunityScope,
  CommunitySettings,
  ThreadCheckResult,
  VideoChecklistItem,
  VideoDetailsResult,
  VideoIdea,
  VideoScreen,
  VideoStep
} from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/** `communities:get`. Page scope needs `pageId`. Null `marketId` is every market. */
export interface CommunitiesRequest {
  projectId: string
  scope: CommunityScope
  pageId: string | null
  marketId: string | null
}

/**
 * `communities:checkThreads` (FR-17.4). Reads public Reddit data for cited
 * threads, slowly and on demand. Null `urls` is every thread cited in the
 * project's latest checks. `force` refetches threads read in the last day.
 */
export interface CheckThreadsRequest {
  projectId: string
  urls: readonly string[] | null
  force: boolean
}

export interface SetCommunitySettingsRequest {
  projectId: string
  youtubeChannel: string | null
}

/** `videos:get`. Null `pageId` is every tracked page. Null `marketId` is every market. */
export interface VideoScreenRequest {
  projectId: string
  pageId: string | null
  marketId: string | null
}

export interface VideoIdeaRequest {
  projectId: string
  ideaId: string
}

/** `videos:writeBrief`. `force` writes a new brief over a saved one. */
export interface WriteVideoBriefRequest {
  projectId: string
  ideaId: string
  force: boolean
}

/** `videos:update`. Only the fields present change. Step moves only along {@link VideoStep}. */
export interface UpdateVideoIdeaRequest {
  projectId: string
  ideaId: string
  patch: {
    step?: VideoStep
    /** `YYYY-MM-DD`, or null to clear. */
    deadline?: string | null
    checklist?: readonly VideoChecklistItem[]
  }
}

/** `videos:track` (FR-18.7). Any YouTube video URL form; it is stored as `watch?v=<id>`. */
export interface TrackVideoRequest {
  projectId: string
  ideaId: string
  videoUrl: string
}

/** FR-18.5. Script `.md`, captions `.srt`, shot list `.csv`. */
export type VideoExportFile = 'script' | 'captions' | 'shots'

export interface ExportVideoFileRequest {
  projectId: string
  ideaId: string
  file: VideoExportFile
}

/** The file is written where the user picked in the save dialog. The renderer never sends a path. */
export type VideoExportResult =
  { ok: true; filename: string; bytes: number } | { ok: false; reason: string }

/** Invoke channels for this area. Each one is declared here only. */
export const communitiesChannels = {
  'communities:get': invokeWith<CommunitiesRequest, CommunitiesReport>(),
  'communities:checkThreads': invokeWith<CheckThreadsRequest, ThreadCheckResult>(),
  'communities:refreshVideos': invokeWith<ProjectIdRequest, VideoDetailsResult>(),
  'communities:getSettings': invokeWith<ProjectIdRequest, CommunitySettings>(),
  'communities:setSettings': invokeWith<SetCommunitySettingsRequest, CommunitySettings>(),
  'videos:get': invokeWith<VideoScreenRequest, VideoScreen>(),
  'videos:writeBrief': invokeWith<WriteVideoBriefRequest, VideoIdea>(),
  'videos:update': invokeWith<UpdateVideoIdeaRequest, VideoIdea>(),
  /** FR-18.8. Only marks the idea sent. Nothing is sent to FoxCue. */
  'videos:markSent': invokeWith<VideoIdeaRequest, VideoIdea>(),
  'videos:track': invokeWith<TrackVideoRequest, VideoIdea>(),
  'videos:export': invokeWith<ExportVideoFileRequest, VideoExportResult>()
} as const satisfies InvokeChannelSpecs
