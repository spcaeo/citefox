import type { FixKind, FixList, LoggedFix } from '@shared/domain'
import type {
  AssistResult,
  AssistRunRequest,
  ChangeLedger,
  CreateFixRequest,
  DraftFixResult,
  DraftPageBriefRequest,
  FixIdRequest,
  GridCsvRequest,
  GridCsvResult,
  IndexCheckPreview,
  IndexCheckRequest,
  IndexCheckRun,
  LostGroundRequest,
  LostGroundView,
  PageFixBriefList,
  PageFixCount,
  ProjectFixList,
  ProjectIdRequest,
  RecoveryPlan,
  RunFollowUpResult,
  RunIndexCheckRequest,
  SavedPageFixBrief,
  SavePageFixBriefRequest,
  DraftOwnerWhyRequest,
  DraftPageEditRequest,
  OwnerWhyRequest,
  OwnerWhyResult,
  PageEditRequest,
  PageEditResult,
  SavePageEditHtmlRequest,
  SavePageEditHtmlResult,
  SaveRecoveryPlanRequest,
  SetFixKindRequest,
  SetLoopOwnerRequest,
  SetTopicTargetRequest,
  SetTopicTargetResult,
  SuggestAnchorsRequest,
  SuggestAnchorsResult,
  TopicPageBrief,
  TopicPromptRequest,
  QuestionTargets
} from '@shared/ipc'
import type { LoopStep } from '@shared/fix-loop'
import type { ProjectSearches } from '@shared/page-fixes'

/**
 * One method per channel the project-wide Fixes screen uses: the fix log, the
 * fix → measure → repeat loop (ledger, next round, index checks, backlinks, lost
 * ground), the searches What to fix rolls up, and the CSV writer. Production uses the preload allow-list
 * (`window.citefox`); tests pass a fake.
 */
export interface ProjectFixesSource {
  'fixes:listProject'(request: ProjectIdRequest): Promise<ProjectFixList>
  /** "I published this" on a page fix: logs it live today. */
  'fixes:create'(request: CreateFixRequest): Promise<LoggedFix>
  /** The pages and topics a published page fix can be stored on, with their markets. */
  'prompts:addTargets'(request: ProjectIdRequest): Promise<QuestionTargets>
  'fixes:runFollowUp'(request: FixIdRequest): Promise<RunFollowUpResult>
  'fixes:delete'(request: FixIdRequest): Promise<FixList>
  'fixes:restore'(request: FixIdRequest): Promise<LoggedFix>
  'fixes:ledger'(request: ProjectIdRequest): Promise<ChangeLedger>
  'fixes:setOwner'(request: SetLoopOwnerRequest): Promise<Readonly<Record<LoopStep, string>>>
  'fixes:setKind'(request: SetFixKindRequest): Promise<{ fixId: string; kind: FixKind }>
  'fixes:indexPreview'(request: IndexCheckRequest): Promise<IndexCheckPreview>
  'fixes:checkIndex'(request: RunIndexCheckRequest): Promise<IndexCheckRun>
  'fixes:suggestAnchors'(request: SuggestAnchorsRequest): Promise<SuggestAnchorsResult>
  'fixes:lostGround'(request: LostGroundRequest): Promise<LostGroundView>
  'fixes:saveRecoveryPlan'(request: SaveRecoveryPlanRequest): Promise<RecoveryPlan>
  'grid:exportCsv'(request: GridCsvRequest): Promise<GridCsvResult>
  'fixes:searches'(request: ProjectIdRequest): Promise<ProjectSearches>
  'fixes:pageFixCount'(request: ProjectIdRequest): Promise<PageFixCount>
  /** Saved page fix briefs: What to fix's "Brief ready" status, and the drawer's brief. */
  'fixes:briefs'(request: ProjectIdRequest): Promise<PageFixBriefList>
  'fixes:saveBrief'(request: SavePageFixBriefRequest): Promise<SavedPageFixBrief>
  /** Page edits: the page with suggested changes (struck out and added), saved per fix. */
  'fixes:draftPageEdit'(request: DraftPageEditRequest): Promise<PageEditResult>
  'fixes:pageEdit'(request: PageEditRequest): Promise<PageEditResult | null>
  'fixes:savePageEditHtml'(request: SavePageEditHtmlRequest): Promise<SavePageEditHtmlResult>
  /** Why Google picks another page (owner fixes): the verdict and content changes, saved per fix. */
  'fixes:draftOwnerWhy'(request: DraftOwnerWhyRequest): Promise<OwnerWhyResult>
  'fixes:ownerWhy'(request: OwnerWhyRequest): Promise<OwnerWhyResult | null>
  /** Page fix briefs and owners (What to fix): the topic steps, the page assist. No searches. */
  'topics:draftFix'(request: TopicPromptRequest): Promise<DraftFixResult>
  'topics:draftPageBrief'(request: DraftPageBriefRequest): Promise<TopicPageBrief>
  'topics:setTarget'(request: SetTopicTargetRequest): Promise<SetTopicTargetResult>
  'assist:run'(request: AssistRunRequest): Promise<AssistResult>
}

export function createProjectFixesSource(): ProjectFixesSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'fixes:listProject': async (request) => requireApi()['fixes:listProject'](request),
    'fixes:create': async (request) => requireApi()['fixes:create'](request),
    'prompts:addTargets': async (request) => requireApi()['prompts:addTargets'](request),
    'fixes:runFollowUp': async (request) => requireApi()['fixes:runFollowUp'](request),
    'fixes:delete': async (request) => requireApi()['fixes:delete'](request),
    'fixes:restore': async (request) => requireApi()['fixes:restore'](request),
    'fixes:ledger': async (request) => requireApi()['fixes:ledger'](request),
    'fixes:setOwner': async (request) => requireApi()['fixes:setOwner'](request),
    'fixes:setKind': async (request) => requireApi()['fixes:setKind'](request),
    'fixes:indexPreview': async (request) => requireApi()['fixes:indexPreview'](request),
    'fixes:checkIndex': async (request) => requireApi()['fixes:checkIndex'](request),
    'fixes:suggestAnchors': async (request) => requireApi()['fixes:suggestAnchors'](request),
    'fixes:lostGround': async (request) => requireApi()['fixes:lostGround'](request),
    'fixes:saveRecoveryPlan': async (request) => requireApi()['fixes:saveRecoveryPlan'](request),
    'grid:exportCsv': async (request) => requireApi()['grid:exportCsv'](request),
    'fixes:searches': async (request) => requireApi()['fixes:searches'](request),
    'fixes:pageFixCount': async (request) => requireApi()['fixes:pageFixCount'](request),
    'fixes:briefs': async (request) => requireApi()['fixes:briefs'](request),
    'fixes:saveBrief': async (request) => requireApi()['fixes:saveBrief'](request),
    'fixes:draftPageEdit': async (request) => requireApi()['fixes:draftPageEdit'](request),
    'fixes:pageEdit': async (request) => requireApi()['fixes:pageEdit'](request),
    'fixes:savePageEditHtml': async (request) => requireApi()['fixes:savePageEditHtml'](request),
    'fixes:draftOwnerWhy': async (request) => requireApi()['fixes:draftOwnerWhy'](request),
    'fixes:ownerWhy': async (request) => requireApi()['fixes:ownerWhy'](request),
    'topics:draftFix': async (request) => requireApi()['topics:draftFix'](request),
    'topics:draftPageBrief': async (request) => requireApi()['topics:draftPageBrief'](request),
    'topics:setTarget': async (request) => requireApi()['topics:setTarget'](request),
    'assist:run': async (request) => requireApi()['assist:run'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
