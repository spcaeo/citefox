import type {
  CitationClass,
  CitationSourceType,
  CoverageAction,
  CoverageFindingKind,
  CoverageLevel,
  IntentStage,
  PromptCheckStatus,
  PromptSource,
  ReportSectionId
} from '@shared/domain'
import type { SiteKind } from '@shared/report/site-kinds'
import type { AnswerShapeCode, AnswerShapeGroup } from '../../analytics/answer-shape/vocabulary'
import type {
  MethodSection,
  RecommendationModel,
  VerdictModel,
  WhatChangedSection
} from './perspective-types'
import type { TopicCoverageSection } from './topic-types'

export type * from './perspective-types'
export type * from './topic-types'

/**
 * The report model (Docs/REPORT-SPEC.md). Every output — the HTML report, the PDF, the
 * XLSX and CSV tables, the JSON v2 `report` object and the scheduled email body — is
 * rendered from this one object, never from the database, so every output agrees.
 *
 * Counting rules (SRS section 7.4): one row is one prompt in one market on one tracked
 * page, taken from that page and market's latest full (not partial) check in the data
 * window. "No AIO" and error rows are excluded from rates. Own pages and competitors are
 * never mixed.
 *
 * Drill rule (NFR-14): every clickable number is a {@link Count}. `drill` names a list
 * in {@link ReportModel.drills}, and that list's length is always `n`.
 */

export const REPORT_MODEL_VERSION = 2

/** A number and the rows behind it. `drill` is null for a number that is not about prompts. */
export interface Count {
  n: number
  /** Key into {@link ReportModel.drills}. `drills[drill].length === n`. */
  drill: string | null
}

/** A whole percentage 0–100. Null when the denominator is 0. */
export type Pct = number | null

/** Shown in place of a section that has no data yet. */
export interface EmptyState {
  title: string
  message: string
  /** What fills it, such as "Run a check with brand sentiment on". Null when nothing can. */
  nextStep: string | null
}

export interface ReportMarket {
  id: string
  /** `US-EN`. Used in drill tokens and CSV. */
  code: string
  /** `US · EN`. */
  label: string
  /** Regional-indicator flag such as 🇺🇸, or an empty string when the country is not 2 letters. */
  flag: string
}

/** `tracked` is a page CiteFox tracks; `other_own` is an own-domain page that is cited but not tracked. */
export type ReportPageRole = 'tracked' | 'other_own'

export interface ReportPage {
  id: string
  url: string
  /** Path and query, `/blog/x`. `/` for the home page. */
  path: string
  title: string | null
  role: ReportPageRole
}

/** One prompt in one market on one tracked page, from the latest full check. */
export interface ReportRow {
  /** `r1`, `r2`, … Stable within one report. */
  id: string
  promptId: string
  pageId: string
  marketId: string
  runId: string
  /** 1-based number of the prompt in its prompt set. */
  number: number
  label: string
  text: string
  stage: IntentStage
  funnel: FunnelStage | null
  source: PromptSource
  status: PromptCheckStatus
  /** The latest full check found an AI Overview. */
  aio: boolean
  /** The overview links any own-domain page. */
  cited: boolean
  /** The overview links the tracked page. */
  pageCited: boolean
  /** The brand or an alias appears in the overview text. */
  named: boolean
  /** Own domain cited but not the tracked page. */
  wrongPage: boolean
  /** AIO shown, not cited and not named. */
  notVisible: boolean
  /** Own URL that made the status `page_cited` or `other_own_page`. */
  citedUrl: string | null
  /** Mean citation position of the status that won. 1-based. */
  position: number | null
  /** First distinct cited domains, in citation order, at most 3. */
  topDomains: readonly string[]
  /** ISO-8601 UTC. */
  checkedAt: string | null
  /** Overview text, trimmed to 600 characters. Null when there was no overview. */
  aioExcerpt: string | null
}

export type FunnelStage = 'TOFU' | 'MOFU' | 'BOFU'

