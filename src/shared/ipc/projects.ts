/** Projects and fill-from-website. */

import type {
  FillPhase,
  Market,
  MarketDevice,
  ProjectClaudeSettings,
  ProjectSearchSettings,
  ProjectStatus,
  ProjectSummary,
  WebsitePageRole,
  WorkProgressState
} from '../domain'
import {
  invoke,
  invokeWith,
  push,
  type InvokeChannelSpecs,
  type PushChannelSpecs
} from './contract'

/** `projects:list`. `activeProjectId` is null when no project exists yet. */
export interface ProjectList {
  activeProjectId: string | null
  projects: readonly ProjectSummary[]
}

/**
 * One project, including the fields that live in its database (FR-1.1, section 9.2).
 * Search caps, Claude connection, and template overrides are on `projectSettings:get`.
 */
export interface ProjectDetail extends ProjectSummary {
  includeSubdomains: boolean
  brandNames: readonly string[]
  competitors: readonly string[]
  defaultMarket: Market | null
  /** Options buyers switch from and integrations, kept for buyer prompts (never competitors). */
  switchingFrom?: readonly string[]
  integrations?: readonly string[]
  /** Pages known to the project, tracked or not. The sidebar search placeholder uses this. */
  foundPageCount: number
  /** Pages whose status is `setting_up`, `tracked`, or `paused`. */
  trackedPageCount: number
  /** Every market in the project, the default first (FR-10.5). The engine always fills this. */
  markets?: readonly Market[]
}

/** Arguments for `projects:create`. Slug and database path are chosen by the engine. */
export interface CreateProjectRequest {
  name: string
  /** Registrable domain, such as `example.com`. */
  domain: string
  includeSubdomains: boolean
  brandNames: readonly string[]
  /** Optional. An empty list means no competitors yet. */
  competitors: readonly string[]
  /** Null for the user's own site (FR-10.7). */
  clientName: string | null
  /** ISO 3166-1 alpha-2, uppercase. The project's default market. */
  country: string
  /** ISO 639-1 or BCP-47. Primary subtag lowercase. */
  language: string
  location: string | null
  device: MarketDevice
  /**
   * FR-10.4. Copy schedule, samples, notifications, template overrides, search rule and
   * Claude settings from this project. Pages, prompts, and history are never copied.
   * Omitted or null starts from the app defaults.
   */
  copySettingsFrom?: string | null
  /** FR-11.4. Omitted uses shared keys with no cap, or the copied project's setting. */
  search?: ProjectSearchSettings
  /** FR-11.7. Omitted follows Settings, or the copied project's setting. */
  claude?: ProjectClaudeSettings
  /** Optional. Options buyers switch from ("Use in buyer questions"). */
  switchingFrom?: readonly string[]
  /** Optional. Integrations and tools ("Note as integration"). */
  integrations?: readonly string[]
}

/** Arguments for `projects:update`. Omitted fields stay as they are. */
export interface UpdateProjectRequest {
  projectId: string
  name?: string
  domain?: string
  includeSubdomains?: boolean
  brandNames?: readonly string[]
  competitors?: readonly string[]
  clientName?: string | null
  status?: ProjectStatus
  country?: string
  language?: string
  location?: string | null
  device?: MarketDevice
}

export interface ProjectIdRequest {
  projectId: string
}

/** A market the user typed on Add page or New project. The engine assigns the id. */
export interface MarketDraft {
  country: string
  language: string
  location: string | null
  device: MarketDevice
  localWording: boolean
}

/**
 * `projects:fillFromWebsite` (FR-1.8).
 * `projectId` is null on the New project form, before the project exists.
 * Suggestions are not saved by this call.
 */
export interface FillFromWebsiteRequest {
  projectId: string | null
  domain: string
  /**
   * The market chosen on the form (batch 2 row 5): the competitor question is asked for
   * buyers in this country and language. Omitted: the project's default market, else the
   * market suggested from the site.
   */
  market?: { country: string; language: string } | null
  /**
   * True: only what the site says about itself (summary, brands, products), with no
   * web search for competitors and no switch-from read (setup step 4's Start over).
   */
  brandOnly?: boolean
}

