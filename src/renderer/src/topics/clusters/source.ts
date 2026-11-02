import type { TopicSummary } from '@shared/domain'
import type {
  CreatedTopicResult,
  CreateEmptyTopicRequest,
  CreateTopicFolderRequest,
  CreateFromDraftRequest,
  CreateFromDraftResult,
  CreateTopicsRequest,
  CreateTopicsResult,
  DeleteTopicFolderRequest,
  DuplicateTopicRequest,
  EngineSummaryRequest,
  EngineSummaryView,
  MergeTopicRequest,
  MoveQuestionsRequest,
  MoveQuestionsResult,
  MoveTopicsToFolderRequest,
  QuestionsList,
  QuestionsListRequest,
  QuestionsUpdateRequest,
  QuestionsUpdateResult,
  RenameTopicFolderRequest,
  SetQuestionStageRequest,
  SetQuestionStageResult,
  SetTopicTargetRequest,
  SetTopicTargetResult,
  SortQuestionsRequest,
  SortQuestionsResult,
  SplitTopicRequest,
  SplitTopicResult,
  SuggestTopicNameRequest,
  SuggestTopicNameResult,
  SuggestTopicsRequest,
  SuggestTopicsResult,
  TopicDescribeStepRequest,
  TopicFolderList,
  TopicPageCandidates,
  TopicProjectRequest,
  TopicStepDescription,
  UpdateTopicRequest
} from '@shared/ipc'

/**
 * The channels the Topics screen, the Questions grouping and the New topic dialog
 * share (Docs/TOPICS-SPEC.md §8): the question list, the topics, the moves and the
 * Claude suggestions. Production uses the preload allow-list; tests pass another
 * `ClustersSource`.
 */
export interface ClustersSource {
  'questions:list'(request: QuestionsListRequest): Promise<QuestionsList>
  'questions:update'(request: QuestionsUpdateRequest): Promise<QuestionsUpdateResult>
  'topics:list'(request: TopicProjectRequest): Promise<{ topics: readonly TopicSummary[] }>
  'topics:update'(request: UpdateTopicRequest): Promise<TopicSummary>
  'topics:setTarget'(request: SetTopicTargetRequest): Promise<SetTopicTargetResult>
  'topics:pageCandidates'(request: TopicProjectRequest): Promise<TopicPageCandidates>
  'topics:describeStep'(request: TopicDescribeStepRequest): Promise<TopicStepDescription>
  'topics:moveQuestions'(request: MoveQuestionsRequest): Promise<MoveQuestionsResult>
  'topics:setQuestionStage'(request: SetQuestionStageRequest): Promise<SetQuestionStageResult>
  'topics:merge'(request: MergeTopicRequest): Promise<MoveQuestionsResult>
  'topics:split'(request: SplitTopicRequest): Promise<SplitTopicResult>
  'topics:createTopics'(request: CreateTopicsRequest): Promise<CreateTopicsResult>
  'topics:createFromDraft'(request: CreateFromDraftRequest): Promise<CreateFromDraftResult>
  'topics:suggestTopics'(request: SuggestTopicsRequest): Promise<SuggestTopicsResult>
  'topics:sortQuestions'(request: SortQuestionsRequest): Promise<SortQuestionsResult>
  'topics:suggestName'(request: SuggestTopicNameRequest): Promise<SuggestTopicNameResult>
  'topics:createEmpty'(request: CreateEmptyTopicRequest): Promise<CreatedTopicResult>
  'topics:duplicate'(request: DuplicateTopicRequest): Promise<CreatedTopicResult>
  'topics:folders'(request: TopicProjectRequest): Promise<TopicFolderList>
  'topics:createFolder'(request: CreateTopicFolderRequest): Promise<TopicFolderList>
  'topics:renameFolder'(request: RenameTopicFolderRequest): Promise<TopicFolderList>
  'topics:deleteFolder'(request: DeleteTopicFolderRequest): Promise<TopicFolderList>
  'topics:moveToFolder'(request: MoveTopicsToFolderRequest): Promise<TopicFolderList>
  /** Each engine's statuses, for the Topics engine filter (audit #4). Absent: Google only. */
  'engines:summary'?: (request: EngineSummaryRequest) => Promise<EngineSummaryView>
}

export const CLUSTER_CHANNELS = [
  'questions:list',
  'questions:update',
  'topics:list',
  'topics:update',
  'topics:setTarget',
  'topics:pageCandidates',
  'topics:describeStep',
  'topics:moveQuestions',
  'topics:setQuestionStage',
  'topics:merge',
  'topics:split',
  'topics:createTopics',
  'topics:createFromDraft',
  'topics:suggestTopics',
  'topics:sortQuestions',
  'topics:suggestName',
  'topics:createEmpty',
  'topics:duplicate',
  'topics:folders',
  'topics:createFolder',
  'topics:renameFolder',
  'topics:deleteFolder',
  'topics:moveToFolder',
  'engines:summary'
] as const satisfies readonly (keyof ClustersSource)[]

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** The live channels. Each is async so a missing bridge rejects instead of throwing in render. */
export function createClustersSource(): ClustersSource {
  const entries = CLUSTER_CHANNELS.map((channel) => [
    channel,
    async (request: unknown) =>
      (requireApi()[channel] as (value: unknown) => Promise<unknown>)(request)
  ])
  return Object.fromEntries(entries) as unknown as ClustersSource
}
