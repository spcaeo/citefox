import type { PromptCheckRow } from '@shared/domain'
import type { MenuItem } from '../ui/Menu'
import type { PageTabId, TopicTabId } from '../shell/routes'
import type { DrawerId, DrawerParamPatch } from '../shell/drawerUrl'

/**
 * Where a drill row, or a number that stands for a single item, goes.
 * A prompt opens Prompt detail in that market and check; a page opens a page
 * tab; a URL opens in the browser; a hash is any other in-app route.
 */
export type DrillTarget =
  | {
      kind: 'prompt'
      pageId: string
      promptId: string
      marketId?: string | null
      runId?: string | null
      /** The page's project when it may not be the open one: the link switches first. */
      projectId?: string | null
    }
  | {
      kind: 'page'
      pageId: string
      tab?: PageTabId
      marketId?: string | null
      runId?: string | null
      /** The page's project when it may not be the open one: the link switches first. */
      projectId?: string | null
    }
  | {
      /** Topic results, optionally on a tab with a drill focus (`stage:`, `group:`, `state:`). */
      kind: 'topic'
      topicId: string
      tab?: TopicTabId
      filter?: string | null
      marketId?: string | null
      runId?: string | null
      projectId?: string | null
    }
  | { kind: 'url'; url: string }
  | { kind: 'hash'; hash: string }
  /** Another drawer over this one (a page fix, a logged fix), so the screen stays put. */
  | { kind: 'drawer'; id: DrawerId; values?: DrawerParamPatch }

/** What the drawer's rows belong to: shown in its head, used for row links and the CSV. */
export interface DrillScope {
  /** Prompt rows open Prompt detail on this page. Null: prompt rows do not link. */
  pageId: string | null
  /** The market the rows come from. Null is the page's default market. */
  marketId: string | null
  /** The check the rows come from. Null is the latest check. */
  runId: string | null
  /** Such as "🇺🇸 US · EN". Empty hides it. */
  marketLabel: string
  /** Such as "Oct 3, 2026". Empty hides it. */
  checkDateLabel: string
  /** Brand looked for, for the "Named" note. */
  brand: string
  /** Own domain, for the "Position" note. */
  domain: string
}

/** A non-prompt drawer column, filled from `DrillItem.cells`. */
export interface DrillItemColumn {
  id: string
  label: string
  align?: 'start' | 'end'
  /** CSS grid track. Default `minmax(72px, 0.6fr)`. */
  width?: string
}

/** One row of a non-prompt drawer: a link, a claim, a page, a domain, a check. */
export interface DrillItem {
  id: string
  /** First column. Plain text, such as a URL, a claim, a page path or a domain. */
  primary: string
  /** Draw `primary` in the mono face (URLs, domains, paths). */
  mono?: boolean
  /** An http(s) URL that `primary` links to, opened in the browser. */
  url?: string | null
  /** A second line under `primary`. Plain text. */
  secondary?: string | null
  /** Where the row opens on click or Enter. None: the row does not open. */
  target?: DrillTarget | null
  /** Values for the drawer's `columns`, by column id. */
  cells?: Readonly<Record<string, string | number | null>>
  /** Longer text the row expands to. Markdown, drawn with the safe Markdown component. */
  detail?: string | null
  /** Summary-strip group this item counts in, such as `this_page` or `other_own`. */
  group?: string
  /** Row actions behind the row's `⋯` (a question row: Edit, Pause, Remove). */
  menu?: () => readonly MenuItem[]
}

interface DrillBase {
  /** The NFR-14 id: the same as the clicked control's `data-nfr-drill`, such as `bucket:winning`. */
  id: string
  title: string
  /** Markdown under the title. */
  description: string
  /** True when `title` already states the count in its own words. */
  omitCount?: boolean
  /** One line that stands out in these rows, from stored data only. Null or unset hides it. */
  insight?: string | null
  scope: DrillScope
}

/** Prompts behind a number (REPORT-SPEC "Interaction model"). */
export interface PromptDrill extends DrillBase {
  kind: 'prompts'
  rows: readonly PromptCheckRow[]
}

/** Links, claims, pages, domains or checks behind a number. */
export interface ItemDrill extends DrillBase {
  kind: 'items'
  /** Row noun, singular and plural, such as ['link', 'links']. */
  noun: readonly [string, string]
  /** Header of the first column, such as "Link". */
  primaryLabel: string
  columns?: readonly DrillItemColumn[]
  items: readonly DrillItem[]
  /**
   * Summary strip parts. Each counts the items whose `group` matches, so the
   * strip always adds up to the list. Selecting a part filters the list.
   */
  summary?: readonly { label: string; group: string }[]
  /** Small print under the list. */
  note?: string
}

/**
 * One question or keyword in a topic drawer (Topic-Drill.png). `page` is the
 * own page cited, or the target page when none is cited.
 */
export interface TopicDrillRow {
  promptId: string
  /** Such as "Q6" or "K12". */
  label: string
  text: string
  /** Stage label, such as "Compare". Empty for keywords without a stage. */
  stage: string
  /** `right_page`, `other_page`, `not_cited`, `no_page` or `no_aio`. */
  matchState: string
  page: string | null
  position: number | null
  /** Other domains the overview cited, in order. */
  citedDomains: readonly string[]
  aio: boolean
  named: boolean | null
  aioSummary: string | null
  /** 0–100 ranking aid, for rows not cited. */
  winOdds: number | null
  /** Why the odds are what they are, in one plain sentence (saved data). */
  reason: string | null
}

/** Questions or keywords of a topic behind a number (topic, stage, group, match state). */
export interface TopicDrill extends DrillBase {
  kind: 'topic'
  topicId: string
  /** Project of the topic, for Explain and row links. */
  projectId: string
  /** Row noun, such as ['question', 'questions']. */
  noun: readonly [string, string]
  /** `cited` lists the cited page and position; `todo` the target page and who is cited instead. */
  view: 'cited' | 'todo'
  rows: readonly TopicDrillRow[]
  /** Up to four small tiles above the list, such as Right page 9 · Avg position 2.3. */
  tiles: readonly { label: string; value: string }[]
  /** One line from saved data under the tiles. Null hides it. */
  insight: string | null
}

/** The drills the list drawer draws. Topic drills have their own drawer (TopicDrillDrawer). */
export type ListDrill = PromptDrill | ItemDrill

export type DrillRequest = ListDrill | TopicDrill

/** The number a drill stands for. Drill buttons show this, so the drawer total always matches. */
export function drillCount(drill: DrillRequest): number {
  return drill.kind === 'items' ? drill.items.length : drill.rows.length
}

/** The row noun for a drill, singular and plural. */
export function drillNoun(drill: DrillRequest): readonly [string, string] {
  return drill.kind === 'prompts' ? ['question', 'questions'] : drill.noun
}