export interface WebsitePageRead {
  url: string
  role: WebsitePageRole
  ok: boolean
}

export interface BrandSuggestion {
  id: string
  name: string
  reason: string
}

/** Where the site shows a suggestion: a page path and a short quote from it. */
export interface SuggestionEvidence {
  path: string
  quote: string
}

/** A web page Claude used for a competitor (batch 2 row 5). Always http(s). */
export interface CompanySource {
  url: string
  /** Written by the business itself or a direct rival: treat it as marketing. */
  biased: boolean
}

/** How close a competitor is to one product: same job today, or an overlap. */
export type CompetitorTier = 'direct' | 'partial'

/**
 * One product or offering the site sells (batch 2 row 5). Competitors are found per
 * product: one company can be direct for one product and partial or absent for another.
 */
export interface ProductSuggestion {
  id: string
  /** Short product name, such as "Email-to-SMS gateway". */
  name: string
  /** The job it does for the buyer. */
  job: string
  /** Who buys it. */
  buyer: string
  evidence: SuggestionEvidence | null
  /**
   * Null when the web search ran. Otherwise a short plain line: the search could not run
   * (Anthropic API without web search, or a failed call), so the list is from Claude's
   * knowledge only, or empty.
   */
  searchNote: string | null
}

/**
 * A company found on the site (Docs/FEEDBACK.md row 3): a competitor, an option
 * buyers switch from, or an integration. Switching-from and integrations cite the page
 * that shows them; competitors come from a web search per product (batch 2 row 5).
 */
export interface CompanySuggestion {
  id: string
  name: string
  /** A verified domain (see `domainSource`). Null means the domain is unknown. */
  domain: string | null
  /**
   * Where `domain` came from: `site` when a page read links to or names it, `lookup`
   * when it was looked up and verified (resolves, and names the brand), `typed` when the
   * user typed it and it resolved. Null when `domain` is null.
   */
  domainSource: CompanyDomainSource | null
  /** Why a buyer would choose them instead, what changed, or how it is used. */
  reason: string
  evidence: SuggestionEvidence | null
  /** True when Claude gave a domain the pages do not show; it was cleared, so check it. */
  checkDomain: boolean
  /** Competitors only: the `ProductSuggestion.id` this competitor was found for. */
  product?: string | null
  /** Competitors only: direct (same product, buyer and job) or partial overlap. */
  tier?: CompetitorTier
  /** Competitors only: the lowest public price, as written ("$29/mo"), or null. */
  startingPrice?: string | null
  /** Competitors only: the web pages used (http/https only). */
  sources?: readonly CompanySource[]
}

/**
 * `site`: a page read links to or names it. `search`: the web search named it and it was
 * verified (resolves, names the brand). `lookup`: looked up and verified. `typed`: the
 * user typed it and it resolved.
 */
export type CompanyDomainSource = 'site' | 'search' | 'lookup' | 'typed'

/** `projects:checkCompanyDomain`: a domain the user typed for a row whose domain is unknown. */
export interface CheckCompanyDomainRequest {
  domain: string
}

export interface CheckCompanyDomainResult {
  ok: boolean
  /** The bare hostname when it resolves to a public address, else null. */
  domain: string | null
  message: string
}

/** A live product the same buyer could choose instead, for the same job, today. */
export type CompetitorSuggestion = CompanySuggestion

/** The Projects mock-up also suggests a default market. FR-1.8 does not require one. */
export interface SuggestedMarket {
  country: string
  language: string
  location: string | null
  reason: string
}

/**
 * Brands, competitors, and an optional market, each with a reason.
 * Page bodies are not included. No secrets.
 */
