import type {
  BuyerProfile,
  CheckDueResult,
  CoverageMatrix,
  PageScoreList,
  PageSummary,
  ProjectSchedule,
  ProjectScoreList,
  PromptSetView,
  QueueStatus
} from '@shared/domain'
import type {
  AddPageRequest,
  AddPromptRequest,
  CiteFoxApi,
  CoverageRunList,
  CoverageRunRequest,
  CreateProjectRequest,
  EditPromptRequest,
  PageDetail,
  GenerateBuyerProfileRequest,
  GenerateCoverageRequest,
  GeneratePromptsRequest,
  PageIdRequest,
  PageList,
  PageReadProgress,
  PageReadResult,
  PinnedPage,
  PinnedPageList,
  ProjectDetail,
  ProjectIdRequest,
  ProjectList,
  PromptIdRequest,
  RemovePageResult,
  ReorderPromptsRequest,
  SearchPagesRequest,
  SearchPagesResult,
  GapStates,
  SetGapDoneRequest,
  SetGapStatusRequest,
  SetPromptEnabledRequest,
  StartPageReadRequest,
  StartSuggestUrlsRequest,
  StartUrlSuggestions,
  TrayLine,
  UpdateBuyerProfileRequest,
  UpdateGapDraftRequest,
  UpdatePageRequest,
  UpdateProjectRequest
} from '@shared/ipc'
import { createIpcOnboardingClient, type OnboardingClient } from '../onboarding/client'
import type { EngineEvents } from '../shell/useEngineUpdates'

/**
 * Onboarding calls plus the M2 project and page calls this task renders.
 * Method names are local. Argument and result types are the IPC contract.
 */
