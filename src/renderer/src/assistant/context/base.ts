import { drawerOwnedKeys } from '../../shell/drawerUrl'
import { PAGE_TABS, sectionHeading, type ShellLocation } from '../../shell/routes'
import type { AiContextBase } from './types'

/** Topic results tab names, as the tab bar shows them. */
const TOPIC_TAB_LABELS: Readonly<Record<string, string>> = {
  tree: 'Tree',
  grid: 'Grid',
  list: 'List',
  pages: 'Pages',
  progress: 'Progress'
}

/** Query keys that are never filters (ids of what is open, or noise). */
const NOT_FILTERS = new Set(['market', 'run', 'filter', 'panel', 'page', 'q', 'row', 'fix'])

/** The screen id for a route: `overview`, `page.results`, `topic.tree`, `prompt`. */
export function aiScreenId(location: ShellLocation): string {
  switch (location.kind) {
    case 'section':
      return location.section
    case 'page':
      return `page.${location.tab}`
    case 'read':
      return 'page.read'
    case 'running':
      return 'page.running'
    case 'prompt':
      return 'prompt'
    case 'topic':
      return `topic.${location.tab}`
  }
}

export function aiScreenLabel(location: ShellLocation): string {
  switch (location.kind) {
    case 'section':
      return sectionHeading(location.section)
    case 'page':
      return PAGE_TABS.find((tab) => tab.id === location.tab)?.label ?? 'Page'
    case 'read':
      return 'Page read'
    case 'running':
      return 'Checking'
    case 'prompt':
      return 'Question detail'
    case 'topic':
      return `Topic · ${TOPIC_TAB_LABELS[location.tab ?? 'list'] ?? 'List'}`
  }
}

/**
 * The visible filters in a hash: the screen's own query values, without the
 * drawers' keys and without ids. A comma list of picked rows becomes a count.
 */
export function aiFiltersFromHash(hash: string): Record<string, string> {
  const plain = hash.startsWith('#') ? hash.slice(1) : hash
  const at = plain.indexOf('?')
  if (at < 0) return {}
  const params = new URLSearchParams(plain.slice(at + 1))
  const owned = drawerOwnedKeys(params)
  const out: Record<string, string> = {}
  params.forEach((value, key) => {
    if (owned.has(key) || NOT_FILTERS.has(key) || value.length === 0) return
    if (key === 'pick' || key.endsWith('.pick')) {
      const count = value.split(',').filter(Boolean).length
      out.picked = `${count} ${count === 1 ? 'row' : 'rows'}`
      return
    }
    out[key] = value.slice(0, 80)
  })
  return out
}

/** The route part of the context, from what the shell already knows. */
export function aiBaseFor(input: {
  location: ShellLocation
  hash: string
  projectId: string | null
  projectName: string | null
  crumbs: readonly { label: string }[]
  /** The breadcrumb's page or topic title. */
  pageName?: string | null
}): AiContextBase {
  const { location } = input
  const pageId =
    location.kind === 'page' ||
    location.kind === 'read' ||
    location.kind === 'running' ||
    location.kind === 'prompt'
      ? location.pageId
      : null
  const topicId = location.kind === 'topic' ? location.pageId : null
  const marketId =
    location.kind === 'page' || location.kind === 'prompt' || location.kind === 'topic'
      ? (location.marketId ?? null)
      : null
  const runId =
    location.kind === 'page' || location.kind === 'prompt' || location.kind === 'topic'
      ? (location.runId ?? null)
      : null
  const plain = input.hash.split('?')[0] ?? '#/'
  return {
    screen: aiScreenId(location),
    screenLabel: aiScreenLabel(location),
    route: plain.startsWith('#') ? plain : `#${plain}`,
    crumbs: input.crumbs.map((crumb) => crumb.label),
    projectId: input.projectId,
    projectName: input.projectName,
    pageId,
    topicId,
    promptId: location.kind === 'prompt' ? location.promptId : null,
    marketId,
    runId,
    filters: aiFiltersFromHash(input.hash),
    pageName: pageId !== null || topicId !== null ? (input.pageName ?? null) : null
  }
}
