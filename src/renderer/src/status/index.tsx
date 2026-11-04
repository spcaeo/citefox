import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { ScreenHeader } from '../components/Header'
import { DrillHost, useDrill } from '../drill'
import { LoadError } from '../components/LoadError'
import { IconButton, TabPanel, Tabs, useAssistMenu, type TabItem } from '../ui'
import type { UsageClient } from '../usage/client'
import { ClaudeUsage } from '../usage/ClaudeUsage'
import { useHashTab } from '../shell/useHashTab'
import { formatClock } from '../utils/dates'
import { ChecksSection, EmailSection, UsageSection } from './components/ActivitySections'
import { ConnectionsSummary } from './components/ConnectionSections'
import { StatusKpis } from './components/Kpis'
import { NoticesGrid } from './components/NoticesGrid'
import { SetupCard } from './components/SetupCard'
import { onStatusFocus, statusTabFor, takeStatusFocus, type StatusTab } from './focus'
import { useStatusData } from './hooks/useStatusData'
import { createLiveSource, type LiveSource } from './live/source'
import { useNotices } from './live/useNotices'
import { useSetupStatus } from './live/useSetupStatus'
import { createStatusSource, type StatusSource } from './source'
import type { StatusData } from './types'
import { statusAiPatch } from './aiContext'
import { issuesDrill, projectNames } from './utils/drills'
import { readiness } from '@shared/permissions/readiness'
import { usePermissions } from '../ui/permissionsContext'
import './status.css'

type StatusScreenProps = {
  /** Tests only. Production uses the preload bridge. */
  source?: StatusSource
  /** Tests only. The month and pace use the computer's clock. */
  now?: Date
  /** Tests only. Defaults to the assist client for this window's mode. */
  assistClient?: AssistClient
  /** Tests only. Defaults to the usage client for this window's mode. */
  usageClient?: UsageClient
  /** Tests only. Notices and page setup; production uses the preload bridge. */
  live?: LiveSource | null
}

const PANELS = 'st-tab'

/**
 * Status: credits and connections (FR-24.1–24.5, Mockups/Status.dc.html) in
 * the v2 layout: a row of KPI tiles, decisions waiting as a list grid, then
 * tabs for connections, checks, usage and email. Every number drills
 * (REPORT-SPEC "Interaction model"); the screen shares the shell's drill
 * drawer, or owns one when it stands alone (tests).
 */
export function StatusScreen(props: StatusScreenProps): JSX.Element {
  return (
    <DrillHost>
      <StatusBody {...props} />
    </DrillHost>
  )
}

/**
 * Lands on what the status popover asked for (`openStatusAt`): the section's
 * tab opens and its heading is scrolled to and focused; "issues" opens the
 * open-issues list.
 */
/** The tab is `?tab=` in the route; Connections, the first, has none. */
const STATUS_TABS: readonly StatusTab[] = ['connections', 'checks', 'usage', 'email']

function useStatusFocus(data: StatusData | null, onTab: (tab: StatusTab) => void): void {
  const { open } = useDrill()
  const snapshot = usePermissions()?.snapshot ?? null
  const [target, setTarget] = useState<{ id: string; at: number } | null>(null)
  useEffect(() => {
    if (!data) return
    function land(): void {
      const focus = takeStatusFocus()
      if (focus === null || !data) return
      if (focus === 'issues') {
        if (data.capsule) {
          const ready = readiness(snapshot, data.capsule)
          open(issuesDrill(ready, data.overview, data.overview?.keys ?? []))
        }
        return
      }
      const tab = statusTabFor(focus)
      if (tab) onTab(tab)
      setTarget({ id: focus, at: Date.now() })
    }
    land()
    return onStatusFocus(land)
  }, [data, open, onTab, snapshot])
  useEffect(() => {
    if (!target) return
    const heading = document.querySelector<HTMLElement>(`.st-screen #${target.id}`)
    if (!heading) return
    heading.setAttribute('tabindex', '-1')
    heading.scrollIntoView?.({ block: 'start' })
    heading.focus()
  }, [target])
}

