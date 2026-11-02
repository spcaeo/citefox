/**
 * The Fixes screen's views and their route keys. Every state is in the hash query:
 *
 * - `view`: `todo` (What to fix, the default, left out), `log` (Changes made),
 *   `changes` (Did it work?), and the views reached from a link with a back link:
 *   `round` (Next round), `backlinks` and `lost` (Lost ground).
 * - What to fix: `topic` (one topic's or tracked page's searches), `kind` (one kind
 *   of fix), `by` (`kind` default, `page`, `topic`), `nothing=open` (Nothing to do
 *   now unfolded), `more` (the kinds whose "Show N more" is open, comma list),
 *   `pf` (the page fix whose drawer is open), `state` (the Status filter: `new`,
 *   `brief`, `logged`), `todo.q` and `todo.sort` (search and sort, the grid's own keys).
 * - Next round: `draft` (the page whose fix is being drafted), `owner` (the step
 *   whose owner is being renamed), `index=confirm` (the "Check index" confirm).
 * - Did it work?: `show` (the ledger filter), `row` (the change whose detail is open).
 * - Changes made: `status`, `page` (see `FIXES_QUERY`). An open fix is the fix drawer's
 *   own `drawer=fix&fix=<id>`, never a screen key.
 * - Lost ground: `lost` (the page), `vs` (the older check), `plan=edit`.
 */

export const FIXES_VIEWS = ['todo', 'log', 'changes', 'round', 'backlinks', 'lost'] as const

export type FixesView = (typeof FIXES_VIEWS)[number]

/** The views with a tab. The rest are reached from a link and have a back link. */
export type FixesTab = Extract<FixesView, 'todo' | 'log' | 'changes'>

export const FIXES_TABS: readonly { id: FixesTab; label: string }[] = [
  { id: 'todo', label: 'What to fix' },
  { id: 'log', label: 'Changes made' },
  { id: 'changes', label: 'Did it work?' }
]

export function isFixesTab(view: FixesView): view is FixesTab {
  return FIXES_TABS.some((tab) => tab.id === view)
}

/** The tab a tabless view sits under: Next round, Backlinks and Lost ground belong to Did it work?. */
export function tabOf(view: FixesView): FixesTab {
  return isFixesTab(view) ? view : 'changes'
}

export const SCREEN_QUERY = [
  'view',
  'topic',
  'kind',
  'by',
  'nothing',
  'more',
  'pf',
  'pft',
  'draft',
  'owner',
  'index',
  'show',
  'row',
  'lost',
  'vs',
  'plan',
  'status',
  'page',
  'state'
] as const

export type ScreenKey = (typeof SCREEN_QUERY)[number]

export function fixesView(value: string | null): FixesView {
  return FIXES_VIEWS.find((view) => view === value) ?? 'todo'
}

/**
 * The patch that opens a view: its own keys cleared, `todo` left out of the URL. The
 * topic filter stays: it is the screen's, not one view's.
 */
export function viewPatch(view: FixesView): Partial<Record<ScreenKey, string | null>> {
  const patch: Partial<Record<ScreenKey, string | null>> = {}
  for (const key of SCREEN_QUERY) if (key !== 'topic') patch[key] = null
  patch.view = view === 'todo' ? null : view
  return patch
}

/** What to fix, optionally for one topic or tracked page (`#/fixes?topic=<id>`). */
export function fixesTodoHash(options: { topic?: string | null; pf?: string | null } = {}): string {
  const params = new URLSearchParams()
  if (options.topic) params.set('topic', options.topic)
  if (options.pf) params.set('pf', options.pf)
  const query = params.toString()
  return query ? `#/fixes?${query}` : '#/fixes'
}

/** The Did it work? view with one change's detail open. */
export function changeRowHash(fixId: string): string {
  return `#/fixes?view=changes&row=${encodeURIComponent(fixId)}`
}

/** Lost ground for a page, against the check `vsRunId` (default: the one before the latest). */
export function lostHash(pageId: string, vsRunId: string | null = null): string {
  const params = new URLSearchParams({ view: 'lost', lost: pageId })
  if (vsRunId) params.set('vs', vsRunId)
  return `#/fixes?${params.toString()}`
}

/** Writes screen keys to the route (see `useHashQuery`). */
export type SetScreenQuery = (
  patch: Partial<Record<ScreenKey, string | null>>,
  options?: { replace?: boolean }
) => void
