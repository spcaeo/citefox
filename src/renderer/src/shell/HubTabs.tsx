import type { JSX } from 'react'
import { Tabs } from '../ui'
import { visibleHubTabs, type Hub } from './hubs'
import { navigateHash, sectionHash, type SectionId } from './routes'

/**
 * The tab bar of a sidebar hub (Pages: Pages · YouTube · Communities; Settings: Project
 * settings · Connections · App settings), above the open screen. Each tab is a link to
 * its own address, so it can be copied and opened in place.
 */
export function HubTabs({
  hub,
  current,
  devBuild = import.meta.env.DEV
}: {
  hub: Hub
  current: SectionId
  devBuild?: boolean
}): JSX.Element {
  const tabs = visibleHubTabs(hub, current, devBuild).map((tab) => ({
    id: tab.section,
    label: tab.label,
    href: sectionHash(tab.section)
  }))
  return (
    <nav className="hub-tabs" aria-label={hub.label} data-guide={`hub-${hub.id}`}>
      <Tabs
        label={`${hub.label} sections`}
        tabs={tabs}
        value={current}
        onChange={(id) => navigateHash(sectionHash(id))}
      />
    </nav>
  )
}