function StatusBody({
  source,
  now,
  assistClient,
  usageClient,
  live
}: StatusScreenProps): JSX.Element {
  const client = useMemo(() => source ?? createStatusSource(), [source])
  const liveSource = useMemo(() => (live === undefined ? createLiveSource() : live), [live])
  const notices = useNotices(liveSource)
  const setup = useSetupStatus(liveSource, true)
  const { data, refreshing, refresh, pause, resume } = useStatusData(client)
  const [tab, setTab] = useHashTab<StatusTab>(STATUS_TABS, 'connections')
  useStatusFocus(data, setTab)
  const names = projectNames(data?.projects ?? null)
  const clock = data ? (now ?? new Date(data.loadedAt)) : (now ?? new Date())
  const ai = useAssistMenu({
    scope: { projectId: null, ...(assistClient ? { client: assistClient } : {}) },
    actions: [
      { assistId: 'status.explainUsage', label: 'Explain my usage', seconds: 6 },
      { assistId: 'status.explainErrors', label: 'Explain these errors', seconds: 6 }
    ]
  })

  const tabs: readonly TabItem<StatusTab>[] = [
    { id: 'connections', label: 'Connections' },
    { id: 'checks', label: 'Checks' },
    ...(data?.queue
      ? [{ id: 'usage' as const, label: 'Usage', count: data.queue.projects.length }]
      : []),
    ...(data?.email ? [{ id: 'email' as const, label: 'Email' }] : [])
  ]
  const shown = tabs.some((item) => item.id === tab) ? tab : 'connections'
  useAiContext(statusAiPatch({ tab: shown, data, openNotices: notices.notices.length }))

  return (
    <div className="page-stack st-screen sts-screen">
      <ScreenHeader
        title="Status"
        subtitle={
          <p className="muted">
            Credits and connections: everything CiteFox needs to run checks.{' '}
            <span className="faint" role="status">
              {data ? `Updated ${formatClock(data.loadedAt)}` : 'Loading…'}
            </span>
          </p>
        }
        actions={
          <>
            {ai.menu}
            <IconButton
              icon="refresh"
              label="Refresh"
              data-tip="Refresh"
              disabled={refreshing}
              onClick={() => void refresh()}
            />
          </>
        }
      />
      {data?.errors.map((error) => (
        <p key={error} className="bridge-alert" role="alert">
          {error}
        </p>
      ))}
      {ai.card}
      {data ? (
        <>
          <StatusKpis data={data} now={clock} />
          {notices.notices.length > 0 || notices.message ? <NoticesGrid state={notices} /> : null}
          <div className="sts-tabs">
            <Tabs
              label="Status sections"
              tabs={tabs}
              value={shown}
              onChange={setTab}
              panelId={PANELS}
            />
          </div>
          <TabPanel panelId={PANELS} id={shown} className="sts-panel">
            {shown === 'connections' && data.overview ? (
              <div className="ui-layout-main-rail sts-conn-layout">
                <ConnectionsSummary
                  overview={data.overview}
                  capsule={data.capsule}
                  now={clock}
                  provider={data.settings?.settings.claudeProvider ?? null}
                  jinaMode={data.settings?.settings.jinaMode ?? null}
                />
                <div className="sts-card">
                  <ClaudeUsage
                    card={false}
                    refreshKey={data.loadedAt}
                    {...(usageClient ? { client: usageClient } : {})}
                  />
                </div>
              </div>
            ) : null}
            {shown === 'connections' && !data.overview ? (
              <LoadError
                title="Connections could not be read."
                level={3}
                retryLabel="Refresh"
                onRetry={() => void refresh()}
              />
            ) : null}
            {shown === 'checks' ? (
              <div className="ui-cols-2">
                {data.queue ? (
                  <ChecksSection
                    queue={data.queue}
                    jobs={data.jobs}
                    due={data.due}
                    names={names}
                    onPause={pause}
                    onResume={resume}
                  />
                ) : null}
                <SetupCard setup={setup} />
              </div>
            ) : null}
            {shown === 'usage' && data.queue ? (
              <UsageSection queue={data.queue} now={clock} usage={data.usage} names={names} />
            ) : null}
            {shown === 'email' && data.email ? (
              <EmailSection email={data.email} deliveries={data.deliveries ?? []} names={names} />
            ) : null}
          </TabPanel>
        </>
      ) : (
        <p role="status">Loading status…</p>
      )}
    </div>
  )
}
