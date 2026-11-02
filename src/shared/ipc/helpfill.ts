/**
 * "✦ Help me fill this" (Docs/HELPFILL.md): the one helper that fills a list two
 * ways. Describe it: in-app Claude drafts rows from the user's sentence. Use your
 * own ChatGPT: main builds a prompt that already holds the project's context and
 * the reply columns, the user pastes the chatbot's answer back, and main reads it
 * into rows. Either way main merges near-duplicates (within the answer and
 * against what is tracked) and, for neutral question lists, sets aside rows that
 * name the brand. Nothing is saved: each place shows the rows in its own review
 * UI and saves only on the user's click.
 *
 * `kind` names a registered place (`questions`; later `project`, `buyers`,
 * `competitors`…). Main rejects a kind it does not know.
 */

import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'

/** Most characters of a pasted answer. */
export const HELPFILL_PASTE_MAX = 200_000

/** Most characters of the Describe sentence. */
export const HELPFILL_SENTENCE_MAX = 1000

/** Most rows one answer brings back. */
export const HELPFILL_MAX_ROWS = 500

/** Most `items` a request may send, and most characters of one. */
export const HELPFILL_ITEMS_MAX = 200
export const HELPFILL_ITEM_CHARS = 500

/** Most characters of a text answer (a rewritten section, a pitch, a summary). */
export const HELPFILL_TEXT_MAX = 8000

/**
 * Where the rows go: a page or a topic (topics are pages in storage), or the project.
 * A text kind may also name the question (`promptId`) and one more opaque id its
 * evidence needs (`subject`: a cited page's row id, a report schedule's id). Both are
 * optional, so a rows kind sends `{ pageId }` as before.
 */
export interface HelpFillScope {
  pageId: string | null
  promptId?: string | null
  subject?: string | null
}

export interface HelpFillEstimateRequest {
  kind: string
  projectId: string
}

/**
 * What the Describe card shows before anything runs. `available` is false when
 * the project has no Claude connection (no key): the card then points to the
 * free chatbot way.
 */
export interface HelpFillEstimate {
  kind: string
  available: boolean
  /** Claude calls one Describe run makes. */
  calls: number
  /** "1 Claude call · about $0.01" or "1 Claude call · on your Claude plan". */
  costText: string
  /** Why it is not available, in plain words. Null when it is. */
  reason: string | null
}

export interface HelpFillPromptRequest {
  kind: string
  projectId: string
  scope: HelpFillScope
  /** Rows to ask for. Null: the kind's default. */
  count: number | null
  /**
   * The place's own rows for a kind that works on them (Match pages: the questions in
   * the grid). Absent or empty for a kind that finds new rows.
   */
  items?: readonly string[]
}

/** The prompt for the user's own chatbot. Never holds a key, an email or a file path. */
export interface HelpFillPrompt {
  kind: string
  prompt: string
  /** The reply's header, in order (`question`, `stage`, `page`). */
  columns: readonly string[]
  /** Items already tracked that the prompt lists so they are not repeated. */
  tracked: number
}

export interface HelpFillReadRequest {
  kind: string
  projectId: string
  scope: HelpFillScope
  text: string
  /**
   * The place's own rows for a kind that works on them (Match pages: the questions in
   * the grid). Absent or empty for a kind that finds new rows.
   */
  items?: readonly string[]
}

export interface HelpFillDescribeRequest {
  kind: string
  projectId: string
  scope: HelpFillScope
  /** The user's own words ("Who is searching, and what's their problem?"). */
  sentence: string
  count: number
  /**
   * The place's own rows for a kind that works on them (Match pages: the questions in
   * the grid). Absent or empty for a kind that finds new rows.
   */
  items?: readonly string[]
}

/** One row: values by reply column id (`question`, `stage`, `page`). */
export interface HelpFillRow {
  /** Stable within one answer. */
  id: string
  /** The `### SECTION` it came from (multi-section kinds), else null. */
  section: string | null
  values: Readonly<Record<string, string>>
}

/** What the summary banner says. */
export interface HelpFillCounts {
  /** Rows read from the answer. */
  read: number
  /** Close to an item already tracked: merged into it (left out). */
  tracked: number
  /** Close to an earlier row of the same answer: merged into it. */
  repeats: number
  /** Named the brand in a neutral list: set aside. */
  setAside: number
  /** Ready for review. */
  ready: number
}

export interface HelpFillResult {
  kind: string
  rows: readonly HelpFillRow[]
  /** The rows set aside for naming the brand, so a place can still show them. */
  setAside: readonly HelpFillRow[]
  counts: HelpFillCounts
  /** "question" / "questions": the banner's noun. */
  noun: readonly [string, string]
  /** The brand named in "1 named Example Co and was set aside". Null when none is saved. */
  brand: string | null
  /** Plain warnings: no table found, columns missing. */
  warnings: readonly string[]
  /**
   * A text kind's answer, tidied (the chatbot's chatter taken out), ready for the
   * place's draft box. Absent for a rows kind. `rows` then holds it once as `text`.
   */
  text?: string
}

/**
 * New project, before the project exists: the site as typed on the form. The
 * `helpfill:setup*` channels build the one multi-section prompt (kind `project`)
 * and read its answer from these alone; no project file is opened.
 */
export interface HelpFillSetupSite {
  /** A bare host, such as `example.com`. */
  domain: string
  brandNames: readonly string[]
  /** The default market picked on the form, or null for none yet. */
  market: { country: string; language: string; location: string | null } | null
}

export interface HelpFillSetupPromptRequest {
  site: HelpFillSetupSite
}

export interface HelpFillSetupReadRequest {
  site: HelpFillSetupSite
  text: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const helpFillChannels = {
  'helpfill:estimate': invokeWith<HelpFillEstimateRequest, HelpFillEstimate>(),
  'helpfill:prompt': invokeWith<HelpFillPromptRequest, HelpFillPrompt>(),
  'helpfill:read': invokeWith<HelpFillReadRequest, HelpFillResult>(),
  'helpfill:describe': invokeWith<HelpFillDescribeRequest, HelpFillResult>(),
  /** "Read my website" on New project: is Claude set up, and what one read costs. */
  'helpfill:setupEstimate': invoke<HelpFillEstimate>(),
  'helpfill:setupPrompt': invokeWith<HelpFillSetupPromptRequest, HelpFillPrompt>(),
  'helpfill:setupRead': invokeWith<HelpFillSetupReadRequest, HelpFillResult>()
} as const satisfies InvokeChannelSpecs
