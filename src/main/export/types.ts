import type { SortableSiteKind } from '@shared/report/site-kinds'
import type { StoredAnswerShape } from '../analytics/answer-shape/vocabulary'
import type { ReportMarketFacts } from './model/input'
import type { TemplateUse } from './model/types'
import type {
  AioGapFact,
  AioReference,
  CompetitorLeaderboardRow,
  CoverageMatrix,
  ExportCheckSet,
  ExportScope,
  FunnelStep,
  MarketCheckMetrics,
  OpportunityBucket,
  PromptCheckRow,
  TopAction
} from '@shared/domain'

/**
 * One stored check the export can place on a sheet.
 * Raw SerpApi JSON is not a field here (FR-22.3, NFR-5). AIO text is the stored quote (FR-22.7).
 */
export interface ExportCheck {
  /** ISO-8601 UTC. */
  finishedAt: string
  /**
   * Baseline, previous, or current when the source knows (FR-12.12).
   * Null lets the generator derive the trio from check order.
   */
  role: 'baseline' | 'previous' | 'current' | null
  metrics: MarketCheckMetrics
  prompts: readonly PromptCheckRow[]
  /** Full stored overview text and references, keyed by prompt id. */
  details: readonly ExportPromptDetail[]
  funnel: readonly FunnelStep[]
  buckets: readonly OpportunityBucket[]
  topActions: readonly TopAction[]
  leaderboard: readonly CompetitorLeaderboardRow[]
  cannibalizing: readonly CannibalizingPageRef[]
  /**
   * Stored SerpApi responses, one per sample. Only a JSON export with the raw
   * section asks for these (`ExportLoadQuery.includeRaw`, FR-22.3). Absent otherwise.
   */
  raw?: readonly ExportRawSample[]
}

/** One sample's stored SerpApi JSON, exactly as saved. Secrets are removed when written. */
export interface ExportRawSample {
  promptId: string
  sampleNo: number
  searchJson: string | null
  aioJson: string | null
}

export interface ExportPromptDetail {
  promptId: string
  /** Stored overview text. Null when that prompt had no overview. */
  aioText: string | null
  references: readonly AioReference[]
  aioGap: readonly AioGapFact[]
}

/** An own-domain URL cited instead of the target page (FR-12.13). */
export interface CannibalizingPageRef {
  url: string
  tracked: boolean
  promptIds: readonly string[]
}

/**
 * Brand-sentiment row. Shared has no sentiment type yet.
 * `stance` is the source's word (positive, negative, mixed, neutral).
 */
export interface ExportSentimentRow {
  marketId: string
  theme: string
  claim: string
  stance: string
  source: string
  factualProblem: string | null
}

/** A history note (FR-15). Shared has no note type yet. */
export interface ExportNote {
  /** ISO-8601 UTC. */
  at: string
  text: string
}

/** A logged fix (FR-14.5). Status is `planned` or `completed`. */
export interface ExportFix {
  /** Fix N on its page. */
  number: number
  /** ISO-8601 UTC go-live. */
  goLiveAt: string
  description: string
  status: string
  /** Prompts the fix targets. Empty means every prompt on the page. */
  promptIds: readonly string[]
  /** Markets the fix targets. Empty means every market. */
  marketIds: readonly string[]
  /** Stored verdict sentence, when a follow-up wrote one. */
  verdict: string | null
}

export interface ExportMarketSlice {
  marketId: string
  /** Short code such as `us-en`. This is the market column. */
  code: string
  checks: readonly ExportCheck[]
}

export interface ExportPage {
  pageId: string
  /** Empty for a topic, which has no URL (`kind: 'topic'`). */
  url: string
  /** Set only for a topic subject (Docs/TOPICS-SPEC.md section 2). Absent for a page. */
  kind?: 'topic'
  title: string | null
  /** Filename token for a single-page export. */
  slug: string
  metaDescription: string | null
  h1: string | null
  /** ISO-8601 UTC snapshot time. Null before the first read. */
  snapshotAt: string | null
  /** Last-modified date the page states, ISO-8601. Null when it states none. */
  modifiedAt: string | null
  promptSetVersion: number | null
  /** True when the latest check is older than the staleness window (FR-12.2). */
  stale: boolean
  markets: readonly ExportMarketSlice[]
  gaps: CoverageMatrix | null
  sentiment: readonly ExportSentimentRow[]
  notes: readonly ExportNote[]
  fixes: readonly ExportFix[]
}

export interface ExportView {
  id: string
  slug: string
  pageIds: readonly string[]
}

/**
 * Everything the export generators render for one project.
 * The source applies no section filter. The generator applies scope, markets, and checks.
 */
export interface ExportDataset {
  projectName: string
  projectSlug: string
  /** FR-10.7. Null when the project is not a client project. */
  clientName: string | null
  views: readonly ExportView[]
  pages: readonly ExportPage[]
  /** Report facts (Docs/REPORT-SPEC.md). */
  report: ExportReportFacts
}

/** Project facts the report model needs beyond the pages. */
export interface ExportReportFacts {
  /** Bare own domain. */
  domain: string
  brandNames: readonly string[]
  competitors: readonly string[]
  includeSubdomains: boolean
  /** CSS colour. Null uses the CiteFox accent. */
  brandColor: string | null
  /** Every market in the project. */
  markets: readonly ReportMarketFacts[]
  /** Template versions behind the data, for the cover. */
  templates: readonly TemplateUse[]
  /** Stored answer-shape classifications for the overviews in the dataset. */
  answerShapes: readonly StoredAnswerShape[]
  /**
   * Kinds Claude gave the cited domains (project migration 037), by bare domain. Absent or
   * missing a domain: the built-in list decides, else `other`.
   */
  siteKinds?: Readonly<Record<string, SortableSiteKind>>
}

export interface ExportLoadQuery {
  projectId: string
  scope: ExportScope
  pageIds: readonly string[]
  viewId: string | null
  marketIds: readonly string[]
  checks: ExportCheckSet
  from: string | null
  to: string | null
  /** IANA zone for `from` and `to` day boundaries. */
  timeZone: string
  /** True only for a JSON export with the raw section. Fills `ExportCheck.raw`. */
  includeRaw?: boolean
}

/**
 * Read the rows an export renders.
 *
 * `source.ts` reads stored checks through `listStoredCheckRuns`, `listStoredSerpResults`,
 * and `listStoredAioReferences`, plus the page, market, snapshot, coverage, and fix reads.
 * Sentiment rows, history notes, and saved views are not stored yet, so those lists stay empty.
 * A fixture implementation is in `fixture.ts`.
 */
export interface ExportDataSource {
  loadExportDataset(query: ExportLoadQuery): Promise<ExportDataset>
}