export interface ShellClient extends OnboardingClient, EngineEvents {
  listProjects(): Promise<ProjectList>
  getProject(request: ProjectIdRequest): Promise<ProjectDetail>
  createProject(request: CreateProjectRequest): Promise<ProjectDetail>
  updateProject(request: UpdateProjectRequest): Promise<ProjectDetail>
  switchProject(request: ProjectIdRequest): Promise<ProjectDetail>
  listPages(request: ProjectIdRequest): Promise<PageList>
  getPage(request: PageIdRequest): Promise<PageDetail>
  addPage(request: AddPageRequest): Promise<PageDetail>
  updatePage(request: UpdatePageRequest): Promise<PageDetail>
  removePage(request: PageIdRequest): Promise<RemovePageResult>
  searchPages(request: SearchPagesRequest): Promise<SearchPagesResult>
  pinPage(request: PageIdRequest): Promise<PinnedPage>
  unpinPage(request: PageIdRequest): Promise<PageSummary>
  pinnedPages(request: ProjectIdRequest): Promise<PinnedPageList>
  trayLine(request: ProjectIdRequest): Promise<TrayLine>
  getRead(request: PageIdRequest): Promise<PageReadResult | null>
  readStart(request: StartPageReadRequest): Promise<PageReadResult>
  onReadProgress(listener: (payload: PageReadProgress) => void): () => void
  getBuyerProfile(request: PageIdRequest): Promise<BuyerProfile | null>
  generateBuyerProfile(request: GenerateBuyerProfileRequest): Promise<BuyerProfile>
  updateBuyerProfile(request: UpdateBuyerProfileRequest): Promise<BuyerProfile>
  listPrompts(request: PageIdRequest): Promise<PromptSetView>
  generatePrompts(request: GeneratePromptsRequest): Promise<PromptSetView>
  addPrompt(request: AddPromptRequest): Promise<PromptSetView>
  editPrompt(request: EditPromptRequest): Promise<PromptSetView>
  removePrompt(request: PromptIdRequest): Promise<PromptSetView>
  setPromptEnabled(request: SetPromptEnabledRequest): Promise<PromptSetView>
  reorderPrompts(request: ReorderPromptsRequest): Promise<PromptSetView>
  savePrompts(request: PageIdRequest): Promise<PromptSetView>
  discardPrompts(request: PageIdRequest): Promise<PromptSetView>
  getGaps(request: PageIdRequest): Promise<CoverageMatrix | null>
  generateGaps(request: GenerateCoverageRequest): Promise<CoverageMatrix>
  setGapDone(request: SetGapDoneRequest): Promise<CoverageMatrix>
  redoGap(request: PromptIdRequest): Promise<CoverageMatrix>
  /** Content gap edits (drafts, open/published/verified). Optional: without them the tab is read-only for those. */
  getGapStates?(request: PageIdRequest): Promise<GapStates>
  updateGapDraft?(request: UpdateGapDraftRequest): Promise<GapStates>
  setGapStatus?(request: SetGapStatusRequest): Promise<GapStates>
  listCoverage(request: PageIdRequest): Promise<CoverageRunList>
  getCoverage(request: CoverageRunRequest): Promise<CoverageMatrix>
  listProjectScores(): Promise<ProjectScoreList>
  listPageScores(request: ProjectIdRequest): Promise<PageScoreList>
  getProjectSchedule(request: ProjectIdRequest): Promise<ProjectSchedule>
  getQueueStatus(): Promise<QueueStatus>
  checkDue(): Promise<CheckDueResult>
  /** Sitemap pages for the Add page address box. Optional: without it the box has no list. */
  suggestUrls?(request: StartSuggestUrlsRequest): Promise<StartUrlSuggestions>
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createIpcShellClient(): ShellClient {
  const onboarding = createIpcOnboardingClient()
  return {
    ...onboarding,
    listProjects: () => requireApi()['projects:list'](),
    getProject: (request) => requireApi()['projects:get'](request),
    createProject: (request) => requireApi()['projects:create'](request),
    updateProject: (request) => requireApi()['projects:update'](request),
    switchProject: (request) => requireApi()['projects:switch'](request),
    listPages: (request) => requireApi()['pages:list'](request),
    getPage: (request) => requireApi()['pages:get'](request),
    addPage: (request) => requireApi()['pages:add'](request),
    updatePage: (request) => requireApi()['pages:update'](request),
    removePage: (request) => requireApi()['pages:remove'](request),
    searchPages: (request) => requireApi()['pages:search'](request),
    pinPage: (request) => requireApi()['pages:pin'](request),
    unpinPage: (request) => requireApi()['pages:unpin'](request),
    pinnedPages: (request) => requireApi()['pages:pinned'](request),
    trayLine: (request) => requireApi()['tray:getLine'](request),
    getRead: (request) => requireApi()['pages:getRead'](request),
    readStart: (request) => requireApi()['pages:readStart'](request),
    onReadProgress: (listener) => requireApi()['pages:readProgress'](listener),
    getBuyerProfile: (request) => requireApi()['buyerProfile:get'](request),
    generateBuyerProfile: (request) => requireApi()['buyerProfile:generate'](request),
    updateBuyerProfile: (request) => requireApi()['buyerProfile:update'](request),
    listPrompts: (request) => requireApi()['prompts:list'](request),
    generatePrompts: (request) => requireApi()['prompts:generate'](request),
    addPrompt: (request) => requireApi()['prompts:add'](request),
    editPrompt: (request) => requireApi()['prompts:edit'](request),
    removePrompt: (request) => requireApi()['prompts:remove'](request),
    setPromptEnabled: (request) => requireApi()['prompts:setEnabled'](request),
    reorderPrompts: (request) => requireApi()['prompts:reorder'](request),
    savePrompts: (request) => requireApi()['prompts:save'](request),
    discardPrompts: (request) => requireApi()['prompts:discard'](request),
    getGaps: (request) => requireApi()['gaps:get'](request),
    generateGaps: (request) => requireApi()['gaps:generate'](request),
    setGapDone: (request) => requireApi()['gaps:setDone'](request),
    redoGap: (request) => requireApi()['gaps:redo'](request),
    getGapStates: (request) => requireApi()['gaps:getStates'](request),
    updateGapDraft: (request) => requireApi()['gaps:updateDraft'](request),
    setGapStatus: (request) => requireApi()['gaps:setStatus'](request),
    listCoverage: (request) => requireApi()['coverage:list'](request),
    getCoverage: (request) => requireApi()['coverage:get'](request),
    listProjectScores: () => requireApi()['scores:listProjects'](),
    listPageScores: (request) => requireApi()['scores:listPages'](request),
    getProjectSchedule: (request) => requireApi()['schedule:getProject'](request),
    getQueueStatus: () => requireApi()['queue:getStatus'](),
    checkDue: () => requireApi()['queue:checkDue'](),
    suggestUrls: (request) => requireApi()['start:suggestUrls'](request),
    onCheckFinished: (listener) => requireApi()['checks:finished'](listener),
    onQueueStatus: (listener) => requireApi()['queue:status'](listener)
  }
}
