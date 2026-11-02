import { isMatchState, isTopicPromptKind, isTopicStage, type TopicPromptKind } from '@shared/domain'
import {
  drawerStack,
  screenHash,
  screenQuery,
  withDrawerOpened,
  withDrawerStack,
  type DrawerId
} from '../../shell/drawerUrl'
import { patchHashQuery } from '../../utils/hashQuery'
import { DRILL_KEYS, parseDrill } from './model/drill'
import { resultOfTopicState } from './model/results'
import type { TreeMode } from './model/tree'
import type { SearchFilter } from './model/types'

/**
 * The topic and Questions screens keep everything in the URL (owner rule "every state
 * has a URL"): `view` (useScreenView), the Questions/Keywords filter `type`, the search
 * text `q`, the tree's grouping `tree`, the list page `p`, the picked rows `sel`, and a
 * drill's filters (`stage`, `result`, `work`, `words`, `page`, `site`, `source`), which
 * are its drawer's values (`drawer=search-drill&stage=problem`).
 */

export const TOPIC_VIEWS = ['list', 'tree', 'grid', 'pages', 'progress'] as const
export type TopicView = (typeof TOPIC_VIEWS)[number]

export const QUESTIONS_VIEWS = ['list', 'tree', 'grid', 'pages'] as const
export type QuestionsScreenView = (typeof QUESTIONS_VIEWS)[number]

export interface ViewQuery {
  /** Questions or keywords only; null shows both. */
  type: TopicPromptKind | null
  q: string
  tree: TreeMode
  /** 1-based list page. */
  page: number
  /** Picked rows in the List view (prompt ids). */
  sel: readonly string[]
  /** The drill's filters, without the Questions/Keywords `type` (that is the segment). */
  drill: SearchFilter
}

/** The screen's own keys; the drill's are its drawer's (`drawer=search-drill`). */
export const VIEW_QUERY_KEYS = ['type', 'q', 'tree', 'p', 'sel'] as const

/**
 * The Questions screen's List has its own `result` and `source` filters, so its drill
 * keys carry a prefix (`d.result=not_cited`). `type` means the same on both and is shared.
 */
export const QUESTIONS_DRILL_PREFIX = 'd.'

/** The drawer that lists the searches behind a count (shell/drawerUrl). */
export const SEARCH_DRILL = 'search-drill' satisfies DrawerId

function drillKey(key: string, prefix: string): string {
  return key === 'type' ? key : `${prefix}${key}`
}

export function parseViewQuery(params: URLSearchParams, prefix = ''): ViewQuery {
  const type = params.get('type')
  const drill = parseDrill(prefix === '' ? params : unprefixed(params, prefix))
  delete drill.kind
  const page = Number(params.get('p'))
  return {
    type: type !== null && isTopicPromptKind(type) ? type : null,
    q: (params.get('q') ?? '').slice(0, 200),
    tree: params.get('tree') === 'result' ? 'result' : 'stage',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    sel: (params.get('sel') ?? '').split(',').filter((id) => id !== ''),
    drill
  }
}

/** A drill shows when any filter other than the Questions/Keywords segment is set. */
export function isDrillQuery(query: ViewQuery): boolean {
  return Object.values(query.drill).some((value) => value !== undefined)
}

/** The drill keys of a prefixed URL under their own names, for `parseDrill`. */
function unprefixed(params: URLSearchParams, prefix: string): URLSearchParams {
  const out = new URLSearchParams()
  for (const key of DRILL_KEYS) {
    const value = params.get(drillKey(key, prefix))
    if (value !== null) out.set(key, value)
  }
  return out
}

/**
 * The drill from its drawer's values. Its Questions/Keywords filter is the drawer's own
 * `kind`, so the view's segment (`type`) behind it never changes.
 */
export function drawerDrill(
  values: Readonly<Record<string, string>> | undefined,
  prefix = ''
): SearchFilter {
  const params = new URLSearchParams()
  if (!values) return parseDrill(params)
  for (const key of DRILL_KEYS) {
    const value = values[key === 'type' ? `${prefix}kind` : drillKey(key, prefix)]
    if (value) params.set(key, value)
  }
  return parseDrill(params)
}

/** The drill drawer's values for a filter: each drill key, prefixed on Questions. */
export function drillValues(filter: SearchFilter, prefix = ''): Record<string, string | null> {
  const values: Record<string, string | null> = {
    kind: filter.kind ?? null,
    stage: filter.stage ?? null,
    result: filter.result ?? null,
    work: filter.work ? '1' : null,
    words: filter.words ?? null,
    page: filter.page ?? null,
    site: filter.site ?? null,
    source: filter.source ?? null
  }
  const out: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(values)) out[drillKey(key, prefix)] = value
  return out
}

/**
 * Where a count goes: the screen exactly as it is (view, segment, search, scroll), with
 * the drill's drawer open over it.
 */
export function drillDrawerHash(hash: string, filter: SearchFilter, prefix = ''): string {
  return withDrawerOpened(hash, SEARCH_DRILL, drillValues(filter, prefix))
}

/** `hash` with the drill's drawer closed (any drawer under or over it stays). */
export function withoutDrillDrawer(hash: string): string {
  return withDrawerStack(
    hash,
    drawerStack(hash).filter((entry) => entry.id !== SEARCH_DRILL)
  )
}

/**
 * A link from before the drill drawer (`#/topics/t1?stage=problem&result=not_cited`, the
 * Topics dashboard's `#/questions?d.result=not_cited`): the screen's drill keys move into
 * the drawer. Null when the screen has none.
 */
export function legacyDrillHash(hash: string, prefix = ''): string | null {
  const at = hash.indexOf('?')
  if (at < 0) return null
  const screen = screenQuery(new URLSearchParams(hash.slice(at + 1)))
  const keys = DRILL_KEYS.filter((key) => key !== 'type').map((key) => drillKey(key, prefix))
  if (!keys.some((key) => screen.has(key))) return null
  const stack = drawerStack(hash)
  const values: Record<string, string> = {}
  const cleared: Record<string, null> = {}
  for (const key of keys) {
    const value = screen.get(key)
    if (value) values[key] = value
    cleared[key] = null
  }
  const plain = withDrawerStack(patchHashQuery(screenHash(hash), cleared), stack)
  return withDrawerOpened(plain, SEARCH_DRILL, values)
}

/**
 * The patch that turns a URL from before the views (`tab=todo|stage|keywords|progress`,
 * `filter=stage:…|state:…|group:…`) into the new one, or null when there is nothing to
 * change. `filter=target:<id>` is left alone: it opens Change target page.
 */
export function legacyTopicPatch(params: URLSearchParams): Record<string, string | null> | null {
  const tab = params.get('tab')
  const filter = params.get('filter')
  if (tab === null && (filter === null || filter.startsWith('target:'))) return null
  const patch: Record<string, string | null> = { tab: null }
  if (tab === 'stage') patch.view = 'grid'
  else if (tab === 'progress') patch.view = 'progress'
  else if (tab === 'keywords') {
    patch.view = 'tree'
    patch.type = 'keyword'
  } else if (tab === 'todo') patch.view = 'tree'
  if (filter !== null && !filter.startsWith('target:')) {
    patch.filter = null
    const [kind, value = ''] = filter.split(':')
    if (kind === 'stage' && isTopicStage(value)) patch.stage = value
    else if (kind === 'state' && isMatchState(value)) patch.result = resultOfTopicState(value)
    else if (kind === 'group') patch.type = 'keyword'
  }
  return patch
}
