import type { AnswerShapeCode } from '../../answer-shape'
import type { CitationSourceType } from '../../domain'
import type { Num } from './types'

/**
 * The Sources and Answer shape tabs of the Visibility report (Docs/REPORT-SPEC.md
 * "Ready reports"): what main reads from the stored answers (`AnswerExtras`), and the
 * views both renderers draw. Every engine's answers count, not only Google's.
 */

/** Who a cited page belongs to. */
export type SourceWho = 'you' | 'competitor' | 'other'

/** One page an answer cites (one engine's answer, each page once). */
export interface CitedSource {
  url: string
  /** Bare host, such as `reddit.com`. */
  domain: string
  title: string | null
  who: SourceWho
  type: CitationSourceType
}

export type ReplyState = 'open' | 'archived' | 'locked' | 'unchecked'

export interface VideoFacts {
  title: string | null
  channel: string | null
  views: number | null
  publishedAt: string | null
}

export interface ThreadFacts {
  reply: ReplyState
  upvotes: number | null
  comments: number | null
}

/**
 * What the Sources and Answer shape tabs need beyond the metrics, by metrics row id
 * (engine rows; an All engines row reads its parts). Read from the project file.
 */
export interface AnswerExtras {
  /** The pages each answer cites. A row with no entry cites nothing stored. */
  citations: Readonly<Record<string, readonly CitedSource[]>>
  /**
   * Each answer's blocks in reading order, as CiteFox AI classified them. An empty list:
   * the answer has text that is not read yet. No entry: no answer text.
   */
  blocks: Readonly<Record<string, readonly AnswerShapeCode[]>>
  /** "Get views" details by YouTube video id. */
  videos: Readonly<Record<string, VideoFacts>>
  /** "Check threads" details by lower-case Reddit post id. */
  threads: Readonly<Record<string, ThreadFacts>>
}

export const EMPTY_ANSWER_EXTRAS: AnswerExtras = {
  citations: {},
  blocks: {},
  videos: {},
  threads: {}
}

export interface SourceTypeRow {
  type: CitationSourceType
  label: string
  /** Distinct pages (a YouTube video counts once, whatever its link). */
  pages: number
  citations: number
  /** Share of all citations, 0–100. */
  share: number
  questions: Num
}

export interface VideoRow extends VideoFacts {
  videoId: string
  url: string
  /** The posted day, such as "Sep 16, 2024", or null. */
  posted: string | null
  citations: number
  questions: Num
  /** Questions citing this video where you are not cited. */
  gap: Num
}

export interface ThreadRow extends ThreadFacts {
  url: string
  title: string | null
  subreddit: string
  citations: number
  questions: Num
  gap: Num
}

export interface LinkedinRow {
  url: string
  title: string | null
  kind: 'post' | 'article' | 'profile' | 'other'
  citations: number
  questions: Num
}

export interface OutsidePage {
  url: string
  domain: string
  title: string | null
  who: SourceWho
  type: CitationSourceType
  citations: number
  questions: Num
  gap: Num
}

export interface SourcesView {
  /** Citations counted (one answer cites many pages, so this is more than questions). */
  total: number
  yours: number
  competitor: number
  other: number
  /** Share of citations that are your pages, 0–100. */
  yoursShare: number
  /** Citations in answers that do not cite you. */
  gapCitations: number
  /** Questions whose answer cites at least one page. */
  answers: Num
  citingYou: Num
  citingCompetitor: Num
  /** Questions with an answer that cites other pages but not yours. */
  gaps: Num
  types: readonly SourceTypeRow[]
  youtube: {
    channels: readonly { channel: string; videos: number; citations: number; questions: Num }[]
    videos: readonly VideoRow[]
    /** Some videos have no channel or views yet (Communities → Get views). */
    detailsMissing: boolean
  }
  reddit: {
    subreddits: readonly { name: string; threads: number; citations: number; questions: Num }[]
    /** Open threads first, then the most upvoted. */
    threads: readonly ThreadRow[]
    sentence: string
  }
  linkedin: readonly LinkedinRow[]
  /** The outside pages cited on the most questions (your own pages left out), top 25. */
  influential: readonly OutsidePage[]
}

export interface ShapeBlockRow {
  code: AnswerShapeCode
  name: string
  group: string
  /** Answers that hold this block at least once. */
  answers: Num
  /** Times the block appears across those answers. */
  blocks: number
}

export interface JourneyRow {
  /** `A1 → C4 → D2`. */
  fingerprint: string
  codes: readonly AnswerShapeCode[]
  /** Plain names in order: "Definition → Step-by-step → Risks and limits". */
  label: string
  opensWith: string
  answers: Num
  /** "Write a page in this order": one line per block. */
  outline: readonly string[]
}

export interface ShapeView {
  /** Answers with text, by question. Zero: nothing to read. */
  withText: number
  analysed: Num
  /** Answers with text CiteFox AI has not read yet. */
  waiting: Num
  mostCommon: JourneyRow | null
  /** Null when not comparing; else the questions whose journey changed. */
  changed: Num | null
  blocks: readonly ShapeBlockRow[]
  journeys: readonly JourneyRow[]
  legend: readonly {
    label: string
    items: readonly { code: AnswerShapeCode; name: string; meaning: string }[]
  }[]
}
