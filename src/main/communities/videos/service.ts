import type { VideoIdea, VideoScreen, VideoStep } from '@shared/domain'
import { VIDEO_STEPS } from '@shared/domain'
import type {
  ExportVideoFileRequest,
  TrackVideoRequest,
  UpdateVideoIdeaRequest,
  VideoExportResult,
  VideoIdeaRequest,
  VideoScreenRequest,
  WriteVideoBriefRequest
} from '@shared/ipc'
import { projectClaudeModel, resolveClaude } from '../../engine/claude'
import { youtubeVideoId, youtubeWatchUrl } from '../../engine/checks/url'
import type { OpenProject } from '../../engine/project-db'
import { IpcRequestError } from '../../ipc-request'
import { sha256 } from '../../pipeline/hash'
import { completeStructured } from '../../pipeline/llm'
import { modelFor } from '../../pipeline/template-settings'
import { loadGenerationTemplate } from '../../pipeline/templates'
import { getLatestSnapshot } from '../../storage/snapshot-records'
import { inProject, loadState, type CommunitiesDeps, type ProjectState } from '../context'
import { getVideoIdea, saveVideoIdea, type StoredVideoIdea } from '../store'
import {
  finalizeVideoBrief,
  renderVideoBriefPrompt,
  VIDEO_BRIEF_SCHEMA,
  VIDEO_BRIEF_KIND,
  videoBriefBlocks,
  videoBriefProblem
} from './brief'
import { fence } from '../../prompts/blocks'
import { videoFile, videoSlug } from './files'
import { buildVideoScreen } from './ideas'

/** Checks kept for "before" and "now" (FR-18.7). */
const VIDEO_DEPTH = 6

/** Page text sent with the brief is cut here so a long page fits one call. */
const MAX_PAGE_TEXT = 60_000

/** `videos:get` (FR-18.1, FR-18.2). */
export function getVideoScreen(
  deps: CommunitiesDeps,
  request: VideoScreenRequest
): Promise<VideoScreen> {
  return inProject(deps, request.projectId, 'videos:get', (opened) => {
    const state = loadState(deps, opened, {
      projectId: request.projectId,
      pageId: null,
      marketId: null,
      depth: VIDEO_DEPTH
    })
    return screenOf(deps, state, request)
  })
}

function screenOf(
  deps: CommunitiesDeps,
  state: ProjectState,
  request: VideoScreenRequest
): VideoScreen {
  return buildVideoScreen({
    projectId: request.projectId,
    pageId: request.pageId,
    marketId: request.marketId,
    builtAt: deps.host.now().toISOString(),
    evidence: state.evidence,
    stored: state.ideas,
    videos: state.videos,
    ownVideoIds: state.own.videoIds,
    ownChannelIds: state.own.channelIds,
    extras: { ...state.extras, threadsChecked: 0, videosWithDetails: 0 }
  })
}

/** Opens the project, finds the idea (saved or suggested), runs `change`, saves it, returns it. */
function withIdea(
  deps: CommunitiesDeps,
  request: VideoIdeaRequest,
  channel: string,
  change: (idea: StoredVideoIdea, opened: OpenProject) => Promise<StoredVideoIdea> | StoredVideoIdea
): Promise<VideoIdea> {
  return inProject(deps, request.projectId, channel, async (opened) => {
    const current = findIdea(deps, opened, request)
    if (current === null) throw new IpcRequestError(channel, 'That video idea was not found')
    const next = await change(current, opened)
    saveVideoIdea(opened.db, { ...next, updatedAt: deps.host.now().toISOString() })
    const fresh = loadState(deps, opened, {
      projectId: request.projectId,
      pageId: null,
      marketId: null,
      depth: VIDEO_DEPTH
    })
    const idea = screenOf(deps, fresh, {
      projectId: request.projectId,
      pageId: null,
      marketId: null
    }).ideas.find((item) => item.id === next.id)
    if (idea === undefined) throw new IpcRequestError(channel, 'That video idea was not found')
    return idea
  })
}

