import { useEffect } from 'react'
import { diagnosticsClient, type DiagnosticsClient } from './client'
import { openReportProblem } from './actions'

/** Help › Report a problem… (main pushes `diagnostics:menu`) opens the drawer. */
export function useDiagnosticsMenu(
  activeProjectId: string | null,
  client?: DiagnosticsClient
): void {
  useEffect(() => {
    const source = client ?? diagnosticsClient()
    return source.onMenu((event) => {
      if (event.command === 'report-problem') openReportProblem(activeProjectId)
    })
  }, [client, activeProjectId])
}
