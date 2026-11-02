import type {
  AddPageRequest,
  AssistResult,
  AssistRunRequest,
  CheckJob,
  GoogleQuestions,
  ImportCommitRequest,
  ImportDraftRequest,
  ImportCommitResult,
  ImportTemplateRequest,
  ImportTemplateResult,
  ImportUndoRequest,
  ImportUndoResult,
  ImportValidateRequest,
  ImportValidateResult,
  PageDetail,
  PageIdRequest,
  ProjectIdRequest,
  QuestionsDraft,
  QuestionTargets,
  QuestionsList,
  QuestionsListRequest,
  SaveQuestionsDraftRequest,
  StartCheckRequest,
  UpdatePageRequest
} from '@shared/ipc'
import { currentClientMode, type ClientMode } from '../onboarding/flags'
import type { HelpFillSource } from '../ui'

/**
 * The channels Add questions uses: the pages and topics it can add to (with markets,
 * schedule and searches left), every tracked question (duplicates, stage counts,
 * "From tracked questions"), the live row checks and the batch add and its Undo
 * (the shared importer), the `prompts.more` assist, ✦ Help me write
 * (`helpfill:*`), a check of just the new questions, and adding a page.
 * Production uses the preload allow-list; the mock build (`citefox.client=mock`)
 * answers from the mock catalog, whose projects the main process does not know;
 * tests pass a fake.
 */
export interface AddQuestionsSource extends HelpFillSource {
  'prompts:addTargets'(request: ProjectIdRequest): Promise<QuestionTargets>
  'questions:list'(request: QuestionsListRequest): Promise<QuestionsList>
  'import:validate'(request: ImportValidateRequest): Promise<ImportValidateResult>
  'import:commit'(request: ImportCommitRequest): Promise<ImportCommitResult>
  'import:undo'(request: ImportUndoRequest): Promise<ImportUndoResult>
  'import:template'(request: ImportTemplateRequest): Promise<ImportTemplateResult>
  'assist:run'(request: AssistRunRequest): Promise<AssistResult>
  'checks:start'(request: StartCheckRequest): Promise<CheckJob>
  'pages:add'(request: AddPageRequest): Promise<PageDetail>
  'pages:update'(request: UpdatePageRequest): Promise<PageDetail>
  /** The unsaved rows kept in main (W3I-C4). Optional: a test fake may leave them out. */
  'import:getDraft'?(request: ImportDraftRequest): Promise<QuestionsDraft | null>
  'import:saveDraft'?(request: SaveQuestionsDraftRequest): Promise<{ saved: boolean }>
  'import:clearDraft'?(request: ImportDraftRequest): Promise<{ cleared: boolean }>
  /** "Seen on Google" in ✦ Help me write. Optional: a test fake may leave it out. */
  'prompts:googleQuestions'?(request: PageIdRequest): Promise<GoogleQuestions>
}

export function createAddQuestionsSource(
  mode: ClientMode = currentClientMode()
): AddQuestionsSource {
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    return lazyMockSource()
  }
  // Async so a missing bridge rejects the promise instead of throwing during render.
  return {
    'prompts:addTargets': async (request) => requireApi()['prompts:addTargets'](request),
    'questions:list': async (request) => requireApi()['questions:list'](request),
    'import:validate': async (request) => requireApi()['import:validate'](request),
    'import:commit': async (request) => requireApi()['import:commit'](request),
    'import:undo': async (request) => requireApi()['import:undo'](request),
    'import:template': async (request) => requireApi()['import:template'](request),
    'assist:run': async (request) => requireApi()['assist:run'](request),
    'checks:start': async (request) => requireApi()['checks:start'](request),
    'pages:add': async (request) => requireApi()['pages:add'](request),
    'pages:update': async (request) => requireApi()['pages:update'](request),
    'import:getDraft': async (request) => requireApi()['import:getDraft'](request),
    'import:saveDraft': async (request) => requireApi()['import:saveDraft'](request),
    'import:clearDraft': async (request) => requireApi()['import:clearDraft'](request),
    'prompts:googleQuestions': async (request) => requireApi()['prompts:googleQuestions'](request),
    'helpfill:estimate': async (request) => requireApi()['helpfill:estimate'](request),
    'helpfill:prompt': async (request) => requireApi()['helpfill:prompt'](request),
    'helpfill:read': async (request) => requireApi()['helpfill:read'](request),
    'helpfill:describe': async (request) => requireApi()['helpfill:describe'](request)
  }
}

/** The mock module loads on first use, so it stays out of the main bundle. */
function lazyMockSource(): AddQuestionsSource {
  let loaded: Promise<AddQuestionsSource> | null = null
  const mock = (): Promise<AddQuestionsSource> =>
    (loaded ??= import('./mockSource').then((module) => module.createMockAddQuestionsSource()))
  return {
    'prompts:addTargets': async (request) => (await mock())['prompts:addTargets'](request),
    'questions:list': async (request) => (await mock())['questions:list'](request),
    'import:validate': async (request) => (await mock())['import:validate'](request),
    'import:commit': async (request) => (await mock())['import:commit'](request),
    'import:undo': async (request) => (await mock())['import:undo'](request),
    'import:template': async (request) => (await mock())['import:template'](request),
    'assist:run': async (request) => (await mock())['assist:run'](request),
    'checks:start': async (request) => (await mock())['checks:start'](request),
    'pages:add': async (request) => (await mock())['pages:add'](request),
    'pages:update': async (request) => (await mock())['pages:update'](request),
    'import:getDraft': async (request) => (await mock())['import:getDraft']?.(request) ?? null,
    'import:saveDraft': async (request) =>
      (await mock())['import:saveDraft']?.(request) ?? { saved: false },
    'import:clearDraft': async (request) =>
      (await mock())['import:clearDraft']?.(request) ?? { cleared: false },
    'prompts:googleQuestions': async (request) =>
      (await mock())['prompts:googleQuestions']?.(request) ?? {
        pageId: request.pageId,
        questions: []
      },
    'helpfill:estimate': async (request) => (await mock())['helpfill:estimate'](request),
    'helpfill:prompt': async (request) => (await mock())['helpfill:prompt'](request),
    'helpfill:read': async (request) => (await mock())['helpfill:read'](request),
    'helpfill:describe': async (request) => (await mock())['helpfill:describe'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