/** One cited reference on a row's winning sample. Raw references sheet and sources section. */
export interface ReportReference {
  rowId: string
  position: number
  url: string
  normalizedUrl: string
  domain: string
  title: string | null
  classification: CitationClass
  /** Own-domain URL that is not a tracked page (FR-20.5). */
  untracked: boolean
  sourceType: CitationSourceType
}

export interface TemplateUse {
  kind: string
  name: string
  /** SHA-256 of the body. Renderers show the first 8 characters. */
  hash: string
}

/** Section 1. */
export interface ReportCover {
  title: string
  domain: string
  projectName: string
  clientName: string | null
  scope: 'page' | 'project'
  /** "Page · /blog/how-to-set-up-text-alerts" or "Project · 4 tracked pages". */
  scopeLabel: string
  /** File-name slug for the scope, such as `how-to-set-up-text-alerts` or `all-pages`. */
  scopeSlug: string
  /** ISO-8601 UTC. */
  builtAt: string
  /** First and last finished check in the data window. ISO-8601 UTC. */
  windowFrom: string | null
  windowTo: string | null
  timeZone: string
  promptsTracked: number
  brands: readonly string[]
  competitors: readonly string[]
  trackedPages: number
  templates: readonly TemplateUse[]
  /** CSS colour, `#C2410C` by default. */
  brandColor: string
}

export interface FunnelStepModel {
  id: 'tracked' | 'aio' | 'cited' | 'page_cited' | 'named'
  label: string
  count: Count
  /** Why prompts drop out before this step. Null on the first step. */
  dropReason: string | null
}

export interface OpportunityBar {
  key: string
  label: string
  /** AIO rows in this group. */
  total: Count
  notVisible: Count
  namedOnly: Count
  citedOnly: Count
  winning: Count
}

export interface TopActionModel {
  rank: number
  text: string
  reason: string
  rowId: string
}

/** Section 2. */
export interface OverviewSection {
  headline: string
  tracked: Count
  aio: Count
  /** AIO ÷ all tracked prompts, failed searches included (SRS section 7.2, as in the app). */
  aioPct: Pct
  /** Prompts whose latest search failed: in `tracked`, outside every rate's numerator. */
  failed: Count
  cited: Count
  /** Cited ÷ AIO. */
  citedPct: Pct
  pageCited: Count
  named: Count
  winning: Count
  notVisible: Count
  wrongPage: Count
  /** SRS section 7.2 over the rows in scope. */
  score: number | null
  /** Score minus the previous full check's score for the same pages and markets. */
  scoreChange: number | null
  previousCheckAt: string | null
  funnel: readonly FunnelStepModel[]
  opportunityByStage: readonly OpportunityBar[]
  /** Empty in page scope. */
  opportunityByPage: readonly OpportunityBar[]
  coverageLine: string
  measured: number
  topActions: readonly TopActionModel[]
}

export interface TrackedPageRow {
  pageId: string
  url: string
  path: string
  title: string | null
  score: number | null
  prompts: Count
  aio: Count
  pageCited: Count
  ownCited: Count
  named: Count
  /** Links, not prompts (FR-6.7). */
  citationsTarget: number
  citationsOtherOwn: number
  lastChecked: string | null
}

export interface OwnPageBar {
  url: string
  path: string
  tracked: boolean
  prompts: Count
  citations: number
}

export interface OtherOwnPage {
  url: string
  path: string
  prompts: Count
  citations: number
  /** Login, legal, cart and similar pages that are rarely worth tracking. */
  likelyNoise: boolean
}

export interface WrongPageItem {
  rowId: string
  prompt: string
  citedUrl: string
  trackedUrl: string
  marketId: string
}

/** Section 3. */
export interface PagesSection {
  empty: EmptyState | null
  pagesTracked: number
  pagesCited: number
  pagesNeverCited: number
  otherOwnCited: number
  mostCited: readonly OwnPageBar[]
  tracked: readonly TrackedPageRow[]
  otherOwn: readonly OtherOwnPage[]
  wrongPage: readonly WrongPageItem[]
}

