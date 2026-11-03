import { useEffect } from 'react'
import { diagnosticsClient, type DiagnosticsClient } from './client'
import { openTour } from '../intro/actions'
import { openReportProblem } from './actions'

/** Help › Report a problem… opens the drawer; Help › Watch the welcome tour opens the tour (main pushes `diagnostics:menu`). */
export function useDiagnosticsMenu(
  activeProjectId: string | null,
  client?: DiagnosticsClient
): void {
  useEffect(() => {
    const source = client ?? diagnosticsClient()
    return source.onMenu((event) => {
      if (event.command === 'report-problem') openReportProblem(activeProjectId)
      if (event.command === 'watch-tour') openTour()
    })
  }, [client, activeProjectId])
}
