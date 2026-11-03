import type { TopicDraft, TopicSummary } from '../../domain'
import type {
  SuggestTopicTargetResult,
  TopicTargetRequest,
  TopicTargetSuggestions
} from '../topicTargets'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from '../contract'
import type {
  TopicDescribeStepRequest,
  TopicDraftRequest,
  TopicProgress,
  TopicProjectRequest,
  TopicStepDescription,
  TopicSuggestedStartResult
} from './types'
import type { CreateTopicDraftRequest, TopicDraftList, UpdateTopicDraftRequest } from './draft'
import type {
  CsvColumnsResult,
  DiscoverProfileSectionRequest,
  DiscoverSeedResult,
  DiscoverStageQuestionsRequest,
  DiscoverTermsResult,
  GenerateTopicKeywordsRequest,
  GenerateTopicKeywordsResult,
  GenerateTopicQuestionsRequest,
  ImportTopicQuestionsRequest,
  ImportTopicQuestionsResult,
  JourneyGapsResult,
  MergeNearDuplicatesRequest,
  MergeNearDuplicatesResult,
  MissingGroupsResult,
  QuestionCleanupResult,
  ReadCsvColumnsRequest,
  RewriteTopicQuestionRequest,
  RewriteTopicSectionRequest,
  TopicKeywordSummary,
  TopicProfileSuggestions,
  TopicPromptSuggestions,
  WriteTopicProfileRequest
} from './steps'
import type {
  CompetitorQuestionsRequest,
  CompetitorQuestionsResult,
  DraftPageBriefRequest,
  MatchTopicPagesRequest,
  MatchTopicPagesResult,
  MatchTrackedTopicRequest,
  MatchTrackedTopicResult,
  ReadCompetitorPageRequest,
  ReadCompetitorPageResult,
  SetTopicTargetRequest,
  SetTopicTargetResult,
  StartTopicRequest,
  StartTopicResult,
  TopicEstimate,
  TopicEstimateRequest,
  TopicPageBrief,
  TopicPageCandidates
} from './pages'
import type {
  DraftFixResult,
  ExplainCitationRequest,
  ExplainCitationResult,
  TopicList,
  TopicPromptRequest,
  TopicResults,
  TopicResultsRequest,
  TopicSummaryRequest,
  TopicSummaryResult,
  UpdateTopicRequest,
  WhyNotCitedResult
} from './results'

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Invoke channels for this area. Each one is declared here only. */
export const topicsChannels = {
  // Topics and drafts
  'topics:list': invokeWith<TopicProjectRequest, TopicList>(),
  'topics:update': invokeWith<UpdateTopicRequest, TopicSummary>(),
  'topics:describeStep': invokeWith<TopicDescribeStepRequest, TopicStepDescription>(),
  'topics:suggestedStart': invokeWith<TopicProjectRequest, TopicSuggestedStartResult>(),
  'topics:listDrafts': invokeWith<TopicProjectRequest, TopicDraftList>(),
  'topics:createDraft': invokeWith<CreateTopicDraftRequest, TopicDraft>(),
  'topics:getDraft': invokeWith<TopicDraftRequest, TopicDraft>(),
  'topics:updateDraft': invokeWith<UpdateTopicDraftRequest, TopicDraft>(),
  'topics:discardDraft': invokeWith<TopicDraftRequest, TopicDraftList>(),
  // Seed and profile
  'topics:discoverSeed': invokeWith<TopicDraftRequest, DiscoverSeedResult>(),
  'topics:writeProfile': invokeWith<WriteTopicProfileRequest, TopicDraft>(),
  'topics:discoverProfileSection': invokeWith<
    DiscoverProfileSectionRequest,
    TopicProfileSuggestions
  >(),
  'topics:rewriteSection': invokeWith<RewriteTopicSectionRequest, TopicProfileSuggestions>(),
  // Questions
  'topics:generateQuestions': invokeWith<GenerateTopicQuestionsRequest, TopicDraft>(),
  'topics:discoverStageQuestions': invokeWith<
    DiscoverStageQuestionsRequest,
    TopicPromptSuggestions
  >(),
  'topics:findJourneyGaps': invokeWith<TopicDraftRequest, JourneyGapsResult>(),
  'topics:rewriteQuestion': invokeWith<RewriteTopicQuestionRequest, TopicPromptSuggestions>(),
  // Keywords
  'topics:discoverTerms': invokeWith<TopicDraftRequest, DiscoverTermsResult>(),
  'topics:generateKeywords': invokeWith<
    GenerateTopicKeywordsRequest,
    GenerateTopicKeywordsResult
  >(),
  'topics:suggestMissingGroups': invokeWith<TopicDraftRequest, MissingGroupsResult>(),
  'topics:mergeNearDuplicates': invokeWith<MergeNearDuplicatesRequest, MergeNearDuplicatesResult>(),
  'topics:keywordSummary': invokeWith<TopicDraftRequest, TopicKeywordSummary>(),
  // My own questions
  'topics:readCsvColumns': invokeWith<ReadCsvColumnsRequest, CsvColumnsResult>(),
  'topics:importQuestions': invokeWith<ImportTopicQuestionsRequest, ImportTopicQuestionsResult>(),
  'topics:cleanupWithClaude': invokeWith<TopicDraftRequest, QuestionCleanupResult>(),
  // Competitor page
  'topics:readCompetitorPage': invokeWith<ReadCompetitorPageRequest, ReadCompetitorPageResult>(),
  'topics:competitorQuestions': invokeWith<CompetitorQuestionsRequest, CompetitorQuestionsResult>(),
  // Pages
  'topics:pageCandidates': invokeWith<TopicProjectRequest, TopicPageCandidates>(),
  'topics:matchPages': invokeWith<MatchTopicPagesRequest, MatchTopicPagesResult>(),
  'topics:setTarget': invokeWith<SetTopicTargetRequest, SetTopicTargetResult>(),
  'topics:draftPageBrief': invokeWith<DraftPageBriefRequest, TopicPageBrief>(),
  'topics:targetSuggestions': invokeWith<TopicTargetRequest, TopicTargetSuggestions>(),
  'topics:suggestTarget': invokeWith<TopicTargetRequest, SuggestTopicTargetResult>(),
  'topics:matchTracked': invokeWith<MatchTrackedTopicRequest, MatchTrackedTopicResult>(),
  // Estimate and start
  'topics:estimate': invokeWith<TopicEstimateRequest, TopicEstimate>(),
  'topics:start': invokeWith<StartTopicRequest, StartTopicResult>(),
  // Results
  'topics:results': invokeWith<TopicResultsRequest, TopicResults>(),
  'topics:whyNotCited': invokeWith<TopicPromptRequest, WhyNotCitedResult>(),
  'topics:explainCitation': invokeWith<ExplainCitationRequest, ExplainCitationResult>(),
  'topics:draftFix': invokeWith<TopicPromptRequest, DraftFixResult>(),
  'topics:topicSummary': invokeWith<TopicSummaryRequest, TopicSummaryResult>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const topicsEvents = {
  'topics:progress': push<TopicProgress>()
} as const satisfies PushChannelSpecs
