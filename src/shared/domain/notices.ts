/**
 * "Ask me" notices (FR-11.4, FR-11.7). When a project rule says to wait for the
 * user, the main process records one notice with the choices it can apply, and
 * the renderer shows it. Resolving a notice runs the chosen action in the engine.
 * `kind` is open: an area adds a kind by registering its actions in main.
 */

/** One choice on a notice. `id` is what `notices:resolve` sends back. */
export interface NoticeAction {
  id: string
  label: string
  /** The suggested choice. At most one per notice. */
  primary: boolean
}

export interface Notice {
  id: string
  /** `search_cap` (FR-11.4 notify rule) or `claude_ask` (FR-11.7 ask rule) today. */
  kind: string
  /** Null for a notice outside any project. */
  projectId: string | null
  projectName: string | null
  title: string
  body: string
  actions: readonly NoticeAction[]
  /** ISO-8601 UTC. */
  createdAt: string
  /** ISO-8601 UTC. Null while the notice is open. */
  resolvedAt: string | null
  /** The action id that resolved it. Null while open. */
  resolution: string | null
}

/** FR-11.4 notify rule: the project's search cap was reached. */
export const SEARCH_CAP_NOTICE = 'search_cap'

/** FR-11.7 ask rule: the project's Claude connection hit a limit or failed. */
export const CLAUDE_ASK_NOTICE = 'claude_ask'