/** The saved idea, or a suggestion turned into an unsaved row ready to store. */
function findIdea(
  deps: CommunitiesDeps,
  opened: OpenProject,
  request: VideoIdeaRequest
): StoredVideoIdea | null {
  const stored = getVideoIdea(opened.db, request.ideaId)
  if (stored !== null) return stored
  const state = loadState(deps, opened, {
    projectId: request.projectId,
    pageId: null,
    marketId: null,
    depth: VIDEO_DEPTH
  })
  const suggestion = screenOf(deps, state, {
    projectId: request.projectId,
    pageId: null,
    marketId: null
  }).ideas.find((idea) => idea.id === request.ideaId && !idea.saved)
  if (suggestion === undefined) return null
  const now = deps.host.now().toISOString()
  return {
    id: suggestion.id,
    question: suggestion.question,
    pageId: suggestion.pageId,
    promptIds: suggestion.promptIds,
    step: 'idea',
    brief: null,
    videoUrl: null,
    videoId: null,
    sentToFoxcueAt: null,
    deadline: null,
    checklist: [],
    trackingStartedAt: null,
    createdAt: now,
    updatedAt: now
  }
}

function later(current: VideoStep, next: VideoStep): VideoStep {
  return VIDEO_STEPS.indexOf(next) > VIDEO_STEPS.indexOf(current) ? next : current
}

/** `videos:writeBrief` (FR-18.4). Claude writes it with the `video_brief` template. */
export function writeVideoBrief(
  deps: CommunitiesDeps,
  request: WriteVideoBriefRequest
): Promise<VideoIdea> {
  const channel = 'videos:writeBrief'
  return withIdea(deps, request, channel, async (idea, opened) => {
    if (idea.brief !== null && !request.force) return idea
    const page = opened.db
      .prepare<unknown[], { url: string; title: string | null }>(
        'SELECT url, title FROM pages WHERE id = ?'
      )
      .get(idea.pageId)
    if (page === undefined) throw new IpcRequestError(channel, 'That page was not found')
    const snapshot = getLatestSnapshot(opened.db, idea.pageId)
    if (snapshot === null) {
      throw new IpcRequestError(channel, 'Read the page first', 'Open the page and read it again.')
    }
    const state = loadState(deps, opened, {
      projectId: request.projectId,
      pageId: null,
      marketId: null,
      depth: 1
    })
    const view = screenOf(deps, state, {
      projectId: request.projectId,
      pageId: null,
      marketId: null
    }).ideas.find((item) => item.id === idea.id)
    const sections = [
      ...[snapshot.h1, snapshot.title].filter((text): text is string => text !== null),
      ...snapshot.outline.map((entry) => entry.text),
      ...snapshot.faqs.map((faq) => faq.question)
    ]
    const related = state.evidence.answers
      .filter((answer) => idea.promptIds.includes(answer.aio.promptId))
      .map((answer) => answer.aio.text)
    // FR-26.8: the project's own version of the step, else the app default (TPL-4 hash).
    const template = loadGenerationTemplate(
      deps.host.storage.db,
      VIDEO_BRIEF_KIND,
      undefined,
      'templates:get',
      opened.db
    )
    const prompt = renderVideoBriefPrompt(template.body, {
      question: idea.question,
      related_prompts: bullets([...new Set(related)].filter((text) => text !== idea.question)),
      markets: (view?.marketIds ?? []).join(', ') || 'Not checked yet',
      brand_names: state.evidence.profile.brandNames.join(', '),
      videos_cited: bullets(
        (view?.videos ?? []).map(
          (video) =>
            `${video.title ?? video.url}${video.channelTitle ? ` (${video.channelTitle})` : ''}`
        )
      ),
      page_url: page.url,
      page_title: snapshot.title ?? page.title ?? '',
      page_h1: snapshot.h1 ?? '',
      page_sections: bullets(sections),
      page_text: fence('page_text', snapshot.bodyText.slice(0, MAX_PAGE_TEXT)),
      ...videoBriefBlocks(opened.db, idea.pageId)
    })
    const secrets = deps.host.knownSecrets()
    const result = await completeStructured({
      db: opened.db,
      pageId: idea.pageId,
      provider: resolveClaude(deps.host, channel, opened.project.id),
      logger: deps.host.logger,
      kind: 'video_brief',
      templateId: template.id,
      templateHash: template.templateHash,
      prompt,
      schema: VIDEO_BRIEF_SCHEMA,
      model: modelFor(template.settings, projectClaudeModel(deps.host, opened.project.id)),
      inputHash: sha256(`${template.templateHash}\n${prompt}`),
      validate: (value) => videoBriefProblem(value, page.url, sections),
      secrets,
      force: request.force
    })
    const brief = finalizeVideoBrief(
      result.value,
      { sections, text: snapshot.bodyText },
      deps.host.now().toISOString(),
      template.templateHash
    )
    return { ...idea, brief, step: later(idea.step, 'brief') }
  })
}

