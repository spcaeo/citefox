import type {
  CommunitiesReport,
  CommunitySettings,
  ThreadCheckResult,
  VideoDetailsResult
} from '@shared/domain'
import type { CheckThreadsRequest, CommunitiesRequest, ProjectIdRequest } from '@shared/ipc'

/**
 * One method per channel the Communities tab uses. Production calls the preload
 * allow-list (`window.citefox`). Tests and the Vite harness pass another source.
 */
export interface CommunitiesSource {
  'communities:get'(request: CommunitiesRequest): Promise<CommunitiesReport>
  'communities:checkThreads'(request: CheckThreadsRequest): Promise<ThreadCheckResult>
  'communities:refreshVideos'(request: ProjectIdRequest): Promise<VideoDetailsResult>
  'communities:getSettings'(request: ProjectIdRequest): Promise<CommunitySettings>
}

export function createCommunitiesSource(): CommunitiesSource {
  return {
    'communities:get': (request) => requireApi()['communities:get'](request),
    'communities:checkThreads': (request) => requireApi()['communities:checkThreads'](request),
    'communities:refreshVideos': (request) => requireApi()['communities:refreshVideos'](request),
    'communities:getSettings': (request) => requireApi()['communities:getSettings'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
