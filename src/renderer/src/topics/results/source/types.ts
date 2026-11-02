import type { TopicSummary } from '@shared/domain'
import type {
  MatchTrackedTopicRequest,
  MatchTrackedTopicResult,
  CheckProgress,
  DraftFixResult,
  EngineSummaryRequest,
  EngineSummaryView,
  ExplainCitationRequest,
  ExplainCitationResult,
  SetTopicTargetRequest,
  SetTopicTargetResult,
  SuggestTopicTargetResult,
  TopicDescribeStepRequest,
  TopicPageCandidates,
  TopicPromptRequest,
  TopicResults,
  TopicResultsRequest,
  TopicStepDescription,
  TopicTargetRequest,
  TopicTargetSuggestions,
  TopicSummaryRequest,
  TopicSummaryResult,
  UpdateTopicRequest,
  WhyNotCitedResult
} from '@shared/ipc'

/** The `topics` channels the results screens call (src/shared/ipc/topics.ts). */
export interface TopicResultsSource {
  results(request: TopicResultsRequest): Promise<TopicResults>
  list(projectId: string): Promise<readonly TopicSummary[]>
  pageCandidates(projectId: string): Promise<TopicPageCandidates>
  /** Own pages ranked by how the topic's checks cite them. Free; reads saved checks. */
  targetSuggestions(request: TopicTargetRequest): Promise<TopicTargetSuggestions>
  /** CiteFox AI picks the target page from the project's pages. Spends no search. */
  suggestTarget(request: TopicTargetRequest): Promise<SuggestTopicTargetResult>
  /** CiteFox AI picks each question's best page with a fit %; absent in mocks. */
  matchTracked?(request: MatchTrackedTopicRequest): Promise<MatchTrackedTopicResult>
  setTarget(request: SetTopicTargetRequest): Promise<SetTopicTargetResult>
  /** Reads the site's sitemap into the page list (free, no search); absent in mocks. */
  readSitemap?(projectId: string): Promise<{ pageCount: number }>
  whyNotCited(request: TopicPromptRequest): Promise<WhyNotCitedResult>
  draftFix(request: TopicPromptRequest): Promise<DraftFixResult>
  explainCitation(request: ExplainCitationRequest): Promise<ExplainCitationResult>
  topicSummary(request: TopicSummaryRequest): Promise<TopicSummaryResult>
  describeStep(request: TopicDescribeStepRequest): Promise<TopicStepDescription>
  /** Name, bands, interval or status. */
  update(request: UpdateTopicRequest): Promise<TopicSummary>
  /** `engines:summary`: the engines this topic offers for the engine filter. Absent: Google only. */
  engineSummary?(request: EngineSummaryRequest): Promise<EngineSummaryView>
  /** `checks:progress`, for the questions a running check is on. Optional: mocks have none. */
  onCheckProgress?(listener: (event: CheckProgress) => void): () => void
}