/** `videos:update`. Deadline, checklist, or step. Published and tracking need a video URL. */
export function updateVideoIdea(
  deps: CommunitiesDeps,
  request: UpdateVideoIdeaRequest
): Promise<VideoIdea> {
  const channel = 'videos:update'
  return withIdea(deps, request, channel, (idea) => {
    const step = request.patch.step ?? idea.step
    if ((step === 'published' || step === 'tracking') && idea.videoUrl === null) {
      throw new IpcRequestError(channel, "Paste the video's YouTube URL first")
    }
    return {
      ...idea,
      step,
      deadline: request.patch.deadline === undefined ? idea.deadline : request.patch.deadline,
      checklist: request.patch.checklist ?? idea.checklist
    }
  })
}

/** `videos:markSent` (FR-18.8). Only records that the idea was sent. Nothing leaves CiteFox. */
export function markVideoSent(
  deps: CommunitiesDeps,
  request: VideoIdeaRequest
): Promise<VideoIdea> {
  return withIdea(deps, request, 'videos:markSent', (idea) => ({
    ...idea,
    sentToFoxcueAt: idea.sentToFoxcueAt ?? deps.host.now().toISOString(),
    step: later(idea.step, 'sent')
  }))
}

/** `videos:track` (FR-18.7). Stores the video as `watch?v=<id>` and starts the before/now count. */
export function trackVideo(deps: CommunitiesDeps, request: TrackVideoRequest): Promise<VideoIdea> {
  const channel = 'videos:track'
  const videoId = youtubeVideoId(request.videoUrl.trim())
  if (videoId === null) {
    return Promise.reject(
      new IpcRequestError(
        channel,
        'That is not a YouTube video URL',
        'Paste the link from YouTube.'
      )
    )
  }
  return withIdea(deps, request, channel, (idea) => ({
    ...idea,
    videoUrl: youtubeWatchUrl(videoId),
    videoId,
    step: 'tracking',
    trackingStartedAt:
      idea.videoId === videoId && idea.trackingStartedAt !== null
        ? idea.trackingStartedAt
        : deps.host.now().toISOString()
  }))
}

/** `videos:export` (FR-18.5). The user picks where; the renderer never sends a path. */
export function exportVideoFile(
  deps: CommunitiesDeps,
  request: ExportVideoFileRequest
): Promise<VideoExportResult> {
  const channel = 'videos:export'
  return inProject(deps, request.projectId, channel, async (opened) => {
    const idea = getVideoIdea(opened.db, request.ideaId)
    if (idea === null || idea.brief === null) {
      return { ok: false as const, reason: 'Write the brief first.' }
    }
    const page = opened.db
      .prepare<unknown[], { url: string }>('SELECT url FROM pages WHERE id = ?')
      .get(idea.pageId)
    const file = videoFile(request.file, idea.brief, {
      question: idea.question,
      pageUrl: page?.url ?? '',
      slug: videoSlug(idea.brief.title)
    })
    const dialog = deps.saveDialog()
    if (dialog === null) return { ok: false as const, reason: 'Could not open the save dialog.' }
    const picked = await dialog({
      title: 'Export for your editor',
      defaultPath: file.filename,
      filters: [file.filter]
    })
    if (picked.canceled || picked.filePath === undefined || picked.filePath.length === 0) {
      return { ok: false as const, reason: 'Not saved.' }
    }
    await deps.writeFile(picked.filePath, file.content)
    return {
      ok: true as const,
      filename: picked.filePath.split(/[\\/]/).at(-1) ?? file.filename,
      bytes: Buffer.byteLength(file.content, 'utf8')
    }
  })
}

function bullets(items: readonly string[]): string {
  return items.length === 0 ? 'None' : items.map((item) => `- ${item}`).join('\n')
}
