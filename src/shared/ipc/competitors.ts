/**
 * Competitors (project-level, AI-visibility-first navigation): who the AI Overviews
 * cite and name across the project's latest checks, with the trend over a period.
 * Counts use the units the page Citations screens use: a citation is one link in an
 * overview's references, and a question is one buyer prompt of a page or topic.
 */

import type { Market } from '../domain'
import type { SiteKind, SortableSiteKind } from '../report/site-kinds'
import type { SiteRole } from '../site-role'
import type {
  CustomSiteType,
  SiteOverride,
  SiteTypeChoice,
  SiteTypeSettings,
  SiteTypeTone
} from '../site-overrides'
import { invokeWith, type InvokeChannelSpecs } from './contract'

/** Days the trend looks back. */
export const COMPETITOR_PERIODS = [7, 30, 90] as const
export type CompetitorPeriod = (typeof COMPETITOR_PERIODS)[number]

export function isCompetitorPeriod(value: unknown): value is CompetitorPeriod {
  return COMPETITOR_PERIODS.some((item) => item === value)
}

/** `competitors:overview`. Absent or null `marketId` / `productId`: every market / product. */
export interface CompetitorsOverviewRequest {
  projectId: string
  marketId?: string | null
  productId?: string | null
  period: CompetitorPeriod
}

/**
 * `you`: the project's own site (FR-6.5). `competitor`: a saved competitor, matched by
 * the one competitor matcher (or stored as one by the check). `other`: any other site.
 */
export type CitedSiteKind = 'you' | 'competitor' | 'other'

/** A product the project sells, as the product filter names it. */
export interface CompetitorProductOption {
  id: string
  name: string
}

/** One cited site's numbers inside one product (`productId` null: pages with no product). */
export interface CitedSiteProductShare {
  productId: string | null
  citations: number
  questions: number
  /** Share of every citation in that product. Null when the product has none. */
  share: number | null
}

/**
 * One question whose overview cites this site and not the project's own site, in the
 * latest check. Opens the prompt detail of `pageId` / `promptId` in `marketId` / `runId`.
 */
export interface CompetitorGapQuestion {
  /** `pageId|promptId`. */
  id: string
  pageId: string
  pageKind: 'page' | 'topic'
  /** The page's label or title, the topic's name. */
  pageLabel: string
  /** Null for a topic. */
  pageUrl: string | null
  promptId: string
  promptLabel: string
  promptText: string
  /** The first market where it happens; `marketIds` lists all of them. */
  marketId: string
  marketIds: readonly string[]
  runId: string
  /** The site's best reference position in that overview. */
  position: number
  /** The site's URL Google listed there. */
  url: string
  /** ISO-8601 UTC. */
  checkedAt: string | null
}

/**
 * One question behind a site's Questions or Named number (latest checks), opening its
 * prompt detail in `marketId` / `runId`. Questions repeat across markets once.
 */
export interface CompetitorQuestionRef {
  /** `pageId|promptId`. */
  id: string
  pageId: string
  pageKind: 'page' | 'topic'
  pageLabel: string
  promptId: string
  promptLabel: string
  promptText: string
  marketId: string
  marketIds: readonly string[]
  runId: string
  /** The site's links in that question's overviews, every market together. 0 for named only. */
  links: number
  /** Best reference position. Null when the site is named, not cited. */
  position: number | null
}

/** One link counted in a site's Citations number: one URL in one overview. */
export interface CompetitorLink {
  /** `pageId|promptId|runId|n`. */
  id: string
  pageId: string
  promptId: string
  promptText: string
  marketId: string
  runId: string
  url: string
  position: number
}

