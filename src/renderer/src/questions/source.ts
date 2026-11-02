import type {
  CheckJob,
  EngineSummaryRequest,
  EngineSummaryView,
  MoveQuestionsRequest,
  MoveQuestionsResult,
  QuestionsList,
  QuestionsListRequest,
  QuestionsUpdateRequest,
  QuestionsUpdateResult,
  SetQuestionStageRequest,
  SetQuestionStageResult,
  SetTopicTargetRequest,
  SetTopicTargetResult,
  SortQuestionsRequest,
  SortQuestionsResult,
  StartCheckRequest,
  StatusCapsule,
  TopicDescribeStepRequest,
  TopicFolderList,
  TopicList,
  TopicPageCandidates,
  TopicProjectRequest,
  TopicStepDescription
} from '@shared/ipc'

/**
 * The channels the Questions screen uses: the list, the bulk update, a check of the
 * selected questions (the same `checks:start` follow-up as "Re-check now"), the
 * searches left for the cost line, and the topic moves of the grouping (move, stage,
 * target page, and Claude's sort of "Not in a topic"), and each engine's statuses for
 * the engine filter and dots. Production uses the preload
 * allow-list; tests pass another `QuestionsSource`.
 */
export interface QuestionsSource {
  'questions:list'(request: QuestionsListRequest): Promise<QuestionsList>
  'questions:update'(request: QuestionsUpdateRequest): Promise<QuestionsUpdateResult>
  'checks:start'(request: StartCheckRequest): Promise<CheckJob>
  'status:getCapsule'(): Promise<StatusCapsule>
  'topics:list'(request: TopicProjectRequest): Promise<TopicList>
  'topics:moveQuestions'(request: MoveQuestionsRequest): Promise<MoveQuestionsResult>
  'topics:setQuestionStage'(request: SetQuestionStageRequest): Promise<SetQuestionStageResult>
  'topics:setTarget'(request: SetTopicTargetRequest): Promise<SetTopicTargetResult>
  'topics:pageCandidates'(request: TopicProjectRequest): Promise<TopicPageCandidates>
  'topics:sortQuestions'(request: SortQuestionsRequest): Promise<SortQuestionsResult>
  'topics:describeStep'(request: TopicDescribeStepRequest): Promise<TopicStepDescription>
  /** Each engine's statuses for the engine filter and dots. Absent: Google only. */
  'engines:summary'?: (request: EngineSummaryRequest) => Promise<EngineSummaryView>
  /** The topic folders, for the `folder=` filter. Absent: no folder filter. */
  'topics:folders'?: (request: TopicProjectRequest) => Promise<TopicFolderList>
}

export function createQuestionsSource(): QuestionsSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'questions:list': async (request) => requireApi()['questions:list'](request),
    'questions:update': async (request) => requireApi()['questions:update'](request),
    'checks:start': async (request) => requireApi()['checks:start'](request),
    'status:getCapsule': async () => requireApi()['status:getCapsule'](),
    'topics:list': async (request) => requireApi()['topics:list'](request),
    'topics:moveQuestions': async (request) => requireApi()['topics:moveQuestions'](request),
    'topics:setQuestionStage': async (request) => requireApi()['topics:setQuestionStage'](request),
    'topics:setTarget': async (request) => requireApi()['topics:setTarget'](request),
    'topics:pageCandidates': async (request) => requireApi()['topics:pageCandidates'](request),
    'topics:sortQuestions': async (request) => requireApi()['topics:sortQuestions'](request),
    'topics:describeStep': async (request) => requireApi()['topics:describeStep'](request),
    'engines:summary': async (request) => requireApi()['engines:summary'](request),
    'topics:folders': async (request) => requireApi()['topics:folders'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
