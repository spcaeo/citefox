import type { TemplateSettings } from '@shared/domain'
import {
  DEFAULT_MARKET_DEVICE,
  isCountryCode,
  isIntervalDays,
  isLanguageTag,
  isSampleCount,
  type GenerationTemplateKind,
  type Market,
  type PageSetupStep,
  type CheckDueResult,
  type PageScoreList,
  type PageSummary,
  type ProjectSchedule,
  type ProjectScoreList,
  type QueueState,
  type QueueStatus
} from '@shared/domain'
import type {
  AddPageRequest,
  CreateProjectRequest,
  FillFromWebsiteResult,
  MarketDraft,
  OnboardingProfile,
  PageDetail,
  PageList,
  PinnedPage,
  PinnedPageList,
  PlaygroundAioResult,
  PlaygroundRunResult,
  PlaygroundSavePart,
  ProjectDetail,
  ProjectList,
  RemovePageResult,
  SearchPagesRequest,
  SearchPagesResult,
  TrayLine,
  UpdatePageRequest,
  UpdateProjectRequest
} from '@shared/ipc'
import { matchSerpApiLocation } from '../../onboarding/markets'
import { MAX_PAGE_PROMPT_COUNT, MIN_PAGE_PROMPT_COUNT } from '../../pageSetup/promptCount'
import { type Catalog, type PageRecord, type ProjectRecord, emptyCatalog, market } from './catalog'
import { SHIPPED_TEMPLATES, type ShippedTemplate } from './defaults'
import { fillFromDomain } from './fill'
import {
  checkDueFor,
  localDay,
  pageScoreList,
  projectScoreList,
  queueFor,
  scheduleFor
} from './schedule'

/**
 * Mock stand-in for the active project the engine stores on `projects:switch` and `projects:create`.
 * The shell reads that id only from `projects:list`. It does not read this store.
 */
export interface ActiveProjectStore {
  read(): string | null
  write(id: string): void
}

export const MOCK_ACTIVE_PROJECT_KEY = 'citefox.mock.activeProjectId'
export const MOCK_QUEUE_KEY = 'citefox.mock.queue'

export function memoryActiveProjectStore(initial: string | null = null): ActiveProjectStore {
  let id = initial
  return {
    read: () => id,
    write(next) {
      id = next
    }
  }
}

export function browserActiveProjectStore(): ActiveProjectStore {
  return {
    read() {
      if (typeof localStorage === 'undefined') return null
      return localStorage.getItem(MOCK_ACTIVE_PROJECT_KEY)
    },
    write(id) {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(MOCK_ACTIVE_PROJECT_KEY, id)
    }
  }
}

export function readStoredQueueState(): QueueState {
  if (typeof localStorage === 'undefined') return 'running'
  const stored = localStorage.getItem(MOCK_QUEUE_KEY)
  if (stored === 'paused_all' || stored === 'paused_today' || stored === 'running') return stored
  return 'running'
}

/** When the three shipped templates were created. Stable so hashes and equality checks do not move. */
export const SHIPPED_TEMPLATE_CREATED_AT = '2026-10-01T00:00:00.000Z'

/**
 * One saved generation template.
 * `isDefault` is the one default of this kind. `updatedAt` is null until the body changes.
 * `version` starts at 1. Update adds 1. Delete and restore leave it unchanged.
 */
export interface StoredTemplate extends ShippedTemplate {
  shippedBody: string
  notes: string | null
  isShipped: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string | null
  version: number
  deletedAt: string | null
  /** FR-26.3. Absent means every setting is the default. */
  settings?: TemplateSettings
}

/** One saved artifact counted by `templates:usage`. Playground runs are not these. */
export interface StoredUse {
  id: string
  projectId: string
  pageId: string
  templateId: string
  bucket: 'buyerProfiles' | 'promptSets' | 'coverageMatrices'
  at: string
}

/** One ephemeral playground run. Dropped when the in-memory list passes 20. */
export interface StoredRun {
  result: PlaygroundRunResult
  kind: GenerationTemplateKind
  aio: PlaygroundAioResult | null
  produced: PlaygroundSavePart[]
}