export type DomainWho = 'you' | 'competitor' | 'observed'

export interface LeaderboardRow {
  domain: string
  who: DomainWho
  /** Kind of site. Null on your row. */
  kind: SiteKind | null
  prompts: Count
  /** Prompts that cite this domain and you. Null on your row. */
  overlap: Count | null
  /** Prompts that cite this domain and not you. Null on your row. */
  gap: Count | null
  avgPosition: number | null
  /** 0–100. `round(100 × (0.5·reach + 0.3·prominence + 0.2·marketCoverage))`. */
  authority: number
  reach: number
  prominence: number
  marketCoverage: number
}

/** Section 4. */
export interface CompetitionSection {
  empty: EmptyState | null
  domainsCited: number
  reach: Count
  reachPct: Pct
  rival: { domain: string; prompts: Count } | null
  /** Rival prompts minus your prompts. Null when there is no rival. */
  rivalLead: number | null
  gapPrompts: Count
  sov: {
    total: Count
    you: Count
    competitor: Count
    others: Count
    /** AIO with no cited source at all. */
    none: Count
  }
  mostCited: readonly {
    domain: string
    who: DomainWho
    prompts: Count
    /** Prompts citing the domain in the previous full checks. Null without one. */
    before: number | null
  }[]
  leaderboard: readonly LeaderboardRow[]
  /** Other sites by kind, citations in the previous and the latest full checks. */
  byKind: readonly SiteKindRow[]
  authorityNote: string
}

/** "Who else the AI answers cite", one kind of site. Citations are links, not prompts. */
export interface SiteKindRow {
  kind: SiteKind
  label: string
  /** Sites of this kind cited in either check. */
  sites: number
  /** Citations in the previous full checks. Null without one. */
  before: number | null
  now: number
  /** `now − before`. Null without a previous full check. */
  change: number | null
  /** Prompts whose latest overview cites a site of this kind. */
  prompts: Count
}

export type SentimentTone = 'positive' | 'neutral' | 'negative'

/** Section 5. Built by the brand-sentiment builder; empty until it runs. */
export interface ReputationSection {
  empty: EmptyState | null
  positive: Count
  neutral: Count
  negative: Count
  /** Analysed answers that name the brand. */
  analysed: number
  /** `(pos − neg) ÷ all × 100`, null below 5 claims ("Not enough data"). */
  net: number | null
  trend: readonly { at: string; positive: number; neutral: number; negative: number }[]
  issues: readonly {
    /** Null for an answer to a brand prompt, which has no report row. */
    rowId: string | null
    prompt: string
    claim: string
    whyWrong: string
    correction: string
    sourceToFix: string | null
  }[]
  answers: readonly {
    /** Null for an answer to a brand prompt, which has no report row. */
    rowId: string | null
    prompt: string
    tone: SentimentTone
    theme: string
    /** "#1 of 3 brands named". */
    rank: string | null
    why: string
  }[]
}

export interface TrendPointModel {
  /** ISO-8601 UTC. The chart spaces points by this instant. */
  at: string
  checked: number
  aio: number
  ownCited: number
  pageCited: number
  named: number
  score: number | null
  /** Drawn hollow and kept out of the line. */
  partial: boolean
}

export interface DeltaItem {
  rowId: string
  prompt: string
  pagePath: string
  marketId: string
  before: string
  after: string
}

export interface DeltaList {
  count: Count
  items: readonly DeltaItem[]
}

export type FixVerdictKind = 'worked' | 'partly' | 'no_change' | 'pending'

export interface FixVerdictModel {
  number: number
  pageId: string
  description: string
  /** ISO-8601 UTC. */
  goLiveAt: string
  verdict: FixVerdictKind
  /** "Partly worked · 1 of 3 prompts". */
  label: string
  prompts: Count
}

