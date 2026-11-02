import { useEffect, useMemo, useState, type JSX } from 'react'
import type { DueList, Market, ProjectSummary } from '@shared/domain'
import type { TrayLine } from '@shared/ipc'
import { dueDrill } from '../allPages/utils/drills'
import { DrillButton, DrillFigure } from '../drill/DrillNumber'
import { drillCount, type ItemDrill } from '../drill/types'
import { trayDueLabel, trayRunningLabel } from '../projects/copy'

/** Reads the due list. Production uses the preload bridge (`schedule:listDue`). */
export interface SidebarDueSource {
  listDue: (projectId: string) => Promise<DueList>
}

const bridgeSource: SidebarDueSource = {
  listDue: (projectId) => {
    const api = typeof window === 'undefined' ? undefined : window.citefox
    if (!api) return Promise.reject(new Error('The preload bridge is missing.'))
    return api['schedule:listDue']({ projectId })
  }
}

/**
 * The pages due today (`schedule:listDue`) as the shared drill: the same list and drawer
 * as the All pages "Due today" tile, so the line, the tile and the drawer agree. Null
 * while the list is read, when it cannot be, or with no project to read.
 */
function useDueDrill(
  project: (ProjectSummary & { markets?: readonly Market[] }) | null,
  refreshKey: string | number,
  source: SidebarDueSource
): ItemDrill | null {
  const [loaded, setLoaded] = useState<{ projectId: string; list: DueList } | null>(null)
  const projectId = project?.id ?? null
  useEffect(() => {
    if (projectId === null) return
    let live = true
    source.listDue(projectId).then(
      (list) => {
        if (live) setLoaded({ projectId, list })
      },
      () => {
        if (live) setLoaded(null)
      }
    )
    return () => {
      live = false
    }
  }, [source, projectId, refreshKey])
  const marketList = project?.markets
  const domain = project?.domain ?? ''
  const list = loaded && loaded.projectId === projectId ? loaded.list : null
  return useMemo<ItemDrill | null>(() => {
    if (list === null) return null
    const markets = new Map((marketList ?? []).map((market) => [market.id, market]))
    return { ...dueDrill(list, markets, domain), id: 'shell:due-today' }
  }, [list, marketList, domain])
}

/** "N pages due today", opening the list; the tray's count as text until it is read. */
function DueLine({
  drill,
  trayCount
}: {
  drill: ItemDrill | null
  trayCount: number
}): JSX.Element {
  if (drill === null) return <span>{trayDueLabel(trayCount)}</span>
  const count = drillCount(drill)
  return (
    <DrillButton drill={drill} className="drill-num" label={`${trayDueLabel(count)}: show them`}>
      <DrillFigure drill={drill} /> {count === 1 ? 'page' : 'pages'} due today
    </DrillButton>
  )
}

/** The sidebar foot's "N pages due today" on its own: it opens the due list. */
export function SidebarDue({
  project,
  trayCount,
  refreshKey,
  source = bridgeSource
}: {
  project: ProjectSummary & { markets?: readonly Market[] }
  trayCount: number
  /** Reloads the list when it changes (the engine revision and the tray count). */
  refreshKey: string | number
  source?: SidebarDueSource
}): JSX.Element {
  return <DueLine drill={useDueDrill(project, refreshKey, source)} trayCount={trayCount} />
}

/**
 * The sidebar foot, only when it has news: "Not running in the tray", "Paused", or the
 * pages due today. Running with nothing due shows nothing, so the foot stays quiet.
 */
export function SidebarTray({
  tray,
  project,
  refreshKey,
  source = bridgeSource
}: {
  tray: TrayLine | null
  project: (ProjectSummary & { markets?: readonly Market[] }) | null
  refreshKey: string | number
  source?: SidebarDueSource
}): JSX.Element | null {
  const paused = project?.status === 'paused'
  const drill = useDueDrill(paused ? null : project, refreshKey, source)
  if (tray === null) return null
  const due = drill === null ? tray.pagesDueToday : drillCount(drill)
  const showDue = !paused && project !== null && due > 0
  if (tray.running && !paused && !showDue) return null
  return (
    <div className="side-foot">
      <div className="side-tray">
        {tray.running ? null : (
          <span className="tray-line">
            <span className="tray-dot off" aria-hidden="true" />
            {trayRunningLabel(false)}
          </span>
        )}
        {paused ? <span>Paused</span> : null}
        {showDue ? <DueLine drill={drill} trayCount={tray.pagesDueToday} /> : null}
      </div>
    </div>
  )
}
