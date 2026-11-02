import { useId, type JSX } from 'react'
import type { Market, ProjectSummary } from '@shared/domain'
import type { PinnedPage, TrayLine } from '@shared/ipc'
import type { SidebarTopic } from '../shell/sidebarTopics'
import { SidebarSponsor } from '../sponsors'
import { UiIcon } from '../ui/UiIcon'
import { formatScore } from '../shell/model'
import {
  isPageCurrent,
  isSectionCurrent,
  landingHash,
  pageHash,
  sectionHash,
  type ShellLocation
} from '../shell/routes'
import {
  BOTTOM_LINKS,
  isLinkCurrent,
  TOPICS_LINK,
  TRACKING_LINKS,
  VISIBILITY_REST,
  VISIBILITY_TOP,
  GROUP_HUE,
  groupForLocation,
  type SectionHue,
  type SidebarGroupId,
  type SidebarLink
} from '../shell/sidebarNav'
import { useSidebarGroups } from '../shell/useSidebarGroups'
import { pageLabel } from '../projects/copy'
import { Icon } from './Icon'
import { ProjectSwitcher, BrandLink } from './ProjectSwitcher'
import { SidebarAddMenu } from './SidebarAddMenu'
import { SidebarTray } from './SidebarDue'
import { SidebarGroup } from './SidebarGroup'
import { SidebarItem } from './SidebarItem'

/**
 * The v2 sidebar in the owner-approved order (Main.dc.html): the brand row
 * (logo and collapse, as tall as the top bar), project switcher, + Add, then AI visibility,
 * Tracking and Pinned, then one Pages and one Settings item. Each group folds and remembers it per project. Page search lives in
 * the top bar (⌘K).
 */
export function Sidebar({
  location,
  projects,
  active,
  foundPageCount,
  pinned,
  tray,
  onSelectProject,
  collapsed = false,
  onToggleCollapsed,
  topics = [],
  fixCount = null,
  label = 'CiteFox',
  revision = 0
}: {
  location: ShellLocation
  projects: readonly ProjectSummary[]
  /** The project detail carries its markets, for the due list's market names. */
  active: (ProjectSummary & { markets?: readonly Market[] }) | null
  foundPageCount: number
  pinned: readonly PinnedPage[]
  tray: TrayLine | null
  onSelectProject: (projectId: string) => void
  /** The 64px icon rail (v2 shell). */
  collapsed?: boolean
  /** Collapse or expand. Absent: no toggle button. */
  onToggleCollapsed?: () => void
  /** The open project's topics: their count shows on the one Topics item. */
  topics?: readonly SidebarTopic[]
  /** Page fixes to do (the Fixes badge). Null: none shown. */
  fixCount?: number | null
  /** Accessible name of the navigation. Only the gallery's demo copies change it. */
  label?: string
  /** Engine revision: the due list reloads when it changes. */
  revision?: number
}): JSX.Element {
  const scrollId = useId()
  const current = groupForLocation(
    location,
    pinned.map((page) => page.id)
  )
  const groups = useSidebarGroups(active?.id ?? null, current)

  function links(items: readonly SidebarLink[]): JSX.Element[] {
    return items.map((item) => (
      <SidebarItem
        key={item.section}
        href={sectionHash(item.section)}
        current={isSectionCurrent(location, item.section)}
        label={item.label}
        icon={<Icon name={item.icon} size="nav" />}
        {...(item.section === 'pages' && foundPageCount > 0
          ? { score: foundPageCount.toLocaleString('en-US') }
          : {})}
        {...(item.section === 'fixes' && fixCount !== null && fixCount > 0
          ? { score: fixCount.toLocaleString('en-US') }
          : {})}
      />
    ))
  }

  function group(id: SidebarGroupId): {
    open: boolean
    onToggle: () => void
    collapsed: boolean
    holdsCurrent: boolean
    hue: SectionHue
  } {
    return {
      open: groups.isOpen(id),
      onToggle: () => groups.toggle(id),
      collapsed,
      holdsCurrent: current === id,
      hue: GROUP_HUE[id]
    }
  }

  return (
    <nav
      className="side"
      aria-label={label}
      data-collapsed={collapsed || undefined}
      data-guide="sidebar-nav"
    >
      {/* One 48px row with the top bar: the logo, and collapse at its right. */}
      <div className="side-brand-row">
        <BrandLink href={landingHash()} />
        {onToggleCollapsed ? (
          <button
            type="button"
            className="side-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls={scrollId}
            aria-keyshortcuts="Meta+B Control+B"
            data-tip={collapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
            onClick={onToggleCollapsed}
          >
            <UiIcon name="panel-left" />
          </button>
        ) : null}
      </div>
      <div className="side-top">
        <ProjectSwitcher
          projects={projects}
          active={active}
          onSelect={onSelectProject}
          compact={collapsed}
        />
        <SidebarAddMenu foundPageCount={foundPageCount} collapsed={collapsed} />
      </div>
      <div className="side-scroll" id={scrollId}>
        <SidebarGroup label="AI visibility" {...group('visibility')}>
          {links(VISIBILITY_TOP)}
          {/* One Topics item, no list under it (40 topics would bury the menu): it opens
              the Topics dashboard, and stays current inside any topic. */}
          <SidebarItem
            href={sectionHash(TOPICS_LINK.section)}
            current={isSectionCurrent(location, TOPICS_LINK.section) || location.kind === 'topic'}
            label={TOPICS_LINK.label}
            icon={<Icon name={TOPICS_LINK.icon} size="nav" />}
            score={topics.length.toLocaleString('en-US')}
          />
          {links(VISIBILITY_REST)}
        </SidebarGroup>
        <SidebarGroup label="Tracking" {...group('tracking')}>
          {links(TRACKING_LINKS)}
        </SidebarGroup>
        {/* Pinned shows once a page is pinned: an empty group is only noise. */}
        {pinned.length > 0 ? (
          <SidebarGroup label="Pinned" count={pinned.length} {...group('pinned')}>
            {pinned.map((page) => (
              <SidebarItem
                key={page.id}
                href={pageHash(page.id)}
                current={isPageCurrent(location, page.id)}
                label={pageLabel(page)}
                score={formatScore(page.score)}
              />
            ))}
          </SidebarGroup>
        ) : null}
        {/* Pages and Settings: one item each, their screens are tabs (shell/hubs.ts). */}
        {BOTTOM_LINKS.map((item, index) => (
          <div
            key={item.section}
            className="side-group side-group-plain"
            data-hue={GROUP_HUE[index === 0 ? 'site' : 'setup']}
          >
            {index === 0 ? <div className="side-group-rule" aria-hidden="true" /> : null}
            <SidebarItem
              href={sectionHash(item.section)}
              current={isLinkCurrent(location, item)}
              label={item.label}
              icon={<Icon name={item.icon} size="nav" />}
              guide={`nav-${item.label.toLowerCase()}`}
              {...(item.section === 'pages' && foundPageCount > 0
                ? { score: foundPageCount.toLocaleString('en-US') }
                : {})}
            />
          </div>
        ))}
      </div>
      {/* Under the menu, not in it: on a short window the menu scrolls above the card. */}
      <SidebarSponsor collapsed={collapsed} />
      <SidebarTray
        tray={tray}
        project={active}
        refreshKey={`${revision}:${tray?.pagesDueToday ?? 0}`}
      />
    </nav>
  )
}
