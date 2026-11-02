import type { LoopStep } from '../../fix-loop'
import type { OutlineLine, PageDates } from './extras'
import type { Finding, Num, PageItem, Part, QuestionItem, SiteItem } from './types'

/**
 * The Impact review's extra parts (Docs/REPORT-SPEC.md "Impact review"), built by
 * impact.ts: the intro, the proofs that the published pages did it, the published-page
 * tables, the client asks and the method checks. Every number is a drill.
 */

/** One row of the at-a-glance list. */
export interface GlanceItem {
  label: string
  value: readonly Part[]
}

export interface ImpactIntro {
  /** One lead sentence. */
  lead: readonly Part[]
  glance: readonly GlanceItem[]
  /** The app header's meta line: "11 questions · 0 pages published · measured Oct 31". */
  meta: string
}

/** New pages, or rewrites: pages, cited, questions before → now, number-one spots. */
export interface KindRow {
  label: string
  pages: Num
  cited: Num
  before: Num | null
  now: Num
  first: Num
}

/** Published pages live this long. */
export interface DaysRow {
  label: string
  pages: Num
  cited: Num
  questions: Num
  first: Num
  /** Pages not shown as indexed yet. */
  notIndexed: Num
}

/** Number-one spots and average position of one page now. */
export interface PageStat {
  first: number
  /** Average source position over the questions citing it now; null when none. */
  avg: number | null
}

/** One heading of the side-by-side outline, marked when the other version lacks it. */
export interface OutlineRow extends OutlineLine {
  mark: 'same' | 'dropped' | 'added'
}

export type LostOutcome = 'own' | 'others' | 'none' | 'still'

/** What Lost ground adds per page: still citing, lost by topic, outline, outcomes. */
export interface LostMore {
  stillCiting: Num
  byTopic: readonly { topic: string; num: Num }[]
  outline: { before: readonly OutlineRow[]; after: readonly OutlineRow[] } | null
  /** Each listed question's outcome (lost ones and the ones still citing). */
  outcomes: Readonly<Record<string, LostOutcome>>
  /** The questions still citing the page, for the "Still citing" tab. */
  stillIds: readonly string[]
}

export interface IndexRow {
  label: string
  pages: Num
  indexed: number
  notIndexed: Num
  unchecked: number
}

export interface OpenTopicRow {
  topic: string
  questions: number
  open: Num
  /** Of the open ones: cited you at the From end. */
  wasCited: Num
}

export interface RoundHero {
  /** The round number: one per finished check. */
  number: number
  startedLabel: string | null
  line: string
  /** Steps the client's team owns, highlighted. */
  clientSteps: readonly LoopStep[]
}

export interface NotIndexedMore {
  /** Live 4+ days and still not indexed. */
  late: Num
  /** Live 3 days or less: Google may not have visited yet. */
  fresh: Num
}

export interface ImpactView {
  intro: ImpactIntro
  /** Extra Verdict findings: published vs the rest, gained through them, your rank. */
  proofs: readonly Finding[]
  /** The 8 most cited sites now, you among them. */
  topSites: readonly SiteItem[]
  kinds: readonly KindRow[]
  days: readonly DaysRow[]
  pageStats: Readonly<Record<string, PageStat>>
  /** Questions written for each page, by address (Not indexed). */
  questionsFor: Readonly<Record<string, number>>
  notIndexed: NotIndexedMore
  index: { rows: readonly IndexRow[]; line: string | null }
  openByTopic: readonly OpenTopicRow[]
  round: RoundHero
  lost: Readonly<Record<string, LostMore>>
  /** How we measured: the clean-before check and more definitions. */
  method: { cleanBefore: { ok: boolean; line: string } | null; lines: readonly string[] }
  /** The dates each page states about itself, by address. */
  pageDates: Readonly<Record<string, PageDates>>
  /** "Next check on Nov 14, then every 14 days." or the no-schedule line. */
  nextCheck: string
  /** The page story of each published page and each page that lost ground, by address. */
  stories: Readonly<Record<string, PageStory>>
}

/** A page's before → after story tile, such as "Questions 2 → 5 ▲3". */
export interface StoryTile {
  label: string
  before: string | null
  now: string
  /** now − before on the raw values; null without a before. */
  delta: number | null
  lowerIsBetter?: true
}

export type WaitReason = 'notindexed' | 'toonew' | 'nextround' | 'backlinks'

/** The page drawer: a before → after story of one page. */
export interface PageStory {
  page: PageItem
  tiles: readonly StoryTile[]
  /** Questions that newly cite it, kept citing it, and dropped it. */
  split: { newly: number; kept: number; dropped: number }
  /** First measured, published, went live, updated, this check: oldest first. */
  timeline: readonly { label: string; at: string; day: string }[]
  /** Your source position on the questions citing it: #1, #2, #3, #4–5, #6+. */
  spread: readonly { label: string; now: number; before: number | null }[]
  /** Other sites cited in the same answers now, most first. */
  sites: readonly { domain: string; n: number }[]
  tabs: {
    now: readonly QuestionItem[]
    newly: readonly QuestionItem[]
    kept: readonly QuestionItem[]
    dropped: readonly QuestionItem[]
  }
  /** Not cited yet: why, and what happens next. Null when it is cited. */
  waiting: readonly { reason: WaitReason; title: string; text: string }[] | null
}

export type NeedAction = 'fix' | 'check' | 'schedule'

/** "What this report needs": what is missing, with the buttons that fix it. */
export interface ReportNeeds {
  title: string
  lead: string
  /** One line per missing thing, such as "Log the pages you published (none yet)". */
  items: readonly { done: boolean; text: string }[]
  actions: readonly NeedAction[]
  /** "Next check on Nov 14, then every 14 days." or the no-schedule line. */
  nextCheck: string
}
