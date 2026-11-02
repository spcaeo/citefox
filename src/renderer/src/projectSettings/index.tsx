import { useCallback, useEffect, useMemo, useRef, type JSX, type ReactNode } from 'react'
import { useAiContext } from '../assistant/context/useAiContext'
import { LoadError } from '../components/LoadError'
import { DrillHost } from '../drill'
import { REVEAL_EVENT } from '../projects/projectsScreen/utils/goTo'
import { useHashTab, withHashTab } from '../shell/useHashTab'
import { sectionHash } from '../shell/routes'
import { EmptyState, LinkButton, TabPanel, Tabs } from '../ui'
import { ClaudeSection } from './components/ClaudeSection'
import { DataSection } from './components/DataSection'
import { GeneralSection } from './components/GeneralSection'
import { MarketsSection } from './components/MarketsSection'
import { RulesSection } from './components/RulesSection'
import { ProjectRecheck } from '../alerts/homes'
import { SearchesSection } from './components/SearchesSection'
import { TemplatesSection } from './components/TemplatesSection'
import { ReportsSection } from './components/ReportsSection'
import { createLiveBrandingClient } from './utils/branding'
import { TrackSection } from './track/TrackSection'
import { SECTIONS, type SectionId } from './constants'
import { useProjectSettings } from './hooks/useProjectSettings'
import type { ProjectSettingsProps, SectionProps } from './types'

const PANEL = 'ps-tabs'

/** Each tab's URL value: `#/project-settings?tab=markets` (General has none). */
type TabKey = SectionId extends `ps-${infer Key}` ? Key : never
const TAB_KEYS = SECTIONS.map((item) => item.id.slice(3) as TabKey)
const tabKey = (id: SectionId): TabKey => id.slice(3) as TabKey
const TABS = SECTIONS.map((item) => ({
  ...item,
  href: withHashTab(
    sectionHash('project-settings'),
    item.id === 'ps-general' ? null : tabKey(item.id)
  )
}))

/**
 * FR-10.8 Project settings: everything that applies to one project, plus Export,
 * Duplicate, Archive or Restore, and Delete. Connections and default templates are
 * app-wide and live in Connections and Settings (FR-10.2).
 */
export function ProjectSettingsScreen({
  client,
  admin,
  alertsClient,
  templatesClient,
  project,
  projectSchedules,
  keys,
  onChanged,
  onDeleted,
  enginesSource,
  rulesSource,
  brandingClient: brandingOverride
}: ProjectSettingsProps): JSX.Element {
  const brandingClient = useMemo(
    () => brandingOverride ?? createLiveBrandingClient(),
    [brandingOverride]
  )
  const { view, error, reload } = useProjectSettings(admin, project?.id ?? null)
  const [key, setKey] = useHashTab<TabKey>(TAB_KEYS, 'general')
  const tab = `ps-${key}` as SectionId
  const setTab = useCallback((id: SectionId) => setKey(tabKey(id)), [setKey])
  const root = useRef<HTMLDivElement>(null)
  const loaded = view !== null

  // A deep link (such as Cap on Projects) focuses a section heading; show its tab first.
  useEffect(() => {
    const node = root.current
    if (!node) return
    function reveal(event: Event): void {
      const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-section]')
      const id = panel?.dataset.section as SectionId | undefined
      if (id) setTab(id)
    }
    node.addEventListener(REVEAL_EVENT, reveal)
    return () => node.removeEventListener(REVEAL_EVENT, reveal)
  }, [loaded, setTab])
  useAiContext({
    filters: { tab: SECTIONS.find((item) => item.id === tab)?.label ?? 'General' },
    numbers: view
      ? [
          { label: 'Competitors', value: String(view.project.competitors.length) },
          { label: 'Markets', value: String(view.markets.length) },
          { label: 'Tracked pages', value: String(view.project.trackedPageCount) },
          {
            label: 'Searches this month',
            value:
              view.usage.allowance === null
                ? String(view.usage.used)
                : `${view.usage.used} of ${view.usage.allowance}`
          }
        ]
      : []
  })
  const refresh = useCallback(async () => {
    await reload()
    await onChanged()
  }, [reload, onChanged])

  if (project === null) {
    return (
      <EmptyState
        title="No project yet"
        body="Create a project to choose its settings."
        action={
          <LinkButton size="sm" variant="primary" icon="plus" href={sectionHash('new-project')}>
            New project
          </LinkButton>
        }
      />
    )
  }
  if (view === null) {
    return error ? (
      <LoadError
        title="CiteFox could not load the project settings."
        message={error}
        onRetry={() => void reload()}
      />
    ) : (
      <p role="status">Loading project settings…</p>
    )
  }

  const section: SectionProps = { view, admin, client, keys, refresh }
  const panels: Record<SectionId, ReactNode> = {
    'ps-general': <GeneralSection {...section} />,
    'ps-track': (
      <TrackSection
        projectId={view.project.id}
        keys={keys}
        {...(enginesSource ? { source: enginesSource } : {})}
      />
    ),
    'ps-markets': <MarketsSection {...section} />,
    'ps-schedule': (
      <ProjectRecheck
        client={alertsClient}
        projectId={view.project.id}
        projectName={view.project.name}
        {...(projectSchedules ? { projectSchedules } : {})}
      />
    ),
    'ps-searches': <SearchesSection {...section} />,
    'ps-claude': <ClaudeSection {...section} />,
    'ps-rules': (
      <RulesSection
        projectId={view.project.id}
        projectName={view.project.name}
        {...(rulesSource ? { source: rulesSource } : {})}
      />
    ),
    'ps-templates': <TemplatesSection {...section} templatesClient={templatesClient} />,
    'ps-reports': (
      <ReportsSection
        projectId={view.project.id}
        client={brandingClient}
        brand={view.project.brandNames[0] ?? view.project.name}
      />
    ),
    'ps-data': <DataSection {...section} onDeleted={onDeleted} />
  }
  return (
    <DrillHost>
      <div className="page-stack ps" ref={root}>
        <p className="muted">These apply to {view.project.name} only.</p>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ps-tabs">
          <Tabs
            label="Project settings sections"
            panelId={PANEL}
            value={tab}
            onChange={setTab}
            tabs={TABS}
          />
          {/* Every panel stays mounted, so an unsaved edit survives a tab switch. */}
          {SECTIONS.map((item) => (
            <div key={item.id} data-section={item.id} hidden={item.id !== tab}>
              <TabPanel panelId={PANEL} id={item.id} className="ps-panel">
                {panels[item.id]}
              </TabPanel>
            </div>
          ))}
        </div>
      </div>
    </DrillHost>
  )
}
