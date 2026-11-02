import type { CommunitySettings, VideoDetailsResult, VideoIdea, VideoScreen } from '@shared/domain'
import type {
  ExportVideoFileRequest,
  ProjectIdRequest,
  SetCommunitySettingsRequest,
  TrackVideoRequest,
  UpdateVideoIdeaRequest,
  VideoExportResult,
  VideoIdeaRequest,
  VideoScreenRequest,
  WriteVideoBriefRequest
} from '@shared/ipc'

/**
 * One method per channel the YouTube screen uses. Production calls the preload
 * allow-list (`window.citefox`). Tests and the Vite harness pass another source.
 * FoxCue is never a channel: its buttons are plain links the main process opens
 * in the browser (FR-18.8).
 */
export interface VideosSource {
  'videos:get'(request: VideoScreenRequest): Promise<VideoScreen>
  'videos:writeBrief'(request: WriteVideoBriefRequest): Promise<VideoIdea>
  'videos:update'(request: UpdateVideoIdeaRequest): Promise<VideoIdea>
  'videos:markSent'(request: VideoIdeaRequest): Promise<VideoIdea>
  'videos:track'(request: TrackVideoRequest): Promise<VideoIdea>
  'videos:export'(request: ExportVideoFileRequest): Promise<VideoExportResult>
  'communities:refreshVideos'(request: ProjectIdRequest): Promise<VideoDetailsResult>
  'communities:getSettings'(request: ProjectIdRequest): Promise<CommunitySettings>
  'communities:setSettings'(request: SetCommunitySettingsRequest): Promise<CommunitySettings>
}

export function createVideosSource(): VideosSource {
  return {
    'videos:get': (request) => requireApi()['videos:get'](request),
    'videos:writeBrief': (request) => requireApi()['videos:writeBrief'](request),
    'videos:update': (request) => requireApi()['videos:update'](request),
    'videos:markSent': (request) => requireApi()['videos:markSent'](request),
    'videos:track': (request) => requireApi()['videos:track'](request),
    'videos:export': (request) => requireApi()['videos:export'](request),
    'communities:refreshVideos': (request) => requireApi()['communities:refreshVideos'](request),
    'communities:getSettings': (request) => requireApi()['communities:getSettings'](request),
    'communities:setSettings': (request) => requireApi()['communities:setSettings'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
