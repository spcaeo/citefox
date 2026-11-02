import type { TopicStage } from '@shared/domain'
import type { ImportRowCheck } from '@shared/ipc'

/** Page | Topic: where the questions go. */
export type TargetKind = 'page' | 'topic'

/** The ways in (AddQuestions.dc.html), `tab=` on the drawer's URL. */
export type AddTab = 'type' | 'import' | 'suggest' | 'tracked'

export const ADD_TABS: readonly AddTab[] = ['type', 'import', 'suggest', 'tracked']

/** The id of a tab and of its panel (`aria-controls`, `aria-labelledby`). */
export function tabId(tab: AddTab): string {
  return `aq-tab-${tab}`
}

export function panelId(tab: AddTab): string {
  return `aq-panel-${tab}`
}

export function isAddTab(value: string | null | undefined): value is AddTab {
  return value === 'type' || value === 'import' || value === 'suggest' || value === 'tracked'
}

/** Where a row came from: typed or pasted, a suggestion, an imported file, or a tracked question. */
export type RowOrigin = 'typed' | 'suggested' | 'imported' | 'tracked'

/** One row of the grid: a question with its own stage, page and (expert) market and tags. */
export interface DraftRow {
  key: string
  question: string
  /** A stage id, or '' for none. */
  stage: TopicStage | ''
  /** The page to be cited: a URL or a path on the site, or '' for the default page. */
  page: string
  /** A market id of the project, or '' (every market of the page or topic). */
  market: string
  tags: string
  /** A topic named in a file's Topic column, or '' (the page or topic picked). */
  topic: string
  /** "Create it": the Topic cell names a topic that does not exist yet. */
  createTopic: boolean
  /** "Add it": the row's market is added to the page or topic it goes to. */
  addMarket: boolean
  /** "Keep both": a similar row is added next to the tracked one. */
  keep: boolean
  origin: RowOrigin
}

/** A row's live check, or null while it is being checked (or empty). */
export type RowCheck = ImportRowCheck

/** One drafted question (✦ Help me write, Seen on Google, Missing from this topic). */
export interface Suggestion {
  id: string
  text: string
  stage: TopicStage | ''
  /** The page to be cited the answer named (a path or URL), or '' / unset for the default. */
  page?: string
}

/** What the footer counts: the rows that are added and the ones that are not. */
export interface RowCounts {
  /** New questions and keywords, and similar rows kept. */
  add: number
  /** How many of `add` are keywords (short phrases on a topic). */
  keywords: number
  duplicates: number
  /** Similar rows waiting for "keep both / use tracked". */
  decide: number
  fix: number
  /** Rows typed but not checked yet. */
  pending: number
}
