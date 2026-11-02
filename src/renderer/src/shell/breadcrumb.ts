import { hubFor } from './hubs'
import {
  LANDING_SECTION,
  landingHash,
  sectionTrail,
  sectionHash,
  sectionHeading,
  type ShellLocation
} from './routes'

/** One step of the top bar breadcrumb. The last step has no link. */
export interface BreadcrumbItem {
  label: string
  href?: string
}

/** App-level screens: they belong to CiteFox, not to the open project. */
const APP_SECTIONS = new Set([
  'settings',
  'connections',
  'permissions',
  'playground',
  'projects',
  'new-project',
  'status',
  'unavailable'
])

/**
 * The top bar breadcrumb for a route (Mockups/v2 previews: "Example Co › Add ›
 * New topic"). `projectName` is the open project; `pageLabel` names a page
 * route's page when the shell knows it (a pinned page).
 */
export function breadcrumbFor(
  location: ShellLocation,
  projectName: string | null,
  pageLabel: string | null = null
): BreadcrumbItem[] {
  const project: BreadcrumbItem[] = projectName ? [{ label: projectName, href: landingHash() }] : []
  if (location.kind === 'section') {
    const { section } = location
    const heading = sectionHeading(section)
    // The Pages and Settings hubs: "Example Co › Pages › YouTube", "Settings › Connections",
    // "Example Co › Settings › Project settings › Templates".
    const hub = hubFor(section)
    if (hub !== null) {
      const home: BreadcrumbItem = { label: hub.hub.label, href: sectionHash(hub.hub.home) }
      if (hub.hub.id === 'pages') {
        return section === 'pages'
          ? [...project, { label: heading }]
          : [...project, home, { label: heading }]
      }
      const owner = APP_SECTIONS.has(hub.tab) ? [] : project
      const tab = sectionHeading(hub.tab)
      if (hub.tab === section) return [...owner, home, { label: tab }]
      const current = sectionTrail(section)?.current ?? heading
      return [...owner, home, { label: tab, href: sectionHash(hub.tab) }, { label: current }]
    }
    if (APP_SECTIONS.has(section)) return [{ label: heading }]
    // The project's own landing does not link back to itself.
    if (section === LANDING_SECTION) {
      return [...project.map(({ label }) => ({ label })), { label: heading }]
    }
    // The Add wizard: "Example Co › Add" on the chooser, "› New topic" in a draft.
    if (section === 'add') {
      return location.focusId
        ? [...project, { label: 'Add', href: sectionHash('add') }, { label: 'New topic' }]
        : [...project, { label: 'Add' }]
    }
    return [...project, { label: heading }]
  }
  if (location.kind === 'topic') {
    return [
      ...project,
      { label: sectionHeading('topics'), href: sectionHash('topics') },
      { label: pageLabel ?? 'Topic' }
    ]
  }
  // The page is named, not linked: its own tabs and Back sit right under the bar,
  // and a second link with the page's URL as its name would repeat the header's.
  const page: BreadcrumbItem = { label: pageLabel ?? 'Page' }
  if (location.kind === 'prompt') return [...project, page, { label: 'Question' }]
  if (location.kind === 'running') return [...project, page, { label: 'Checking' }]
  if (location.kind === 'read') return [...project, page, { label: 'Page setup' }]
  return [...project, { label: page.label }]
}
