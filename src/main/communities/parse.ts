import { isCommunityScope, isVideoChecklistItem, isVideoStep } from '@shared/domain'
import type {
  CheckThreadsRequest,
  CommunitiesRequest,
  ExportVideoFileRequest,
  ProjectIdRequest,
  SetCommunitySettingsRequest,
  TrackVideoRequest,
  UpdateVideoIdeaRequest,
  VideoIdeaRequest,
  VideoScreenRequest,
  WriteVideoBriefRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { isRecord } from '../providers/json-schema'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CHANNEL = /^(@[A-Za-z0-9._-]{3,100}|UC[A-Za-z0-9_-]{22})$/
const MAX_URLS = 500
const MAX_URL_LENGTH = 2000

export function parseCommunitiesRequest(value: unknown): CommunitiesRequest {
  const channel = 'communities:get'
  const record = exact(value, channel, ['projectId', 'scope', 'pageId', 'marketId'])
  const scope = record.scope
  if (typeof scope !== 'string' || !isCommunityScope(scope)) throw new IpcRequestError(channel)
  const pageId = nullableId(record.pageId, channel)
  if (scope === 'page' && pageId === null) throw new IpcRequestError(channel)
  return {
    projectId: id(record.projectId, channel),
    scope,
    pageId,
    marketId: nullableId(record.marketId, channel)
  }
}

export function parseCheckThreads(value: unknown): CheckThreadsRequest {
  const channel = 'communities:checkThreads'
  const record = exact(value, channel, ['projectId', 'urls', 'force'])
  if (typeof record.force !== 'boolean') throw new IpcRequestError(channel)
  let urls: string[] | null = null
  if (record.urls !== null) {
    if (
      !Array.isArray(record.urls) ||
      record.urls.length > MAX_URLS ||
      record.urls.some((url) => !isHttpsUrl(url))
    ) {
      throw new IpcRequestError(channel)
    }
    urls = record.urls as string[]
  }
  return { projectId: id(record.projectId, channel), urls, force: record.force }
}

export function parseProjectId(value: unknown, channel: string): ProjectIdRequest {
  const record = exact(value, channel, ['projectId'])
  return { projectId: id(record.projectId, channel) }
}

export function parseSetSettings(value: unknown): SetCommunitySettingsRequest {
  const channel = 'communities:setSettings'
  const record = exact(value, channel, ['projectId', 'youtubeChannel'])
  let youtubeChannel: string | null = null
  if (record.youtubeChannel !== null) {
    if (typeof record.youtubeChannel !== 'string') throw new IpcRequestError(channel)
    const trimmed = record.youtubeChannel.trim()
    if (trimmed.length > 0) {
      const handle = /^UC/.test(trimmed) || trimmed.startsWith('@') ? trimmed : `@${trimmed}`
      if (!CHANNEL.test(handle)) {
        throw new IpcRequestError(
          channel,
          'Enter a channel handle such as @yourbrand, or a channel id that starts with UC'
        )
      }
      youtubeChannel = handle
    }
  }
  return { projectId: id(record.projectId, channel), youtubeChannel }
}

export function parseVideoScreen(value: unknown): VideoScreenRequest {
  const channel = 'videos:get'
  const record = exact(value, channel, ['projectId', 'pageId', 'marketId'])
  return {
    projectId: id(record.projectId, channel),
    pageId: nullableId(record.pageId, channel),
    marketId: nullableId(record.marketId, channel)
  }
}

export function parseVideoIdea(value: unknown, channel: string): VideoIdeaRequest {
  const record = exact(value, channel, ['projectId', 'ideaId'])
  return { projectId: id(record.projectId, channel), ideaId: id(record.ideaId, channel) }
}

export function parseWriteBrief(value: unknown): WriteVideoBriefRequest {
  const channel = 'videos:writeBrief'
  const record = exact(value, channel, ['projectId', 'ideaId', 'force'])
  if (typeof record.force !== 'boolean') throw new IpcRequestError(channel)
  return {
    projectId: id(record.projectId, channel),
    ideaId: id(record.ideaId, channel),
    force: record.force
  }
}

export function parseUpdateIdea(value: unknown): UpdateVideoIdeaRequest {
  const channel = 'videos:update'
  const record = exact(value, channel, ['projectId', 'ideaId', 'patch'])
  if (!isRecord(record.patch)) throw new IpcRequestError(channel)
  const patch = record.patch
  const allowed = ['step', 'deadline', 'checklist']
  if (Object.keys(patch).some((key) => !allowed.includes(key))) throw new IpcRequestError(channel)
  const parsed: UpdateVideoIdeaRequest['patch'] = {}
  if (Object.hasOwn(patch, 'step')) {
    if (typeof patch.step !== 'string' || !isVideoStep(patch.step)) {
      throw new IpcRequestError(channel)
    }
    parsed.step = patch.step
  }
  if (Object.hasOwn(patch, 'deadline')) {
    if (
      patch.deadline !== null &&
      (typeof patch.deadline !== 'string' || !isDate(patch.deadline))
    ) {
      throw new IpcRequestError(channel)
    }
    parsed.deadline = patch.deadline
  }
  if (Object.hasOwn(patch, 'checklist')) {
    const list = patch.checklist
    if (
      !Array.isArray(list) ||
      list.some((item) => typeof item !== 'string' || !isVideoChecklistItem(item))
    ) {
      throw new IpcRequestError(channel)
    }
    parsed.checklist = [...new Set(list as string[])].filter(isVideoChecklistItem)
  }
  return {
    projectId: id(record.projectId, channel),
    ideaId: id(record.ideaId, channel),
    patch: parsed
  }
}

export function parseTrackVideo(value: unknown): TrackVideoRequest {
  const channel = 'videos:track'
  const record = exact(value, channel, ['projectId', 'ideaId', 'videoUrl'])
  if (
    typeof record.videoUrl !== 'string' ||
    record.videoUrl.length === 0 ||
    record.videoUrl.length > MAX_URL_LENGTH
  ) {
    throw new IpcRequestError(channel, "Paste the video's YouTube URL first")
  }
  return {
    projectId: id(record.projectId, channel),
    ideaId: id(record.ideaId, channel),
    videoUrl: record.videoUrl
  }
}

export function parseExportVideo(value: unknown): ExportVideoFileRequest {
  const channel = 'videos:export'
  const record = exact(value, channel, ['projectId', 'ideaId', 'file'])
  if (record.file !== 'script' && record.file !== 'captions' && record.file !== 'shots') {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: id(record.projectId, channel),
    ideaId: id(record.ideaId, channel),
    file: record.file
  }
}

function exact(value: unknown, channel: string, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new IpcRequestError(channel)
  const present = Object.keys(value)
  if (present.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new IpcRequestError(channel)
  }
  return value
}

function id(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function nullableId(value: unknown, channel: string): string | null {
  return value === null ? null : id(value, channel)
}

function isDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