/** Section 6. */
export interface TrendsSection {
  empty: EmptyState | null
  series: readonly TrendPointModel[]
  fixes: readonly { number: number; at: string; description: string; pageId: string }[]
  previousAt: string | null
  currentAt: string | null
  gained: DeltaList
  lost: DeltaList
  newlyNamed: DeltaList
  noLongerNamed: DeltaList
  verdicts: readonly FixVerdictModel[]
}

export interface UniverseRow {
  key: string
  label: string
  prompts: Count
  aio: Count
  cited: Count
  named: Count
  /** Cited ÷ AIO. */
  citedRate: Pct
}

export interface UniverseDimension {
  id: 'stage' | 'funnel' | 'source' | 'page' | 'group' | 'market'
  title: string
  rows: readonly UniverseRow[]
}

/** Section 7. */
export interface UniverseSection {
  empty: EmptyState | null
  segments: number
  largest: { label: string; prompts: number } | null
  best: { label: string; rate: number } | null
  weakest: { label: string; rate: number } | null
  dimensions: readonly UniverseDimension[]
}

export interface PlatformRow {
  type: CitationSourceType
  label: string
  pages: number
  citations: number
  share: Pct
  prompts: Count
}

export interface YoutubeVideo {
  videoId: string
  url: string
  title: string | null
  /** Null without the user's YouTube Data API key (shown as "—"). */
  channel: string | null
  views: number | null
  publishedAt: string | null
  prompts: Count
  citations: number
  gap: Count
}

export type RedditReplyStatus = 'open' | 'archived' | 'locked' | 'unchecked'

export interface RedditThread {
  url: string
  title: string | null
  subreddit: string
  replyStatus: RedditReplyStatus
  upvotes: number | null
  comments: number | null
  prompts: Count
  citations: number
}

export interface InfluentialPage {
  url: string
  domain: string
  who: DomainWho
  title: string | null
  prompts: Count
  citations: number
  gap: Count
}

/** Section 8. Citations, not prompts: one answer cites many pages. */
export interface SourcesSection {
  empty: EmptyState | null
  note: string
  total: number
  yours: number
  yoursPct: Pct
  competitor: number
  external: number
  /** Citations on answers where your domain is absent. */
  gapsToWin: number
  platforms: readonly PlatformRow[]
  youtube: {
    videos: readonly YoutubeVideo[]
    channels: readonly { channel: string; videos: number; prompts: Count; citations: number }[]
    /** True when channel, views and dates need the YouTube Data API key. */
    detailsMissing: boolean
  }
  reddit: {
    threads: readonly RedditThread[]
    subreddits: readonly { name: string; threads: number; prompts: Count; citations: number }[]
    /** "Nothing to reply to here" style sentence. */
    sentence: string
  }
  linkedin: readonly {
    url: string
    title: string | null
    kind: 'post' | 'article' | 'other'
    prompts: Count
    citations: number
  }[]
  influential: readonly InfluentialPage[]
}

export interface ShapeJourney {
  /** `A1 → C4 → D2`. */
  fingerprint: string
  codes: readonly AnswerShapeCode[]
  prompts: Count
}

/** Section 9. */
export interface AnswerShapeSection {
  empty: EmptyState | null
  legend: readonly AnswerShapeGroup[]
  labels: Readonly<Record<AnswerShapeCode, string>>
  analysed: Count
  notAnalysed: Count
  blockTypes: number
  repeatingShapes: number
  mostCommon: ShapeJourney | null
  changed: Count
  frequency: readonly { code: AnswerShapeCode; label: string; answers: Count; blocks: number }[]
  journeys: readonly ShapeJourney[]
  changes: readonly { rowId: string; prompt: string; before: string; after: string }[]
  templateHash: string | null
}

export interface GapMatrixRow {
  number: number
  rowId: string | null
  prompt: string
  coverage: CoverageLevel
  whereCovered: readonly string[]
  mainGap: string
  actions: readonly CoverageAction[]
  /** "Update FAQ + new FAQ". */
  actionLabel: string
}

