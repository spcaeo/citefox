import type {
  PageResults,
  PromptCheckDetail,
  PromptCheckStatus,
  ResultsHistory
} from '@shared/domain'
import type { PageDetail, PromptVersions } from '@shared/ipc'

/** Everything the screen needs for one prompt in one market. */
export interface PromptDetailData {
  page: PageDetail
  /** `results:get` for the same market and latest run. Prompt order and brand come from here. */
  results: PageResults
  detail: PromptCheckDetail
  history: ResultsHistory | null
  /** The prompt's saved versions (`prompts:versions`). Null when they could not be read. */
  versions: PromptVersions | null
}

/** One row of "This prompt over time" (FR-13.4). */
export interface PromptTimeRow {
  runId: string
  finishedAt: string
  /** Null when the prompt was not in that check. */
  status: PromptCheckStatus | null
  position: number | null
  partial: boolean
  /** True for the first check in the list. */
  first: boolean
  contentChanged: boolean
  /** The prompt as it was in that check (an earlier version's id), for the link. */
  promptId: string | null
  /** The wording that check asked when it was not the current wording. */
  earlierWording: string | null
  /**
   * Your pages Google cited in that check, best position first, across its samples.
   * `target`: one of the question's pages (Primary or Also OK). Absent in old fixtures.
   */
  ownPages?: readonly { url: string; position: number; target: boolean }[]
}

/** A source line in "Sources Google listed" (FR-13.2). */
export type SourceKind = 'this_page' | 'own' | 'competitor' | 'other'

/** The per-prompt citation counts line under the sources. Links, not prompts. */
export interface CitationCounts {
  thisPage: number
  otherOwn: number
  named: boolean | null
}

/** Previous and next prompt in the latest check's prompt order (FR-13.1). */
export interface PromptNeighbours {
  index: number
  total: number
  previousId: string | null
  nextId: string | null
}
