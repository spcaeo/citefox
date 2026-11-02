import type { BrandView } from './visibility-types'
import type { SiteRow } from './compete-types'
import type { Kpi, Num, QuestionItem, Step, Tile } from './types'

/**
 * The three short ready reports (Docs/REPORT-SPEC.md "Short ready reports"): Pitch /
 * audit, Content plan and Head-to-head. Built by ready.ts from the same report model as
 * the rest, so every number is a `Num` whose drill lists exactly that many questions.
 */

/** Pitch / audit: a tight audit for a prospect or a boss, from one check. */
export interface PitchView {
  /** Show an AI answer, Cite your pages, Name your brand, Answer without you. */
  kpis: readonly Kpi[]
  /** One small line under each tile, in `kpis` order. */
  kpiNotes: readonly string[]
  /** The five most cited sites (yours included when it is among them). */
  sites: readonly SiteRow[]
  /** "What we'd fix first": up to five numbered steps, built from the data. */
  plan: readonly Step[]
}

/** Where a content plan row's page comes from. */
export type PlanPageSource = 'primary' | 'ai' | 'new'

export interface ContentRow {
  question: QuestionItem
  /** `notcited`: an AI answer shows without your pages. `wrongpage`: another page of yours. */
  reason: 'notcited' | 'wrongpage'
  /** The page to write or fix; null: a new page. */
  page: string | null
  pageSource: PlanPageSource
  /** "Primary page", "CiteFox AI's pick", "New page". */
  pageLabel: string
  /** The answer's block order to follow. `own`: this question's answer, else the most common. */
  shape: { label: string; outline: readonly string[]; own: boolean } | null
  /** Other sites the answer cites instead, most cited first (up to five). */
  sites: readonly string[]
  /** The plain-text brief "Copy brief" copies. */
  brief: string
}

export interface ContentGroup {
  topic: string
  questions: Num
  rows: readonly ContentRow[]
}

/** Content plan: what to write next, one row per question to win. */
export interface ContentPlanView {
  tiles: readonly Tile[]
  total: Num
  groups: readonly ContentGroup[]
}

/** One question in the head-to-head table. */
export interface RivalRow {
  question: QuestionItem
  /** The rival's best source position, or null (not cited, or not known). */
  theirs: number | null
  theirsCited: boolean
  /** Your best source position, or null. */
  yours: number | null
  yoursCited: boolean
  winner: 'them' | 'you' | 'tie'
}

export interface RivalPage {
  url: string
  title: string | null
  questions: Num
}

/** Head-to-head against one site. */
export interface RivalView {
  /** The picked rival (the request's, else the top competitor); null: nobody to compare. */
  domain: string | null
  /** Sites to pick from: saved competitors first, never social, video or big tech. */
  options: readonly string[]
  /** They are cited on, you are cited on, both, only them (the gap), only you. */
  tiles: readonly Tile[]
  rows: readonly RivalRow[]
  /** How the answers describe each brand; empty when nothing was read about the rival. */
  brands: readonly BrandView[]
  /** One line when `brands` is empty or misses the rival. */
  brandsNote: string | null
  /** The rival's pages the answers cite, most questions first. */
  pages: readonly RivalPage[]
  /** One line when `pages` is empty. */
  pagesNote: string | null
}

export interface ReadyView {
  pitch: PitchView
  content: ContentPlanView
  rival: RivalView
}