/** In-memory M2 stand-in shared by the Templates editor and the Playground. */
export interface M2Memory {
  templates: StoredTemplate[]
  runs: StoredRun[]
  uses: StoredUse[]
  nextRun: number
  nextTemplate: number
  nextUse: number
}

let memory: M2Memory | null = null

export function getM2Memory(): M2Memory {
  if (!memory) memory = freshMemory()
  return memory
}

export function resetM2Memory(): void {
  memory = freshMemory()
}

function freshMemory(): M2Memory {
  return {
    templates: SHIPPED_TEMPLATES.map((template) => ({
      ...template,
      shippedBody: template.body,
      notes: null,
      isShipped: true,
      isDefault: true,
      createdAt: SHIPPED_TEMPLATE_CREATED_AT,
      updatedAt: null,
      version: 1,
      deletedAt: null
    })),
    runs: [],
    uses: [],
    nextRun: 1,
    nextTemplate: 1,
    nextUse: 1
  }
}

const WORKING = new Set<PageSummary['status']>(['setting_up', 'tracked', 'paused'])

function channelError(channel: string, message: string): Error {
  return new Error(`${channel}: ${message}`)
}

function cloneMarket(item: Market): Market {
  return { ...item }
}

function cloneSummary(page: PageSummary): PageSummary {
  return { ...page }
}

function cloneDetail(project: ProjectDetail): ProjectDetail {
  return {
    ...project,
    brandNames: [...project.brandNames],
    competitors: [...project.competitors],
    defaultMarket: project.defaultMarket ? cloneMarket(project.defaultMarket) : null,
    ...(project.markets !== undefined ? { markets: project.markets.map(cloneMarket) } : {})
  }
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'project'
}

function isWorking(status: PageSummary['status']): boolean {
  return WORKING.has(status)
}

function recount(project: ProjectRecord): void {
  project.detail.foundPageCount = project.pages.length
  project.detail.trackedPageCount = project.pages.filter((page) =>
    isWorking(page.summary.status)
  ).length
}

function toDetail(record: PageRecord): PageDetail {
  return {
    ...cloneSummary(record.summary),
    markets: record.markets.map(cloneMarket),
    snapshotId: record.snapshotId
  }
}

function toPinned(record: PageRecord): PinnedPage {
  const page = record.summary
  return {
    id: page.id,
    projectId: page.projectId,
    label: page.label,
    title: page.title,
    url: page.url ?? '',
    score: page.score,
    intervalDays: page.intervalDays,
    samples: page.samples,
    promptSetVersion: page.promptSetVersion,
    promptCount: page.promptCount,
    markets: record.markets.map(cloneMarket),
    setupStep: page.setupStep
  }
}

function matchesQuery(page: PageSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return false
  const fields = [page.title ?? '', page.label ?? '', page.url ?? '']
  return fields.some((field) => field.toLowerCase().includes(needle))
}

export interface ProjectMemory {
  list(): ProjectList
  get(projectId: string): ProjectDetail
  create(request: CreateProjectRequest): ProjectDetail
  update(request: UpdateProjectRequest): ProjectDetail
  switchTo(projectId: string): ProjectDetail
  fill(domain: string): FillFromWebsiteResult
  listPages(projectId: string): PageList
  getPage(projectId: string, pageId: string): PageDetail
  addPage(request: AddPageRequest): PageDetail
  updatePage(request: UpdatePageRequest): PageDetail
  removePage(projectId: string, pageId: string): RemovePageResult
  searchPages(request: SearchPagesRequest): SearchPagesResult
  pin(projectId: string, pageId: string): PinnedPage
  unpin(projectId: string, pageId: string): PageSummary
  pinned(projectId: string): PinnedPageList
  tray(projectId: string): TrayLine
  listProjectScores(): ProjectScoreList
  listPageScores(projectId: string): PageScoreList
  getProjectSchedule(projectId: string): ProjectSchedule
  getQueueStatus(): QueueStatus
  checkDue(): CheckDueResult
  upsertFromProfile(profile: OnboardingProfile): void
  noteSetup(
    projectId: string,
    pageId: string,
    patch: {
      snapshotId?: string | null
      title?: string | null
      promptSetVersion?: number | null
      promptCount?: number
      setupStep?: PageSetupStep | null
    }
  ): PageDetail
}

