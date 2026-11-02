import type { GuideSignal } from '@shared/guide'
import { parseHash, type SectionId, type ShellLocation } from '../../shell/routes'
import type { GuideScreen } from '../types'

const SECTION_SCREENS: Partial<Record<SectionId, GuideScreen>> = {
  overview: 'summary',
  topics: 'topics',
  questions: 'questions',
  competitors: 'competitors',
  citations: 'citations',
  fixes: 'fixes',
  history: 'history',
  reports: 'reports',
  alerts: 'alerts',
  settings: 'settings',
  pages: 'pages'
}

/** The guide's screen for a route, or null for screens it does not teach. */
export function screenOf(location: ShellLocation): GuideScreen | null {
  switch (location.kind) {
    case 'topic':
      return 'topic'
    case 'prompt':
      return 'prompt'
    case 'section':
      return SECTION_SCREENS[location.section] ?? null
    default:
      return null
  }
}

/** The guide's screen for a hash (`#/topics/t1?tab=stage` is `topic`). */
export function screenOfHash(hash: string): GuideScreen | null {
  return screenOf(parseHash(hash))
}

/**
 * What a route shows that the guide counts as done: a question opened, and its
 * Sources tab (`?view=sources`); a page fix opened (Fixes' `?pf=`, or the
 * `drawer=page-fix` over any screen), and its Page edits tab; a report opened
 * (`#/reports?report=<kind>`).
 */
export function routeSignals(hash: string): GuideSignal[] {
  const location = parseHash(hash)
  const params = new URLSearchParams(hash.split('?')[1] ?? '')
  const signals: GuideSignal[] = []
  if (location.kind === 'prompt') {
    signals.push('prompt-opened')
    if (params.get('view') === 'sources') signals.push('sources-viewed')
  }
  const onFixes = location.kind === 'section' && location.section === 'fixes'
  const fixOpen = (onFixes && params.has('pf')) || params.getAll('drawer').includes('page-fix')
  if (fixOpen) {
    signals.push('page-fix-opened')
    if ((onFixes && params.get('pft') === 'edits') || params.get('pfx.tab') === 'edits') {
      signals.push('page-edits-opened')
    }
  }
  if (location.kind === 'section' && location.section === 'reports' && params.get('report')) {
    signals.push('report-opened')
  }
  return signals
}

/** True when `hash` has query key `key` (any value), drawers' keys included. */
export function hasParam(hash: string, key: string): boolean {
  return new URLSearchParams(hash.split('?')[1] ?? '').has(key)
}

/** The value of query key `key` in `hash`, or null. */
export function paramOf(hash: string, key: string): string | null {
  return new URLSearchParams(hash.split('?')[1] ?? '').get(key)
}

/** True when `here` is the route `route`: the same path and the same query values, in any order. */
export function sameRoute(here: string, route: string): boolean {
  const split = (hash: string): [string, string[]] => {
    const at = hash.indexOf('?')
    const path = at < 0 ? hash : hash.slice(0, at)
    const query = at < 0 ? '' : hash.slice(at + 1)
    const pairs = [...new URLSearchParams(query).entries()].map(([key, value]) => `${key}=${value}`)
    return [path, pairs.sort()]
  }
  const [hereRoute, hereQuery] = split(here)
  const [routePath, routeQuery] = split(route)
  return hereRoute === routePath && hereQuery.join('&') === routeQuery.join('&')
}