/** One row: a cited site or brand, the project itself, or a saved competitor not cited. */
export interface CitedSiteRow {
  /** Opaque and stable for the same site, for routes. Never the domain itself. */
  id: string
  /** The competitor's saved name, the project's brand, or the host. */
  name: string
  /** The site's host (the saved domain or the host cited most). Null when not known. */
  domain: string | null
  kind: CitedSiteKind
  /**
   * The kind of site ("Who else the AI answers cite"): `competitors` for a saved
   * competitor, else the built-in list, then Claude's stored answer, else `other`.
   * Null for the `you` row.
   */
  siteKind: SiteKind | null
  /** True when no list and no AI has sorted this domain yet (it shows as "Not sorted yet"). */
  siteKindPending?: boolean
  /** Saved tier of a competitor. Null for the others, and for a competitor no longer saved. */
  tier: 'direct' | 'partial' | null
  /** Links to the site in the latest checks' overviews. */
  citations: number
  /** Questions whose latest overview cites the site. */
  questions: number
  /** `citations` of every citation in scope. Null when nothing was cited. */
  share: number | null
  /**
   * Questions whose latest overview names it as a whole word: the brand flag for `you`,
   * the saved name for a competitor. Null for other sites (no name to look for).
   */
  named: number | null
  /** Citations in the checks as of the period start. Null without a check that old. */
  startCitations: number | null
  /** `share` minus the share at the period start. Null without a check that old. */
  shareChange: number | null
  /** ISO-8601 UTC of the first full check that cited it. Null when never cited. */
  firstSeenAt: string | null
  /** First cited inside the period, in a project checked before the period. */
  isNew: boolean
  /** Per product, when the project has two or more products. Empty otherwise. */
  byProduct: readonly CitedSiteProductShare[]
  /** Where it is cited and you are not. Empty for the `you` row. */
  gaps: readonly CompetitorGapQuestion[]
  /** The links behind `citations`, best position first. */
  links: readonly CompetitorLink[]
  /** The questions behind `questions`. */
  citedQuestions: readonly CompetitorQuestionRef[]
  /** The questions behind `named` (empty when `named` is null). */
  namedQuestions: readonly CompetitorQuestionRef[]
}

/** `competitors:overview`. */
export interface CompetitorsOverview {
  projectId: string
  period: CompetitorPeriod
  /** ISO-8601 UTC: now minus `period` days. */
  periodStart: string
  marketId: string | null
  productId: string | null
  /** Every market in the project, for the filter. */
  markets: readonly Market[]
  /** Every product, for the filter. Empty when the project has none. */
  products: readonly CompetitorProductOption[]
  ownDomain: string
  /** Citations in scope (every row's `citations` together). */
  citations: number
  /** Questions with an AI Overview in the latest checks. */
  questions: number
  /** Page or topic × market checks the numbers come from. */
  checks: number
  /** ISO-8601 UTC of the newest of those checks. Null before any check. */
  checkedAt: string | null
  /** Rows with `isNew`. Null when nothing was checked before the period. */
  newSites: number | null
  /** You first, then by citations. */
  rows: readonly CitedSiteRow[]
  /**
   * Cited domains in these rows that neither the built-in list nor Claude has sorted
   * yet (they show as `other` until `competitors:sortSites` sorts them).
   */
  unsortedDomains: number
}

/** `competitors:sortSites`: Claude sorts the next batch of unsorted cited domains, once each. */
export interface CompetitorsSortSitesRequest {
  projectId: string
}

export interface CompetitorsSortSitesResult {
  /** Domains sorted and saved by this call. */
  sorted: number
  /** Domains still unsorted after it. */
  remaining: number
}

/**
 * A saved competitor: every saved row of one company (the same name) together. `id` is
 * the Competitors row id of the company, so a route never carries its name or domain.
 */
export interface SavedCompetitor {
  id: string
  name: string
  /** The main domain. Null when only the name is known. */
  domain: string | null
  /** Other domains of the company. */
  aliases: readonly string[]
  /** Direct when it is direct for any product. */
  tier: 'direct' | 'partial'
  /** The products it competes with; null is the whole business. */
  productIds: readonly (string | null)[]
}

/** `competitors:list`: every saved competitor, and the products to pick from. */
export interface CompetitorsList {
  projectId: string
  competitors: readonly SavedCompetitor[]
  products: readonly CompetitorProductOption[]
}

export interface CompetitorsProjectRequest {
  projectId: string
}

/**
 * `competitors:save`. `id` null adds a competitor (refused when one with that name or
 * domain is saved); an id edits that company's rows: name, domains and tier, and its
 * products when `productIds` is given (absent: unchanged; a new one is for the whole
 * business).
 */
