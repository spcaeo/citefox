import type { SiteKind } from '../site-kinds'
import type { Num, Tile } from './types'

/**
 * The Competitors tab shared by every ready report (Docs/REPORT-SPEC.md "Competitors"):
 * five tiles, the kinds of site, every cited site and the share of voice. Built by
 * `competitionView` (compete.ts) from the same metrics as the rest of the report.
 */

/** One cited site in the full table. Counts are over the same questions as the ranking. */
export interface SiteRow {
  /** 1 = most cited now. */
  rank: number
  domain: string
  own: boolean
  /** Null for your own site. */
  kind: SiteKind | null
  /** "You" for your own site, else the kind's words. */
  kindLabel: string
  before: Num | null
  now: Num
  /** now − before; null without a comparison. */
  change: number | null
  /** Questions citing this site and you in the same answer, now. Null for your own site. */
  withYou: Num | null
  /** Questions citing this site but not you, now. Null for your own site. */
  gap: Num | null
  /** Average source position (1 = first), one decimal; null when not known. */
  positionBefore: number | null
  positionNow: number | null
}

/** One kind of site: how many sites and how many citations, before and now. */
export interface SiteKindRow {
  kind: SiteKind
  label: string
  sites: number
  before: number | null
  now: number
  change: number | null
  /** Questions citing any site of this kind now. */
  questions: Num
}

/** Answers that show now, split by who wins them (the Full report's rule). */
export interface ShareOfVoice {
  /** Every answer shown. */
  total: Num
  /** Cites your pages. */
  you: Num
  /** Not you; cites at least one named competitor. */
  competitor: Num
  /** Not you, no named competitor: other sites only. */
  others: Num
  /** No site cited at all. */
  none: Num
}

export interface CompetitionView {
  tiles: readonly Tile[]
  kinds: readonly SiteKindRow[]
  sites: readonly SiteRow[]
  /** Null when no AI answer showed. */
  sov: ShareOfVoice | null
  /** Saved competitors appear among the cited sites. */
  namedCompetitors: number
}
