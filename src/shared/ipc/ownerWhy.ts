/**
 * "Why Google picks <cited page>" (What to fix › Pick which page owns it): CiteFox
 * AI reads the target page, the page Google cites instead, and the saved AI
 * Overviews of the fix's searches, then says which page should own them and what
 * content to change. Saved checks and two page reads only; never a search.
 */

/** One search of the fix, as the comparison reads its saved overview. */
export interface OwnerWhySearch {
  promptId: string
  /** The check its result comes from. Null when not checked. */
  runId: string | null
  /** The question or keyword text. */
  text: string
}

/** `fixes:draftOwnerWhy`: compares the two pages and saves the result per fix. */
export interface DraftOwnerWhyRequest {
  projectId: string
  fixId: string
  /** The page the business chose for these searches. */
  target: { pageId: string | null; url: string }
  /** The page of the business Google cites instead. */
  citedUrl: string
  /** Best first. */
  searches: readonly OwnerWhySearch[]
}

/** Which page should own the searches: the chosen target, Google's pick, or either. */
export type OwnerVerdict = 'target' | 'cited' | 'either'

/** Something the cited page has that the target lacks, with where it sits. */
export interface OwnerWhyPoint {
  /** The cited page's heading, or "Opening" for the text above the first heading. */
  section: string
  point: string
}

/** One content change to the recommended owner page. */
export interface OwnerWhyChange {
  /** An existing heading, "New section after <heading>", or "Opening". */
  section: string
  /** What to add or rewrite. Content, never an address change. */
  change: string
  why: string
}

/** The comparison as the drawer shows it, saved per fix (a newer one replaces it). */
export interface OwnerWhyResult {
  fixId: string
  targetUrl: string
  citedUrl: string
  verdict: OwnerVerdict
  /** One or two plain sentences. */
  reason: string
  /** What Google's answer needs to say for these searches. */
  answerNeeds: readonly string[]
  citedHas: readonly OwnerWhyPoint[]
  /** The page `toChange` is about: the cited page when the verdict is `cited`, else the target. */
  ownerUrl: string
  toChange: readonly OwnerWhyChange[]
  /** Cannibalisation advice, such as linking one page to the other. Null when none. */
  risk: string | null
  /** Searches whose saved AI Overview was read. */
  overviews: number
  /** "CiteFox AI · about 30 s · no searches". */
  note: string
  /** ISO-8601 UTC. */
  savedAt: string
}

/** `fixes:ownerWhy`: the saved comparison of one fix. */
export interface OwnerWhyRequest {
  projectId: string
  fixId: string
}
