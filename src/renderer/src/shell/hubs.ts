import type { SectionId } from './routes'

/**
 * The two bottom items of the sidebar (owner decision, Nov 2026): one "Pages" item and
 * one "Settings" item. Each opens a hub whose screens sit side by side as tabs. Every
 * tab keeps its own address (`#/youtube`, `#/connections`…), so old links still open
 * the same screen, now under its hub's tab bar.
 */
export type HubId = 'pages' | 'settings'

export interface HubTab {
  section: SectionId
  label: string
  /** Shown only in development builds, or while its own screen is open. */
  devOnly?: boolean
}

export interface Hub {
  id: HubId
  /** The sidebar item and the first breadcrumb step. */
  label: string
  /** Where the sidebar item goes: the first tab. */
  home: SectionId
  tabs: readonly HubTab[]
}

export const PAGES_HUB: Hub = {
  id: 'pages',
  label: 'Pages',
  home: 'pages',
  tabs: [
    { section: 'pages', label: 'Pages' },
    { section: 'youtube', label: 'YouTube' },
    { section: 'communities', label: 'Communities' }
  ]
}

export const SETTINGS_HUB: Hub = {
  id: 'settings',
  label: 'Settings',
  home: 'project-settings',
  tabs: [
    { section: 'project-settings', label: 'Project settings' },
    { section: 'connections', label: 'Connections' },
    { section: 'settings', label: 'App settings' },
    { section: 'playground', label: 'Playground', devOnly: true }
  ]
}

export const HUBS: readonly Hub[] = [PAGES_HUB, SETTINGS_HUB]

/**
 * Screens that open under a hub tab without being one: What CiteFox needs from App
 * settings, the Templates editor from Project settings, an old Site structure link
 * from Pages.
 */
const UNDER_TAB: Partial<Record<SectionId, SectionId>> = {
  permissions: 'settings',
  templates: 'project-settings',
  structure: 'pages'
}

/** The hub and the tab a section belongs to, or null for a section outside both hubs. */
export function hubFor(section: SectionId): { hub: Hub; tab: SectionId } | null {
  const tab = UNDER_TAB[section] ?? section
  for (const hub of HUBS) {
    if (hub.tabs.some((item) => item.section === tab)) return { hub, tab }
  }
  return null
}

/** The tabs a hub shows: development-only ones in a development build or while open. */
export function visibleHubTabs(hub: Hub, current: SectionId, devBuild: boolean): HubTab[] {
  return hub.tabs.filter((tab) => !tab.devOnly || devBuild || tab.section === current)
}