export interface SaveCompetitorRequest {
  projectId: string
  id: string | null
  name: string
  domain: string | null
  aliases: readonly string[]
  tier: 'direct' | 'partial'
  productIds?: readonly (string | null)[]
}

/** What a change returns: the result, and a token `competitors:restore` undoes it with. */
export interface CompetitorChangeResult {
  competitor: SavedCompetitor | null
  /** Names removed or merged away, for the toast. */
  names: readonly string[]
  undoToken: string
}

/** `competitors:remove`: drops these companies from every product. */
export interface RemoveCompetitorsRequest {
  projectId: string
  ids: readonly string[]
}

/**
 * `competitors:merge`: the companies in `ids` become `intoId` (kept name and tier,
 * every domain kept as an alias, products joined). `name` renames the result.
 */
export interface MergeCompetitorsRequest {
  projectId: string
  ids: readonly string[]
  intoId: string
  name?: string
}

/** `competitors:restore`: puts the saved competitors back as they were before a change. */
export interface RestoreCompetitorsRequest {
  projectId: string
  undoToken: string
}

/**
 * `competitors:setSiteKind`: the kind of a cited site that is not a competitor, set by
 * the user (it replaces Claude's answer for that domain).
 */
export interface SetSiteKindRequest {
  projectId: string
  domain: string
  kind: SortableSiteKind
}

export interface SetSiteKindResult {
  domain: string
  kind: SortableSiteKind
}

/**
 * `competitors:setSiteType`: the type of site and role ("Who it is") the user set for
 * one domain, on every sources list of the project. An absent field is unchanged; null
 * puts it back to automatic. Competitor is never a role here: it is the competitor list.
 */
export interface SetSiteTypeRequest {
  projectId: string
  domain: string
  type?: SiteTypeChoice | null
  role?: SiteRole | null
}

/** The domain's choice before and after (null: automatic), so a change can be undone. */
export interface SetSiteTypeResult {
  previous: SiteOverride | null
  override: SiteOverride | null
}

/** `competitors:saveSiteTypeDef`: a new custom type of site (`id` null), or a rename. */
export interface SaveSiteTypeDefRequest {
  projectId: string
  id: string | null
  name: string
  tone: SiteTypeTone
}

/** `competitors:removeSiteTypeDef`: deletes a custom type; its domains go back to automatic. */
export interface RemoveSiteTypeDefRequest {
  projectId: string
  id: string
}

export interface RemoveSiteTypeDefResult {
  /** Domains that had the type. */
  cleared: number
}

/** Invoke channels for this area. Each one is declared here only. */
export const competitorsChannels = {
  'competitors:overview': invokeWith<CompetitorsOverviewRequest, CompetitorsOverview>(),
  'competitors:sortSites': invokeWith<CompetitorsSortSitesRequest, CompetitorsSortSitesResult>(),
  'competitors:list': invokeWith<CompetitorsProjectRequest, CompetitorsList>(),
  'competitors:save': invokeWith<SaveCompetitorRequest, CompetitorChangeResult>(),
  'competitors:remove': invokeWith<RemoveCompetitorsRequest, CompetitorChangeResult>(),
  'competitors:merge': invokeWith<MergeCompetitorsRequest, CompetitorChangeResult>(),
  'competitors:restore': invokeWith<RestoreCompetitorsRequest, CompetitorsList>(),
  'competitors:setSiteKind': invokeWith<SetSiteKindRequest, SetSiteKindResult>(),
  'competitors:siteTypes': invokeWith<CompetitorsProjectRequest, SiteTypeSettings>(),
  'competitors:setSiteType': invokeWith<SetSiteTypeRequest, SetSiteTypeResult>(),
  'competitors:saveSiteTypeDef': invokeWith<SaveSiteTypeDefRequest, CustomSiteType>(),
  'competitors:removeSiteTypeDef': invokeWith<RemoveSiteTypeDefRequest, RemoveSiteTypeDefResult>()
} as const satisfies InvokeChannelSpecs
