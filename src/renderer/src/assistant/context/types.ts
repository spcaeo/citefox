/**
 * What Ask CiteFox and the ✦ menus know about the screen you are on
 * (deep audit crosscut §3.2). The shell fills the route part (screen, crumbs,
 * ids); each screen and drawer adds what only it knows with one
 * `useAiContext` call: names, the picked rows, filters and the numbers it
 * shows. KPI tiles add their own numbers. Only ids, names, counts and short
 * texts go in: never a key, an email or a file path.
 */

/** Things a screen can name. */
export type AiEntityKind =
  | 'project'
  | 'page'
  | 'topic'
  | 'question'
  | 'market'
  | 'check'
  | 'competitor'
  | 'domain'
  | 'fix'
  | 'kpi'
  | 'chart'
  | 'section'
  | 'setting'
  | 'template'
  | 'report'
  | 'community'
  | 'video'
  | 'group'
  | 'alert'
  | 'connection'

export interface AiEntityRef {
  kind: AiEntityKind
  /** Opaque id when the thing has one (a prompt id, a page id). */
  id?: string | null
  /** Its name or text as the screen shows it. */
  label: string
  /** A short extra line: "Not cited · Compare", "7 of 10". */
  detail?: string | null
}

/** A number the screen shows, such as the Cited tile. */
export interface AiNumber {
  label: string
  /** The value as shown: "7 of 10", "70%". */
  value: string
  /** The drill id the number opens, when it has one. */
  drill?: string | null
}

/** App actions an answer may offer on this screen (always confirmed with a click). */
export type AiActionKind =
  'add-questions' | 'create-topic' | 'draft-fix' | 'set-target' | 'open-drill' | 'start-check'

/** A screen's (or drawer's) own part of the context. Every field is optional. */
export interface AiContextPatch {
  /** Overrides the route's screen id, such as `drawer.add-questions`. */
  screen?: string
  /** Overrides the route's screen name, such as "Add questions". */
  screenLabel?: string
  pageId?: string | null
  topicId?: string | null
  promptId?: string | null
  marketId?: string | null
  runId?: string | null
  /** Names behind the ids: the page, the topic, the market, the check date. */
  entities?: readonly AiEntityRef[]
  /** Ticked rows. */
  selection?: readonly AiEntityRef[]
  /** Visible filters, sort and period: `{ status: 'Not cited', period: '30 days' }`. */
  filters?: Readonly<Record<string, string>>
  numbers?: readonly AiNumber[]
  /** Short facts already on screen, for screens without data numbers (settings). */
  facts?: readonly string[]
  capabilities?: readonly AiActionKind[]
}

/** The merged context the assistant reads. */
export interface AiContext {
  /** `overview`, `questions`, `topic.todo`, `page.results`, `prompt`, `drawer.drill`… */
  screen: string
  /** "Topics", "Results", "Add questions". */
  screenLabel: string
  /** The current hash with the drawers taken off (opaque ids only). */
  route: string
  /** "Example Co", "Topics", "Replacing a carrier gateway". */
  crumbs: readonly string[]
  projectId: string | null
  projectName: string | null
  pageId: string | null
  topicId: string | null
  promptId: string | null
  marketId: string | null
  runId: string | null
  entities: readonly AiEntityRef[]
  selection: readonly AiEntityRef[]
  filters: Readonly<Record<string, string>>
  numbers: readonly AiNumber[]
  facts: readonly string[]
  capabilities: readonly AiActionKind[]
}

/** The route part the shell fills. */
export interface AiContextBase {
  screen: string
  screenLabel: string
  route: string
  crumbs: readonly string[]
  projectId: string | null
  projectName: string | null
  pageId: string | null
  topicId: string | null
  promptId: string | null
  marketId: string | null
  runId: string | null
  filters: Readonly<Record<string, string>>
  /**
   * The open page's or topic's name exactly as the breadcrumb shows it. The
   * "Page:" / "Topic:" chip uses it, so a page labelled "Alerts" whose title is
   * "Text alerts for business" reads the same in the chip and the breadcrumb.
   */
  pageName?: string | null
}

/** Limits from the privacy rule (crosscut §3.2). */
export const AI_CONTEXT_LIMITS = {
  text: 300,
  entities: 50,
  numbers: 30,
  facts: 12
} as const
