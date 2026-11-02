/**
 * Project settings › Markets: every market the project tracks, with the pages and
 * topics that use it, and the calls that add a market to many pages at once,
 * remove one from every page (with Undo), and make one the default.
 */

import type { Market, PageKind, PageStatus } from '../domain'
import type { MarketDraft } from './projects'

/** A page or topic as the Markets table and the Add market drawer show it. */
export interface ProjectMarketPage {
  id: string
  kind: PageKind
  /** A page's label, title or URL; a topic's name. */
  name: string
  /** Null for a topic. */
  url: string | null
  /** Never `removed`: removed pages are left out. */
  status: PageStatus
  /** Enabled questions in the active set (keywords included). */
  questions: number
  samples: number
  /** The markets it is checked in, in the order they were added. */
  marketIds: readonly string[]
  defaultMarketId: string | null
}

/** `projectSettings:markets`. */
export interface ProjectMarketsView {
  projectId: string
  /** The project's default market for new pages. Null before one is set. */
  defaultMarketId: string | null
  /** Markets a page or topic uses, plus the default; the default first. */
  markets: readonly Market[]
  /** Pages first, then topics, in list order. */
  pages: readonly ProjectMarketPage[]
  /** Searches left this month (keys and cap, the lower). Null when unknown. */
  searchesLeft: number | null
}

/**
 * `projectSettings:addMarket`. Adds the market (found by its fields, else created)
 * to each listed page or topic. Pages that already have it are left as they are.
 * Each new link starts its own baseline at its first check.
 */
export interface AddProjectMarketRequest {
  projectId: string
  market: MarketDraft
  /** At least one; pages or topics of this project that are not removed. */
  pageIds: readonly string[]
}

export interface AddProjectMarketResult {
  marketId: string
  /** Pages and topics that got the market. */
  added: readonly string[]
  /** Pages and topics that already had it. */
  alreadyHad: readonly string[]
  view: ProjectMarketsView
}

/** One page's link to a market, as it was before a remove (for Undo). */
export interface ProjectMarketLink {
  pageId: string
  addedAt: string
  baselineRunId: string | null
  /** Its last check in this market, so the schedule carries on. Null before one. */
  lastCheckedAt: string | null
  /** It was the page's default market. */
  wasDefault: boolean
}

/** `projectSettings:removeMarket`. The default market cannot be removed. */
export interface RemoveProjectMarketRequest {
  projectId: string
  marketId: string
}

export interface RemoveProjectMarketResult {
  marketId: string
  /** What `projectSettings:restoreMarket` puts back. */
  removed: readonly ProjectMarketLink[]
  /** Pages and topics left alone: the market is their only one. */
  skipped: readonly string[]
  view: ProjectMarketsView
}

/**
 * `projectSettings:restoreMarket` (Undo of a remove): links the market to each page
 * again with its old baseline, and makes it the page's default where it was.
 */
export interface RestoreProjectMarketRequest {
  projectId: string
  marketId: string
  links: readonly ProjectMarketLink[]
}

/**
 * `projectSettings:setDefaultMarket`. Makes the market the project's default for new
 * pages. `pages: 'tracking'` also makes it the default market of every page and
 * topic that is checked in it.
 */
export interface SetDefaultProjectMarketRequest {
  projectId: string
  marketId: string
  pages: 'none' | 'tracking'
}

export interface SetDefaultProjectMarketResult {
  /** The project default before, for Undo. Null when there was none. */
  previousDefaultMarketId: string | null
  /** Pages whose default changed, with the market they had (for Undo). */
  changedPages: readonly { pageId: string; previousMarketId: string | null }[]
  view: ProjectMarketsView
}
