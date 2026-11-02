import { createContext } from 'react'
import type { DrawerCrumb } from '../ui'
import { breadcrumbFor } from './breadcrumb'
import { drawerKind, type DrawerEntry } from './drawerUrl'
import {
  PAGE_TABS,
  pageHash,
  promptHash,
  sectionHash,
  topicHash,
  type ShellLocation
} from './routes'

/**
 * A crumb of the route under the drawers. `screen` marks the screen itself:
 * selecting it closes the drawers and lands back on it (no new history entry).
 */
export interface RouteCrumb {
  label: string
  href: string
  screen?: boolean
}

/**
 * The trail of the route the drawers open over: project › section › entity
 * (Docs/DRAWER.md). Every crumb links somewhere; the last is the screen.
 * The top bar's breadcrumb (`breadcrumbFor`) is the source, with the links it
 * leaves out filled in (a topic's "Topics", a page's tab).
 */
export function drawerRouteCrumbs(
  location: ShellLocation,
  projectName: string | null,
  pageLabel: string | null
): RouteCrumb[] {
  const base = breadcrumbFor(location, projectName, pageLabel)
  const project = projectName && base[0]?.label === projectName && base[0].href ? [base[0]] : []
  const lead: RouteCrumb[] = project.map((item) => ({ label: item.label, href: item.href ?? '#/' }))
  switch (location.kind) {
    case 'section': {
      return base.map((item, index) => ({
        label: item.label,
        href:
          index === base.length - 1
            ? sectionHash(location.section)
            : (item.href ?? sectionHash(location.section)),
        ...(index === base.length - 1 ? { screen: true } : {})
      }))
    }
    case 'topic':
      return [
        ...lead,
        { label: 'Topics', href: sectionHash('topics') },
        { label: pageLabel ?? 'Topic', href: topicHash(location.pageId), screen: true }
      ]
    case 'prompt':
      return [
        ...lead,
        { label: pageLabel ?? 'Page', href: pageHash(location.pageId) },
        { label: 'Question', href: promptHash(location.pageId, location.promptId), screen: true }
      ]
    case 'page': {
      const tab = PAGE_TABS.find((item) => item.id === location.tab)?.label ?? 'Results'
      return [
        ...lead,
        { label: pageLabel ?? 'Page', href: pageHash(location.pageId) },
        { label: tab, href: pageHash(location.pageId, location.tab), screen: true }
      ]
    }
    default:
      return base.map((item, index) => ({
        label: item.label,
        href:
          item.href ??
          (location.kind === 'read' || location.kind === 'running'
            ? pageHash(location.pageId)
            : '#/'),
        ...(index === base.length - 1 ? { screen: true } : {})
      }))
  }
}

/** The route's trail, provided by the shell for every drawer under it. Empty outside the shell. */
export const DrawerTrailContext = createContext<readonly RouteCrumb[]>([])

/**
 * The crumbs before the drawer at `depth`: the route's trail, then each
 * drawer under it. The screen's crumb closes every drawer; a lower drawer's
 * crumb closes the ones over it.
 */
export function drawerLevelCrumbs(
  route: readonly RouteCrumb[],
  screen: string,
  stack: readonly DrawerEntry[],
  depth: number,
  actions: { closeAll: () => void; closeFrom: (depth: number) => void }
): DrawerCrumb[] {
  return [
    ...route.map((item): DrawerCrumb =>
      item.screen
        ? { label: item.label, href: screen, onSelect: actions.closeAll }
        : { label: item.label, href: item.href }
    ),
    ...stack.slice(0, depth).map((entry, index): DrawerCrumb => ({
      label: drawerKind(entry.id).title,
      onSelect: () => actions.closeFrom(index + 1)
    }))
  ]
}
