import type { ReactNode } from 'react'
import type { HelpFillBot, HelpFillWay } from '@shared/helpfill'
import type {
  HelpFillDescribeRequest,
  HelpFillEstimate,
  HelpFillEstimateRequest,
  HelpFillPrompt,
  HelpFillPromptRequest,
  HelpFillReadRequest,
  HelpFillResult,
  HelpFillScope
} from '@shared/ipc'

export type { HelpFillBot, HelpFillWay }

/** The four channels the helper uses. Production passes the preload bridge; tests a fake. */
export interface HelpFillSource {
  'helpfill:estimate'(request: HelpFillEstimateRequest): Promise<HelpFillEstimate>
  'helpfill:prompt'(request: HelpFillPromptRequest): Promise<HelpFillPrompt>
  'helpfill:read'(request: HelpFillReadRequest): Promise<HelpFillResult>
  'helpfill:describe'(request: HelpFillDescribeRequest): Promise<HelpFillResult>
}

/**
 * A quick-start chip under the Describe box. `text` is put in the box (a second
 * press takes it out again); `onPick` runs a place's own action instead, such as
 * adding Google's "People also ask" to the review list.
 */
export interface HelpFillChip {
  id: string
  label: string
  text?: string
  onPick?: () => void
  /** Shown pressed (an `onPick` chip whose list is open). */
  pressed?: boolean
}

/** The words of the Describe way for one place. */
export interface HelpFillDescribeCopy {
  /** The question-style label: "Who is searching, and what's their problem?" */
  label: string
  placeholder?: string
  chips?: readonly HelpFillChip[]
  /** Count choices; omit for no count select. */
  counts?: readonly number[]
  defaultCount?: number
  /** "Write 10 questions". */
  buttonLabel: (count: number) => string
}

/** The words of the chatbot way for one place. */
export interface HelpFillChatbotCopy {
  /** "Paste the CSV or table ChatGPT gave you…" (the bot's name is filled in). */
  pastePlaceholder?: (botName: string) => string
  /** A tip in the paste step, such as "Perplexity is best for competitors: it searches the web." */
  tip?: ReactNode
  /** Rows the prompt asks for. Null: the kind's default. */
  count?: number | null
}

/** A way card's own words, for a place that is not a list ("✦ Draft it for me"). */
export interface HelpFillWayCopy {
  title?: string
  text?: string
}

export interface HelpFillWaysCopy {
  describe?: HelpFillWayCopy
  chatbot?: HelpFillWayCopy
}

export interface HelpFillProps {
  /** The registered kind in main (`questions`). */
  kind: string
  projectId: string
  scope: HelpFillScope
  /**
   * The place's own rows for a kind that works on them (Match pages: the grid's
   * questions). The prompt is written again when they change.
   */
  items?: readonly string[]
  source: HelpFillSource
  /** `help=` on the URL; null: the helper picks (Describe when Claude is set up). */
  way: HelpFillWay | null
  onWay: (way: HelpFillWay) => void
  /** `bot=` on the URL; null: the one this person used last, else ChatGPT. */
  bot: HelpFillBot | null
  onBot: (bot: HelpFillBot) => void
  describe: HelpFillDescribeCopy
  chatbot?: HelpFillChatbotCopy
  /** The way cards' words. Default: "✦ Describe it" and "Use your own ChatGPT". */
  ways?: HelpFillWaysCopy
  /**
   * Offer one way only, with no way cards: `describe` for a place with no chatbot
   * way (an alert rule), `chatbot` where in-app Claude already has its own button
   * (the report summary's AI menu). The URL's way is then ignored.
   */
  only?: HelpFillWay
  /**
   * The banner after an answer ("Read 15 rows… 12 are ready."). Default true. A place
   * that says what happened in its own words (an alert rule: "Filled in below.") turns
   * it off; errors still show.
   */
  banner?: boolean
  /**
   * Rows from either way, after main merged near-duplicates and set aside rows
   * naming the brand. The place shows them in its own review UI; nothing is saved here.
   */
  onRows: (result: HelpFillResult, way: HelpFillWay) => void
  disabled?: boolean
  /** Opens a link in the browser. Default: the app's safe path (`window.open`, main opens it). */
  openLink?: (url: string) => void
  /** Prefix for the test ids (`hf`). */
  testId?: string
}
