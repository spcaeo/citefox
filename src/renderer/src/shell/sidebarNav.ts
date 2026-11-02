import type { IconName } from '../components/Icon'
import { hubFor, PAGES_HUB, SETTINGS_HUB } from './hubs'
import { isPageCurrent, isSectionCurrent, type SectionId, type ShellLocation } from './routes'

/**
 * The sidebar's folding groups (owner-approved nav, Main.dc.html): what is
 * used daily on top. Every group folds; the choice is remembered per project
 * (`useSidebarGroups`). `site` and `setup` are no longer drawn as groups: they are
 * the Pages and Settings items under the groups, and keep their ids for the hues.
 */
export const SIDEBAR_GROUPS = [
  { id: 'visibility', label: 'AI visibility', defaultOpen: true },
  { id: 'tracking', label: 'Tracking', defaultOpen: true },
  { id: 'pinned', label: 'Pinned', defaultOpen: true },
  { id: 'site', label: 'Your site', defaultOpen: false },
  { id: 'setup', label: 'Setup', defaultOpen: false }
] as const

export type SidebarGroupId = (typeof SIDEBAR_GROUPS)[number]['id']

export type SidebarGroupState = Readonly<Record<SidebarGroupId, boolean>>

export const DEFAULT_GROUP_STATE: SidebarGroupState = Object.fromEntries(
  SIDEBAR_GROUPS.map((group) => [group.id, group.defaultOpen])
) as Record<SidebarGroupId, boolean>

export interface SidebarLink {
  section: SectionId
  label: string
  icon: IconName
}

/**
 * The section links of each group, in mock-up order. AI visibility draws its
 * Topics entry after Questions; Pinned lists the pinned pages.
 */
export const VISIBILITY_TOP: readonly SidebarLink[] = [
  { section: 'overview', label: 'Summary', icon: 'grid' },
  { section: 'questions', label: 'Questions', icon: 'question' }
]

export const VISIBILITY_REST: readonly SidebarLink[] = [
  { section: 'competitors', label: 'Competitors', icon: 'users' },
  { section: 'citations', label: 'Citations', icon: 'link' },
  { section: 'fixes', label: 'Fixes', icon: 'check-square' }
]

export const TRACKING_LINKS: readonly SidebarLink[] = [
  { section: 'history', label: 'Check history', icon: 'clock' },
  { section: 'reports', label: 'Reports', icon: 'calendar' },
  { section: 'alerts', label: 'Alerts & schedules', icon: 'bell' }
]

/**
 * The two items under the groups (owner decision, Nov 2026): Pages holds Pages,
 * YouTube and Communities as tabs; Settings holds Project settings, Connections and
 * App settings (shell/hubs.ts). Each stays current on every tab of its hub.
 */
export const BOTTOM_LINKS: readonly SidebarLink[] = [
  { section: PAGES_HUB.home, label: PAGES_HUB.label, icon: 'file' },
  { section: SETTINGS_HUB.home, label: SETTINGS_HUB.label, icon: 'settings' }
]

/** True when the open route is `link`'s screen, or any tab of the hub it opens. */
export function isLinkCurrent(location: ShellLocation, link: SidebarLink): boolean {
  if (isSectionCurrent(location, link.section)) return true
  if (location.kind !== 'section') return false
  const mine = hubFor(link.section)
  const open = hubFor(location.section)
  return mine !== null && open !== null && mine.hub.id === open.hub.id
}

/** The Topics screen's link; the sidebar draws it with the project's topics under it. */
export const TOPICS_LINK: SidebarLink = { section: 'topics', label: 'Topics', icon: 'layers' }

const SECTION_GROUPS: readonly (readonly [SidebarGroupId, readonly SidebarLink[]])[] = [
  ['visibility', [...VISIBILITY_TOP, TOPICS_LINK, ...VISIBILITY_REST]],
  ['tracking', TRACKING_LINKS]
]

/**
 * The group that holds the open route, so a folded group can show itself
 * while one of its items is open. Topic results are in AI visibility (Topics),
 * a pinned page in Pinned. Null for routes with no sidebar item.
 */
export function groupForLocation(
  location: ShellLocation,
  pinnedIds: readonly string[] = []
): SidebarGroupId | null {
  if (location.kind === 'topic') return 'visibility'
  if (location.kind !== 'section') {
    return pinnedIds.some((id) => isPageCurrent(location, id)) ? 'pinned' : null
  }
  for (const [group, links] of SECTION_GROUPS) {
    if (links.some((link) => isSectionCurrent(location, link.section))) return group
  }
  const hub = hubFor(location.section)?.hub.id
  return hub === 'pages' ? 'site' : hub === 'settings' ? 'setup' : null
}

/**
 * Each group's hue (Tints.dc.html): the screen header's band and the group's
 * marker in the sidebar, so the user always sees which part of the app is
 * open. Setup is neutral; Pinned lists pages, so it takes Your site's.
 */
export type SectionHue = 'visibility' | 'site' | 'tracking' | 'setup'

export const GROUP_HUE: Readonly<Record<SidebarGroupId, SectionHue>> = {
  visibility: 'visibility',
  tracking: 'tracking',
  pinned: 'site',
  site: 'site',
  setup: 'setup'
}

/** Screens with no sidebar item, under the group they belong to. */
const SECTION_HUE: Partial<Record<SectionId, SectionHue>> = {
  export: 'tracking',
  check: 'tracking',
  'add-page': 'site',
  'import-pages': 'site',
  start: 'site',
  projects: 'setup',
  'new-project': 'setup',
  status: 'setup'
}

/**
 * The hue of the open route: its sidebar group's, a page's screens (tabs,
 * prompt detail) are Your site's. Null for routes outside every group.
 */
export function hueForLocation(location: ShellLocation): SectionHue | null {
  if (location.kind !== 'section' && location.kind !== 'topic') return 'site'
  const group = groupForLocation(location)
  if (group) return GROUP_HUE[group]
  return location.kind === 'section' ? (SECTION_HUE[location.section] ?? null) : null
}

/** Reads a stored group state; anything unknown or malformed falls back to the defaults. */
export function parseGroupState(raw: string | null): SidebarGroupState {
  if (!raw) return DEFAULT_GROUP_STATE
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return DEFAULT_GROUP_STATE
    const stored = value as Record<string, unknown>
    const next = { ...DEFAULT_GROUP_STATE }
    for (const group of SIDEBAR_GROUPS) {
      const open = stored[group.id]
      if (typeof open === 'boolean') next[group.id] = open
    }
    return next
  } catch {
    return DEFAULT_GROUP_STATE
  }
}