export function createProjectMemory(
  seed: Catalog = emptyCatalog(),
  options: { activeStore?: ActiveProjectStore; queueState?: QueueState } = {}
): ProjectMemory {
  const projects: ProjectRecord[] = seed.projects.map(cloneProject)
  const storedActive = options.activeStore?.read() ?? null
  let activeProjectId =
    storedActive !== null && projects.some((project) => project.detail.id === storedActive)
      ? storedActive
      : seed.activeProjectId
  let sequence = 1
  const queueState = options.queueState ?? 'running'
  let dueToday: { day: string; result: CheckDueResult } | null = null

  function rememberActive(id: string): void {
    activeProjectId = id
    options.activeStore?.write(id)
  }

  function nextId(prefix: string): string {
    sequence += 1
    return `${prefix}-${sequence}`
  }

  function requireProject(projectId: string, channel: string): ProjectRecord {
    const found = projects.find((project) => project.detail.id === projectId)
    if (!found) throw channelError(channel, 'No project with that id')
    return found
  }

  function requirePage(project: ProjectRecord, pageId: string, channel: string): PageRecord {
    const found = project.pages.find((page) => page.summary.id === pageId)
    if (!found) throw channelError(channel, 'No page with that id')
    return found
  }

  function uniqueSlug(name: string): string {
    const base = slugify(name)
    const taken = new Set(projects.map((project) => project.detail.slug))
    if (!taken.has(base)) return base
    let suffix = 2
    while (taken.has(`${base}-${suffix}`)) suffix += 1
    return `${base}-${suffix}`
  }

  return {
    list() {
      return {
        activeProjectId,
        projects: projects.map((project) => ({ ...project.detail }))
      }
    },

    get(projectId) {
      return cloneDetail(requireProject(projectId, 'projects:get').detail)
    },

    create(request) {
      const name = request.name.trim()
      const domain = request.domain.trim()
      if (!name || !domain) {
        throw channelError('projects:create', 'Name and domain are required')
      }
      if (request.brandNames.length === 0) {
        throw channelError('projects:create', 'Add at least one brand name')
      }
      if (!isCountryCode(request.country)) {
        throw channelError('projects:create', 'Country must be a two-letter code')
      }
      if (!isLanguageTag(request.language)) {
        throw channelError('projects:create', 'Language must be an ISO 639-1 or BCP-47 tag')
      }
      if (
        request.copySettingsFrom !== undefined &&
        request.copySettingsFrom !== null &&
        !projects.some((project) => project.detail.id === request.copySettingsFrom)
      ) {
        throw channelError('projects:create', 'That project was not found')
      }
      if (request.search?.source === 'dedicated' && request.search.dedicatedKeyId === null) {
        throw channelError('projects:create', 'Choose a dedicated key')
      }
      const slug = uniqueSlug(name)
      const id = nextId('project')
      const defaultMarket = market(
        nextId('market'),
        request.country,
        request.language,
        request.location,
        matchSerpApiLocation(request.location)
      )
      const detail: ProjectDetail = {
        id,
        name,
        slug,
        domain,
        dbPath: `projects/${slug}.sqlite`,
        clientName: request.clientName,
        status: 'active',
        includeSubdomains: request.includeSubdomains,
        brandNames: [...request.brandNames],
        competitors: [...request.competitors],
        defaultMarket,
        markets: [defaultMarket],
        foundPageCount: 0,
        trackedPageCount: 0
      }
      projects.push({ detail, pages: [], running: false, pagesDueToday: 0 })
      rememberActive(id)
      return cloneDetail(detail)
    },

    update(request) {
      const project = requireProject(request.projectId, 'projects:update')
      const detail = project.detail
      if (request.name !== undefined) {
        const name = request.name.trim()
        if (!name) throw channelError('projects:update', 'Name is required')
        detail.name = name
      }
      if (request.domain !== undefined) {
        const domain = request.domain.trim()
        if (!domain) throw channelError('projects:update', 'Domain is required')
        detail.domain = domain
      }
      if (request.includeSubdomains !== undefined) {
        detail.includeSubdomains = request.includeSubdomains
      }
      if (request.brandNames !== undefined) {
        if (request.brandNames.length === 0) {
          throw channelError('projects:update', 'Add at least one brand name')
        }
        detail.brandNames = [...request.brandNames]
      }
      if (request.competitors !== undefined) detail.competitors = [...request.competitors]
      if (request.clientName !== undefined) detail.clientName = request.clientName
      if (request.status !== undefined) detail.status = request.status
      if (
        request.country !== undefined ||
        request.language !== undefined ||
        request.location !== undefined ||
        request.device !== undefined
      ) {
        const current = detail.defaultMarket
        const country = request.country ?? current?.country ?? ''
        const language = request.language ?? current?.language ?? ''
        if (!isCountryCode(country)) {
          throw channelError('projects:update', 'Country must be a two-letter code')
        }
        if (!isLanguageTag(language)) {
          throw channelError('projects:update', 'Language must be an ISO 639-1 or BCP-47 tag')
        }
        const location =
          request.location !== undefined ? request.location : (current?.location ?? null)
        detail.defaultMarket = {
          id: current?.id ?? nextId('market'),
          country,
          language,
          location,
          device: request.device ?? current?.device ?? DEFAULT_MARKET_DEVICE,
          localWording: current?.localWording ?? false,
          serpapiLocation: matchSerpApiLocation(location)
        }
      }
      return cloneDetail(detail)
    },

    switchTo(projectId) {
      const project = requireProject(projectId, 'projects:switch')
      rememberActive(project.detail.id)
      return cloneDetail(project.detail)
    },

    fill(domain) {
      return fillFromDomain(domain.trim())
    },

    listPages(projectId) {
      const project = requireProject(projectId, 'pages:list')
      const pages = project.pages
        .filter((page) => isWorking(page.summary.status))
        .map((page) => cloneSummary(page.summary))
      const result: PageList = { foundPageCount: project.detail.foundPageCount, pages }
      return result
    },

    getPage(projectId, pageId) {
      const project = requireProject(projectId, 'pages:get')
      return toDetail(requirePage(project, pageId, 'pages:get'))
    },

    addPage(request) {
      const project = requireProject(request.projectId, 'pages:add')
      const url = normalizeUrl(request.url)
      if (!url) throw channelError('pages:add', 'Enter a public http or https address')
      if (!isIntervalDays(request.intervalDays)) {
        throw channelError('pages:add', 'Re-check interval must be 14, 30, 60, or 90 days')
      }
      if (!isSampleCount(request.samples)) {
        throw channelError('pages:add', 'Samples per prompt must be from 1 to 5')
      }
      assertPromptCount(request.promptCount, 'pages:add')
      const markets = resolveMarkets(project, request.markets, nextId, 'pages:add')
      const id = nextId('page')
      const record: PageRecord = {
        pinOrder: null,
        markets,
        summary: {
          id,
          projectId: project.detail.id,
          url,
          title: null,
          label: null,
          folder: folderFromUrl(url),
          status: 'setting_up',
          setupStep: 'read',
          intervalDays: request.intervalDays,
          samples: request.samples,
          promptCount: request.promptCount,
          defaultMarketId: markets[0]?.id ?? null,
          pinned: false,
          score: null,
          promptSetVersion: null
        },
        snapshotId: null
      }
      project.pages.push(record)
      recount(project)
      return toDetail(record)
    },

    updatePage(request) {
      const project = requireProject(request.projectId, 'pages:update')
      const record = requirePage(project, request.pageId, 'pages:update')
      if (request.url !== undefined) {
        const url = normalizeUrl(request.url)
        if (!url) throw channelError('pages:update', 'Enter a public http or https address')
        record.summary.url = url
      }
      if (request.label !== undefined) record.summary.label = request.label
      if (request.intervalDays !== undefined) {
        if (!isIntervalDays(request.intervalDays)) {
          throw channelError('pages:update', 'Re-check interval must be 14, 30, 60, or 90 days')
        }
        record.summary.intervalDays = request.intervalDays
      }
      if (request.samples !== undefined) {
        if (!isSampleCount(request.samples)) {
          throw channelError('pages:update', 'Samples per prompt must be from 1 to 5')
        }
        record.summary.samples = request.samples
      }
      if (request.promptCount !== undefined) {
        assertPromptCount(request.promptCount, 'pages:update')
        record.summary.promptCount = request.promptCount
      }
      if (request.markets !== undefined) {
        if (request.markets.length === 0) {
          throw channelError('pages:update', 'A page needs at least one market')
        }
        record.markets = resolveMarkets(project, request.markets, nextId, 'pages:update')
        record.summary.defaultMarketId = record.markets[0]?.id ?? null
      }
      if (request.defaultMarketId !== undefined) {
        if (!record.markets.some((item) => item.id === request.defaultMarketId)) {
          throw channelError('pages:update', 'That market is not on this page')
        }
        record.summary.defaultMarketId = request.defaultMarketId
      }
      if (request.status !== undefined) {
        record.summary.status = request.status
        if (request.status !== 'setting_up') record.summary.setupStep = null
      }
      recount(project)
      return toDetail(record)
    },

    removePage(projectId, pageId) {
      const project = requireProject(projectId, 'pages:remove')
      const record = requirePage(project, pageId, 'pages:remove')
      record.summary.status = 'removed'
      record.summary.pinned = false
      record.pinOrder = null
      recount(project)
      const result: RemovePageResult = { id: record.summary.id, status: 'removed' }
      return result
    },

    searchPages(request) {
      const project = requireProject(request.projectId, 'pages:search')
      const query = request.query.trim()
      const pages = query
        ? project.pages
            .filter((page) => matchesQuery(page.summary, query))
            .map((page) => cloneSummary(page.summary))
        : []
      const result: SearchPagesResult = {
        foundPageCount: project.detail.foundPageCount,
        pages
      }
      return result
    },

    pin(projectId, pageId) {
      const project = requireProject(projectId, 'pages:pin')
      const record = requirePage(project, pageId, 'pages:pin')
      if (record.summary.status === 'removed') {
        throw channelError('pages:pin', 'A removed page cannot be pinned')
      }
      if (record.pinOrder === null) {
        const oldest = project.pages.reduce((max, page) => Math.max(max, page.pinOrder ?? 0), 0) + 1
        record.pinOrder = oldest
        record.summary.pinned = true
      }
      return toPinned(record)
    },

    unpin(projectId, pageId) {
      const project = requireProject(projectId, 'pages:unpin')
      const record = requirePage(project, pageId, 'pages:unpin')
      record.pinOrder = null
      record.summary.pinned = false
      return cloneSummary(record.summary)
    },

    pinned(projectId) {
      const project = requireProject(projectId, 'pages:pinned')
      const pages = project.pages
        .filter((page) => page.pinOrder !== null && page.summary.pinned)
        .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0))
        .map(toPinned)
      const result: PinnedPageList = { pages }
      return result
    },

    tray(projectId) {
      const project = requireProject(projectId, 'tray:getLine')
      const line: TrayLine = {
        projectId: project.detail.id,
        running: project.running,
        pagesDueToday: scheduleFor(project).pagesDueToday
      }
      return line
    },

    listProjectScores() {
      return projectScoreList(projects)
    },

    listPageScores(projectId) {
      return pageScoreList(requireProject(projectId, 'scores:listPages'))
    },

    getProjectSchedule(projectId) {
      return scheduleFor(requireProject(projectId, 'schedule:getProject'))
    },

    getQueueStatus() {
      return queueFor(projects, queueState)
    },

    checkDue() {
      const day = localDay()
      if (dueToday?.day === day) {
        return { started: false, jobIds: dueToday.result.jobIds, pages: dueToday.result.pages }
      }
      const result = checkDueFor({ records: projects, state: queueState, alreadyRan: null })
      if (result.started) dueToday = { day, result }
      return result
    },

    noteSetup(projectId, pageId, patch) {
      const project = requireProject(projectId, 'pages:get')
      const record = requirePage(project, pageId, 'pages:get')
      if (patch.snapshotId !== undefined) record.snapshotId = patch.snapshotId
      if (patch.title !== undefined && patch.title !== null) record.summary.title = patch.title
      if (patch.promptSetVersion !== undefined)
        record.summary.promptSetVersion = patch.promptSetVersion
      if (patch.promptCount !== undefined) {
        assertPromptCount(patch.promptCount, 'pages:update')
        record.summary.promptCount = patch.promptCount
      }
      if (patch.setupStep !== undefined) record.summary.setupStep = patch.setupStep
      return toDetail(record)
    },

    upsertFromProfile(profile) {
      const existing = projects.find(
        (project) =>
          project.detail.id === profile.project.id ||
          project.detail.domain === profile.project.domain
      )
      if (existing) {
        existing.detail.name = profile.project.name
        existing.detail.domain = profile.project.domain
        existing.detail.slug = profile.project.slug
        existing.detail.dbPath = profile.project.dbPath
        existing.detail.clientName = profile.project.clientName
        existing.detail.status = profile.project.status
        existing.detail.includeSubdomains = profile.includeSubdomains
        existing.detail.brandNames = [...profile.brandNames]
        existing.detail.competitors = [...profile.competitors]
        existing.detail.defaultMarket = cloneMarket(profile.defaultMarket)
        return
      }
      projects.push({
        detail: {
          ...profile.project,
          includeSubdomains: profile.includeSubdomains,
          brandNames: [...profile.brandNames],
          competitors: [...profile.competitors],
          defaultMarket: cloneMarket(profile.defaultMarket),
          foundPageCount: 0,
          trackedPageCount: 0
        },
        pages: [],
        running: false,
        pagesDueToday: 0
      })
      if (activeProjectId === null) rememberActive(profile.project.id)
    }
  }
}

