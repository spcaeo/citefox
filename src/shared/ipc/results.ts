/** Results, history, and scores. */

import type { PageResults, PageScoreList, ProjectScoreList, ResultsHistory } from '../domain'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/** `results:get`. Null `marketId` is the page's default market (FR-9.8, FR-20.7). */
export interface GetResultsRequest {
  projectId: string
  pageId: string
  marketId: string | null
  /** Null is the latest finished run in that market. A running run id returns finished prompts only. */
  runId: string | null
}

/** `results:history`. Null `marketId` is the page's default market. */
export interface ResultsHistoryRequest {
  projectId: string
  pageId: string
  marketId: string | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const resultsChannels = {
  'results:get': invokeWith<GetResultsRequest, PageResults>(),
  'results:history': invokeWith<ResultsHistoryRequest, ResultsHistory>(),
  'scores:listProjects': invoke<ProjectScoreList>(),
  'scores:listPages': invokeWith<ProjectIdRequest, PageScoreList>()
} as const satisfies InvokeChannelSpecs