export interface OneByOneItem {
  number: number
  prompt: string
  now: string
  update: string
  newFaq: boolean
  faq: { question: string; answer: string; words: number } | null
}

/** Section 10. Page scope only. */
export interface ContentGapsSection {
  empty: EmptyState | null
  pageRead: {
    url: string
    title: string | null
    metaDescription: string | null
    h1: string | null
    /** ISO-8601 UTC. */
    readAt: string | null
    lastModified: string | null
    titleLength: number
    /** Over 60 characters: the end is likely cut in search results. */
    titleTruncated: boolean
    mismatches: readonly string[]
  } | null
  matrix: readonly GapMatrixRow[]
  /** "5 strong, 4 partial, 1 weak — 5–6 new FAQs plus edits to 5 sections". */
  summary: string
  oneByOne: readonly OneByOneItem[]
  pageWide: readonly { kind: CoverageFindingKind; summary: string; detail: string }[]
}

/** Section 11. The rows themselves are {@link ReportModel.rows}. */
export interface PromptsSection {
  empty: EmptyState | null
  all: Count
}

export interface ReportModel {
  version: typeof REPORT_MODEL_VERSION
  cover: ReportCover
  /** Sections included, in report order. The cover is always shown. */
  sections: readonly ReportSectionId[]
  markets: readonly ReportMarket[]
  pages: readonly ReportPage[]
  rows: readonly ReportRow[]
  /** Drill token → row ids. Tokens look like `aio:shown`, `host:reddit.com`, `dim:stage=objection`. */
  drills: Readonly<Record<string, readonly string[]>>
  overview: OverviewSection
  pagesSection: PagesSection
  competition: CompetitionSection
  reputation: ReputationSection
  trends: TrendsSection
  universe: UniverseSection
  sources: SourcesSection
  answerShape: AnswerShapeSection
  contentGaps: ContentGapsSection
  prompts: PromptsSection
  /** The one-sentence headline at the top of the report and the email (`@shared/report/headline`). */
  headline: string
  /** "What to do next": at most three, each with its evidence. Empty without evidence. */
  recommendations: readonly RecommendationModel[]
  /** The badge and findings, shown first (Docs/REPORT-SPEC.md "Verdict"). */
  verdict: VerdictModel
  /** Before vs after, against the previous full check. */
  whatChanged: WhatChangedSection
  /** "How this report was made", always the last section. */
  method: MethodSection
  references: readonly ReportReference[]
  /**
   * Topic coverage (Docs/TOPICS-SPEC.md section 5). Present only when the export holds a
   * topic subject; absent (not null) for page subjects, so their files do not change.
   */
  topicCoverage?: TopicCoverageSection
}

/**
 * Hooks for section builders that live with other features (brand sentiment, communities,
 * site structure, fix verdicts). Each receives the base context and returns its section.
 */
export interface ReportSectionBuilders {
  /** Undefined keeps the empty "Not measured yet" section. */
  reputation?: (context: ReportBuildContext) => ReputationSection | undefined
  sources?: (context: ReportBuildContext, base: SourcesSection) => SourcesSection
  groups?: (context: ReportBuildContext) => UniverseDimension | null
  /** Undefined keeps the verdicts the report computes from its own checks. */
  verdicts?: (context: ReportBuildContext) => readonly FixVerdictModel[] | undefined
  /** Topic subjects in scope; null when none is a topic (the section is then left out). */
  topicCoverage?: (context: ReportBuildContext) => TopicCoverageSection | null
}

/** What a section builder can read. Plain data, no database. */
export interface ReportBuildContext {
  rows: readonly ReportRow[]
  references: readonly ReportReference[]
  pages: readonly ReportPage[]
  markets: readonly ReportMarket[]
  ownDomain: string
  brands: readonly string[]
  competitors: readonly string[]
  /** Registers a drill list and returns its count. Re-using a token with other ids gets a new token. */
  count(token: string, ids: readonly string[]): Count
}
