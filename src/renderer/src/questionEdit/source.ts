import type {
  AddQuestionsRequest,
  AddQuestionsResult,
  CheckJob,
  MoveQuestionsRequest,
  MoveQuestionsResult,
  ProjectIdRequest,
  QuestionDetail,
  QuestionEditRequest,
  QuestionEditResult,
  QuestionGetRequest,
  QuestionTargets,
  QuestionsList,
  QuestionsListRequest,
  QuestionsRestoreRequest,
  QuestionsRestoreResult,
  QuestionsUpdateRequest,
  QuestionsUpdateResult,
  SetQuestionStageRequest,
  SetQuestionStageResult,
  StartCheckRequest,
  StatusCapsule
} from '@shared/ipc'

/**
 * Every channel the question edit drawer, the move/copy drawer and the shared
 * question row actions use. Production uses the preload allow-list; tests pass a fake.
 */
export interface QuestionEditSource {
  'questions:get'(request: QuestionGetRequest): Promise<QuestionDetail>
  'questions:edit'(request: QuestionEditRequest): Promise<QuestionEditResult>
  'questions:update'(request: QuestionsUpdateRequest): Promise<QuestionsUpdateResult>
  'questions:restore'(request: QuestionsRestoreRequest): Promise<QuestionsRestoreResult>
  'questions:list'(request: QuestionsListRequest): Promise<QuestionsList>
  'topics:moveQuestions'(request: MoveQuestionsRequest): Promise<MoveQuestionsResult>
  'topics:setQuestionStage'(request: SetQuestionStageRequest): Promise<SetQuestionStageResult>
  'prompts:addTargets'(request: ProjectIdRequest): Promise<QuestionTargets>
  'prompts:addQuestions'(request: AddQuestionsRequest): Promise<AddQuestionsResult>
  'checks:start'(request: StartCheckRequest): Promise<CheckJob>
  'status:getCapsule'(): Promise<StatusCapsule>
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createQuestionEditSource(): QuestionEditSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'questions:get': async (request) => requireApi()['questions:get'](request),
    'questions:edit': async (request) => requireApi()['questions:edit'](request),
    'questions:update': async (request) => requireApi()['questions:update'](request),
    'questions:restore': async (request) => requireApi()['questions:restore'](request),
    'questions:list': async (request) => requireApi()['questions:list'](request),
    'topics:moveQuestions': async (request) => requireApi()['topics:moveQuestions'](request),
    'topics:setQuestionStage': async (request) => requireApi()['topics:setQuestionStage'](request),
    'prompts:addTargets': async (request) => requireApi()['prompts:addTargets'](request),
    'prompts:addQuestions': async (request) => requireApi()['prompts:addQuestions'](request),
    'checks:start': async (request) => requireApi()['checks:start'](request),
    'status:getCapsule': async () => requireApi()['status:getCapsule']()
  }
}

let override: QuestionEditSource | null = null
let live: QuestionEditSource | null = null

/** The source the window-wide drawers and row menus use (one object, so effects keep it). */
export function questionEditSource(): QuestionEditSource {
  if (override) return override
  live ??= createQuestionEditSource()
  return live
}

/** Tests only: null puts the preload bridge back. */
export function setQuestionEditSourceForTests(source: QuestionEditSource | null): void {
  override = source
}
