import type {
  AddQuestionsRequest,
  AddQuestionsResult,
  AllPagesData,
  AssistantAnswer,
  AssistantAskRequest,
  AssistResult,
  AssistRunRequest,
  CheckJob,
  CiteFoxApi,
  DraftFixResult,
  ProjectIdRequest,
  SetTopicTargetRequest,
  SetTopicTargetResult,
  StartCheckRequest,
  TopicPromptRequest
} from '@shared/ipc'
import { currentClientMode, type ClientMode } from '../onboarding/flags'

/**
 * Ask CiteFox's channels: `assistant:ask` for answers, and the existing
 * channels an action card calls once the user confirms it. The mock is for
 * dev and e2e mock builds only.
 */
export interface AssistantClient {
  ask(request: AssistantAskRequest): Promise<AssistantAnswer>
  addQuestions(request: AddQuestionsRequest): Promise<AddQuestionsResult>
  draftTopicFix(request: TopicPromptRequest): Promise<DraftFixResult>
  runAssist(request: AssistRunRequest): Promise<AssistResult>
  setTarget(request: SetTopicTargetRequest): Promise<SetTopicTargetResult>
  startCheck(request: StartCheckRequest): Promise<CheckJob>
  /** The pages and searches left a "start a check" card prices itself with (Check now's model). */
  listPages(request: ProjectIdRequest): Promise<AllPagesData | null>
}

export function createAssistantClient(mode: ClientMode = currentClientMode()): AssistantClient {
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    return createMockAssistantClient()
  }
  return createIpcAssistantClient()
}

export function createMockAssistantClient(): AssistantClient {
  const mock = async (): Promise<typeof import('./mock')> => import('./mock')
  return {
    ask: async (request) => (await mock()).mockAsk(request),
    addQuestions: async (request) => (await mock()).mockAddQuestions(request),
    draftTopicFix: async (request) => (await mock()).mockDraftFix(request),
    runAssist: async (request) => (await mock()).mockRunAssist(request),
    setTarget: async (request) => (await mock()).mockSetTarget(request),
    startCheck: async (request) => (await mock()).mockStartCheck(request),
    listPages: async () => null
  }
}

function createIpcAssistantClient(): AssistantClient {
  return {
    ask: (request) => requireApi()['assistant:ask'](request),
    addQuestions: (request) => requireApi()['prompts:addQuestions'](request),
    draftTopicFix: (request) => requireApi()['topics:draftFix'](request),
    runAssist: (request) => requireApi()['assist:run'](request),
    setTarget: (request) => requireApi()['topics:setTarget'](request),
    startCheck: (request) => requireApi()['checks:start'](request),
    listPages: (request) => requireApi()['allpages:list'](request)
  }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
