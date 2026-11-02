import type { CommunityExtras } from '@shared/domain'
import type { EngineHost } from '../engine/host'
import { withProject, type OpenProject } from '../engine/project-db'
import type { ExportSaveDialog } from '../export/ipc'
import { listApiKeysByProvider } from '../storage/api-key-records'
import { CHECK_DEPTH, loadEvidence, type Evidence } from './evidence'
import {
  listVideoIdeas,
  listYoutubeVideos,
  readCommunitySettings,
  type StoredCommunitySettings,
  type StoredVideoIdea,
  type YoutubeVideoRow
} from './store'

/** What the Communities and YouTube handlers need beyond the engine host. */
export interface CommunitiesDeps {
  host: EngineHost
  sleep: (ms: number) => Promise<void>
  /** Electron's save dialog, or a test double. Null when none is configured. */
  saveDialog: () => ExportSaveDialog | null
  writeFile: (filePath: string, content: string) => Promise<void>
  /** Sent to Reddit with every request, as its API rules ask. */
  userAgent: string
  /** Pause between Reddit requests. Tests pass 0. */
  redditIntervalMs?: number
}

/** The project's YouTube Data API key, when one is stored, on, and serves this project. */
export function youtubeKey(host: EngineHost, projectId: string): string | null {
  const record = listApiKeysByProvider(host.storage.db, 'youtube').find(
    (key) => key.on && (key.projectIds.length === 0 || key.projectIds.includes(projectId))
  )
  if (record === undefined) return null
  const secret = host.secrets.get(record.keychainRef)
  return secret !== null && secret.length > 0 ? secret : null
}

/** A channel id the user typed (`UC` and 22 characters) is used as is. */
export function isChannelId(value: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(value)
}

/** The video ids and channel ids that count as the user's own (FR-11.9, FR-18.7). */
export interface OwnVideos {
  videoIds: ReadonlySet<string>
  channelIds: ReadonlySet<string>
}

export function ownVideos(
  settings: StoredCommunitySettings,
  ideas: readonly StoredVideoIdea[]
): OwnVideos {
  const channelIds = new Set<string>()
  if (settings.youtubeChannelId !== null) channelIds.add(settings.youtubeChannelId)
  if (settings.youtubeChannel !== null && isChannelId(settings.youtubeChannel)) {
    channelIds.add(settings.youtubeChannel)
  }
  const videoIds = new Set(ideas.flatMap((idea) => (idea.videoId === null ? [] : [idea.videoId])))
  return { videoIds, channelIds }
}

/** Everything one Communities or YouTube read loads from the project file. */
export interface ProjectState {
  opened: OpenProject
  evidence: Evidence
  settings: StoredCommunitySettings
  ideas: StoredVideoIdea[]
  videos: Map<string, YoutubeVideoRow>
  own: OwnVideos
  extras: Omit<CommunityExtras, 'threadsChecked' | 'videosWithDetails'>
}

export function loadState(
  deps: CommunitiesDeps,
  opened: OpenProject,
  query: { projectId: string; pageId: string | null; marketId: string | null; depth?: number }
): ProjectState {
  const evidence = loadEvidence(opened.db, opened.project.domain, {
    projectId: query.projectId,
    pageId: query.pageId,
    marketId: query.marketId,
    depth: query.depth ?? CHECK_DEPTH
  })
  const settings = readCommunitySettings(opened.db)
  const ideas = listVideoIdeas(opened.db)
  return {
    opened,
    evidence,
    settings,
    ideas,
    videos: listYoutubeVideos(opened.db),
    own: ownVideos(settings, ideas),
    extras: {
      youtubeKey: youtubeKey(deps.host, query.projectId) !== null,
      ownChannel: settings.youtubeChannel
    }
  }
}

export function inProject<T>(
  deps: CommunitiesDeps,
  projectId: string,
  channel: string,
  run: (opened: OpenProject) => Promise<T> | T
): Promise<T> {
  return withProject(deps.host, projectId, channel, run)
}