function cloneProject(project: ProjectRecord): ProjectRecord {
  return {
    detail: cloneDetail(project.detail),
    running: project.running,
    pagesDueToday: project.pagesDueToday,
    pages: project.pages.map((page) => ({
      pinOrder: page.pinOrder,
      snapshotId: page.snapshotId,
      markets: page.markets.map(cloneMarket),
      summary: cloneSummary(page.summary)
    }))
  }
}

function assertPromptCount(count: number, channel: string): void {
  if (!Number.isInteger(count) || count < MIN_PAGE_PROMPT_COUNT) {
    throw channelError(channel, 'Enter a whole number of buyer prompts from 1 to 1,000.')
  }
  if (count > MAX_PAGE_PROMPT_COUNT) {
    throw channelError(channel, 'The maximum prompt count is 1000.')
  }
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function folderFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.split('/').filter((part) => part.length > 0)
    return path.length > 1 ? (path[0] ?? null) : null
  } catch {
    return null
  }
}

function resolveMarkets(
  project: ProjectRecord,
  drafts: readonly MarketDraft[],
  nextId: (prefix: string) => string,
  channel: string
): Market[] {
  if (drafts.length === 0) {
    const fallback = project.detail.defaultMarket
    if (!fallback) throw channelError(channel, 'Add a market or set the project default')
    return [cloneMarket(fallback)]
  }
  return drafts.map((draft) => {
    if (!isCountryCode(draft.country)) {
      throw channelError(channel, 'Country must be a two-letter code')
    }
    if (!isLanguageTag(draft.language)) {
      throw channelError(channel, 'Language must be an ISO 639-1 or BCP-47 tag')
    }
    return {
      id: nextId('market'),
      country: draft.country,
      language: draft.language,
      location: draft.location,
      device: draft.device,
      localWording: draft.localWording,
      serpapiLocation: matchSerpApiLocation(draft.location)
    }
  })
}
