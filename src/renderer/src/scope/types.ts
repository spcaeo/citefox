import type { Market, PageStatus } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'

/**
 * What a check, an export, a report or an alert rule covers. One shape for
 * every "which pages?" question in the Tracking area, so a scope reads the
 * same in Check now, Export, Reports and Alerts, and lives on the URL as
 * `<prefix>.scope=<kind>&<prefix>.ids=a,b`.
 *
 * - `due`: tracked pages whose next check is due now (Check now only).
 * - `tracked`: every tracked page in the project.
 * - `all`: every tracked page and every topic, all their questions (Check now's
 *   "Everything again").
 * - `project`: the whole project as one unit (Export, Reports).
 * - `pages`, `group`, `cluster`, `topic`, `view`: the picked ids.
 */
export const SCOPE_KINDS = [
  'due',
  'tracked',
  'all',
  'project',
  'pages',
  'group',
  'cluster',
  'topic',
  'view'
] as const

export type ScopeKind = (typeof SCOPE_KINDS)[number]

export interface Scope {
  kind: ScopeKind
  /** Picked ids for `pages`, `group`, `cluster`, `topic`, `view`. Empty for the others. */
  ids: readonly string[]
}

/** One page a scope can pick (from `allpages:list`). */
export interface ScopePage {
  id: string
  url: string
  /** Label, else title, else the path. */
  label: string
  folder: string | null
  status: PageStatus
  /** Tracked, setting up or paused: a page CiteFox checks or has checked. */
  tracked: boolean
  groupIds: readonly string[]
  clusterIds: readonly string[]
  marketIds: readonly string[]
  promptCount: number
  samples: number
  /** ISO-8601 UTC. Null when not scheduled. */
  nextCheckAt: string | null
  score: number | null
  /** Prompts citing the page in its latest check, default market. Null before one. */
  pageCited: number | null
  /** Prompts with an AI Overview in that check. */
  aioPrompts: number | null
}

/** A named set of pages: a group, a cluster, a topic or a saved view. */
export interface ScopeSet {
  id: string
  name: string
  kind: 'group' | 'cluster' | 'topic' | 'view'
  /** Pages in it (a topic counts its questions instead and has no pages). */
  count: number
  /** Questions in a topic (topics are checked as their own subject). */
  questions?: number
  /** A saved view's filter, opaque here; the Export screen resolves it. */
  filter?: unknown
}

/** Everything the scope pickers can offer for one project. */
export interface ScopeOptions {
  projectId: string
  domain: string
  pages: readonly ScopePage[]
  groups: readonly ScopeSet[]
  clusters: readonly ScopeSet[]
  topics: readonly ScopeSet[]
  views: readonly ScopeSet[]
  markets: readonly Market[]
  defaultMarketId: string | null
  /** Searches left this month. Null when unknown. */
  searchesLeft: number | null
  /**
   * The All pages rows the pages came from (removed pages left out), so a
   * saved view's filter can be run with All pages' own columns. Unset in tests.
   */
  rows?: readonly AllPageRow[]
}

/** One row an `ItemPicker` lists. */
export interface PickerItem {
  id: string
  label: string
  /** A second line or a right-hand note: a path, "12 pages", "Tracked". */
  detail?: string
  /** A full URL shown with copy/open (pages). */
  url?: string
  /** Greyed and not pickable, with the reason as its title. */
  disabledReason?: string
}

/** A search estimate: the fewest and most searches a check can use. */
export interface SearchEstimate {
  min: number
  max: number
  pages: number
}
