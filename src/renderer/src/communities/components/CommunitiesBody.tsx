import { useMemo, type JSX, type ReactNode } from 'react'
import type { AssistClient } from '../../assist/client'
import { TabPanel, Tabs } from '../../ui'
import { createCommunityDrills } from '../drills'
import type { CommunitiesState } from '../hooks/useCommunities'
import type { CommunitiesSource } from '../source'
import type { AssistSlot } from '../types'
import { ScopeToolbarProvider } from '../utils/scopeToolbar'
import { SOURCE_TABS, sourceCount, type CommunitiesTab } from '../utils/tabs'
import { ChangeTable } from './ChangeTable'
import { KpiTiles } from './KpiTiles'
import { Opportunities } from './Opportunities'
import { SourceMix } from './SourceMix'
import { SourcePanel } from './SourceTabs'

const PANEL_ID = 'cm-panel'

/**
 * Everything under a Communities header, shared by the page tab and the
 * project screen: KPI tiles, then the sections (Source mix, the four source
 * lists, Opportunities) as sub-tabs. Each screen owns its route, its filters
 * (passed in and drawn in the open grid's toolbar) and its drill host; the
 * body only reads the loaded report, so "this page" vs "the whole project"
 * comes from `report.scope`.
 */
export function CommunitiesBody({
  client,
  state,
  scopeLabel,
  filters,
  empty,
  tab,
  onTab,
  pageId,
  assists,
  assistClient
}: {
  client: CommunitiesSource
  state: CommunitiesState
  /** "This page · US · EN", "3 tracked pages · All markets"… for drill copy and captions. */
  scopeLabel: string
  /** The screen's filters, for the open grid's toolbar (or above the empty state). */
  filters: ReactNode
  /** What a report with no check shows. */
  empty: ReactNode
  tab: CommunitiesTab
  onTab: (tab: CommunitiesTab) => void
  /** The page an AI assist is about. Null on the project screen with every page. */
  pageId: string | null
  assists?: AssistSlot
  assistClient?: AssistClient
}): JSX.Element {
  const report = state.report
  const newest = report?.checks.find((check) => check.index === 0) ?? null
  const drills = useMemo(() => (report ? createCommunityDrills(report) : null), [report])
  const ownPage = report?.scope === 'project' ? 'the page the question is tracked for' : 'your page'

  return (
    <>
      {report === null || newest === null ? <div className="cm-filters">{filters}</div> : null}

      {state.error !== null ? (
        <p className="bridge-alert" role="alert">
          {state.error}
        </p>
      ) : null}

      {report === null ? null : newest === null || drills === null ? (
        empty
      ) : (
        <>
          <KpiTiles report={report} newest={newest} drills={drills} scopeLabel={scopeLabel} />
          <Tabs
            label="Community sections"
            size="sm"
            panelId={PANEL_ID}
            value={tab}
            onChange={onTab}
            tabs={[
              { id: 'mix', label: 'Source mix' },
              ...SOURCE_TABS.map((item) => ({
                id: item.id,
                label: item.label,
                count: sourceCount(report, item.id)
              })),
              { id: 'opportunities', label: 'Opportunities', count: report.opportunities.length }
            ]}
          />
          <ScopeToolbarProvider value={filters}>
            <TabPanel panelId={PANEL_ID} id={tab} className="cm-panel">
              {tab === 'mix' ? (
                <div className="cm-stack-panel">
                  <SourceMix
                    report={report}
                    check={newest}
                    scopeLabel={scopeLabel}
                    drills={drills}
                  />
                  {assists?.({ section: 'mix', report, pageId }) ?? null}
                  <ChangeTable report={report} drills={drills} />
                </div>
              ) : null}
              {tab === 'reddit' || tab === 'youtube' || tab === 'linkedin' || tab === 'forums' ? (
                <SourcePanel
                  tab={tab}
                  report={report}
                  source={client}
                  pageId={pageId}
                  assists={assists}
                  drills={drills}
                  onChanged={state.reload}
                  {...(assistClient ? { assistClient } : {})}
                />
              ) : null}
              {tab === 'opportunities' ? (
                <div className="cm-stack-panel">
                  <p className="cm-note">
                    Questions whose overview cites Reddit, YouTube or LinkedIn but not {ownPage},
                    ranked by what there is to gain: the visibility points the page would add if it
                    were cited, then how high the community source sits. Select a rank or the points
                    for the maths.
                  </p>
                  <Opportunities report={report} drills={drills} />
                  {assists?.({ section: 'opportunities', report, pageId }) ?? null}
                  <p className="cm-note">
                    CiteFox shows the next check next to your work and cannot tell you a post caused
                    a change.
                  </p>
                </div>
              ) : null}
            </TabPanel>
          </ScopeToolbarProvider>
        </>
      )}
    </>
  )
}