export interface FillFromWebsiteResult {
  domain: string
  pagesRead: readonly WebsitePageRead[]
  /** What the business sells, to whom, for what job (2–3 sentences). Absent on older reads. */
  summary?: string | null
  /** The products or offerings found on the site; competitors point at one by `product`. */
  products?: readonly ProductSuggestion[]
  brands: readonly BrandSuggestion[]
  /** Every product's competitors, each with `product` and `tier`. */
  competitors: readonly CompetitorSuggestion[]
  /** Replaced or discontinued options buyers migrate from (never added as competitors). */
  switchingFrom: readonly CompanySuggestion[]
  /** Partners and tools users connect or send from (never added as competitors). */
  integrations: readonly CompanySuggestion[]
  suggestedMarket: SuggestedMarket | null
  message: string
  /** NFR-10. Null when the read produced suggestions. */
  nextStep: string | null
}

/** Pushed while `projects:fillFromWebsite` is in flight. */
export interface FillFromWebsiteProgress {
  domain: string
  phase: FillPhase
  state: WorkProgressState
  /** The page being read. Null during `suggest`. */
  url: string | null
  detail: string
  /** NFR-10. Null unless `state` is `warning`. */
  nextStep: string | null
  /** What the read has found so far, for setup step 3's live list. Absent on other events. */
  found?: FillFound
}

/**
 * What a read has found so far (owner, 2026-10-29: "show users what exactly is going on.
 * how many have you found, can you list them in real time"), on `suggest` events.
 * - `site`: the site read is in (sent once, before any competitor search starts).
 * - `search`: one product's competitor search changed state.
 */
export type FillFound = FillSiteFound | FillSearchFound

export interface FillSiteFound {
  kind: 'site'
  summary: string | null
  brands: readonly BrandSuggestion[]
  /** With the ids `search` events and competitors point at. */
  products: readonly ProductSuggestion[]
  /** Live products the site's pages compare it with, by name (not checked yet). */
  comparedWith: readonly string[]
  switchingFrom: readonly CompanySuggestion[]
  integrations: readonly CompanySuggestion[]
  suggestedMarket: SuggestedMarket | null
  /** The market the competitor searches ask about. Null: none. */
  market: { country: string; language: string } | null
}

/**
 * `waiting`: queued behind other Claude calls (Settings caps calls at once). `running`:
 * Claude is searching the web. `done`: its competitors are checked. `failed`: it did not
 * finish; the rest of the read goes on.
 */
export type ProductSearchState = 'waiting' | 'running' | 'done' | 'failed'

export interface FillSearchFound {
  kind: 'search'
  productId: string
  state: ProductSearchState
  /** Its checked competitors, once `done`. Empty otherwise. */
  competitors: readonly CompanySuggestion[]
  /** Why it `failed`, in plain words. Null otherwise. */
  note: string | null
}

/**
 * `projects:searchProductCompetitors`: one product's competitor search again (setup
 * step 3's "Try again" for a search that did not finish). Nothing is saved.
 */
export interface ProductCompetitorsRequest {
  projectId: string | null
  domain: string
  market: { country: string; language: string } | null
  summary: string | null
  product: { id: string; name: string; job: string; buyer: string }
  comparedWith: readonly string[]
  brandNames: readonly string[]
  /** Switch-from and integration names: never competitors. */
  notCompetitors: readonly string[]
}

export interface ProductCompetitorsResult {
  productId: string
  ok: boolean
  competitors: readonly CompanySuggestion[]
  /** Why it did not finish, in plain words. Null when `ok`. */
  note: string | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const projectsChannels = {
  'projects:list': invoke<ProjectList>(),
  'projects:get': invokeWith<ProjectIdRequest, ProjectDetail>(),
  'projects:create': invokeWith<CreateProjectRequest, ProjectDetail>(),
  'projects:update': invokeWith<UpdateProjectRequest, ProjectDetail>(),
  'projects:switch': invokeWith<ProjectIdRequest, ProjectDetail>(),
  'projects:fillFromWebsite': invokeWith<FillFromWebsiteRequest, FillFromWebsiteResult>(),
  'projects:checkCompanyDomain': invokeWith<CheckCompanyDomainRequest, CheckCompanyDomainResult>(),
  'projects:searchProductCompetitors': invokeWith<
    ProductCompetitorsRequest,
    ProductCompetitorsResult
  >()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const projectsEvents = {
  'projects:fillProgress': push<FillFromWebsiteProgress>()
} as const satisfies PushChannelSpecs
