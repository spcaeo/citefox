import { useEffect, useState } from 'react'
import type { DiagnosticsReport } from '@shared/ipc'
import { errorText } from '../components/errorText'
import type { DiagnosticsClient } from './client'

/** A pause after the last keystroke before the report is built again. */
export const REPORT_DEBOUNCE_MS = 350

export interface ReportState {
  report: DiagnosticsReport | null
  /** The first build has not come back yet. */
  loading: boolean
  /** A newer build is on its way (the note or the box changed). */
  refreshing: boolean
  error: string | null
  reload: () => void
}

/**
 * The exact report text for the current note and box. It is built in main every time
 * either changes (after a short pause), so the preview is always what would be shared.
 */
export function useReport(
  client: DiagnosticsClient,
  request: { includeQuestions: boolean; note: string; projectId: string | null }
): ReportState {
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The request the shown report (or error) answers; a different one means a build is on its way.
  const [settled, setSettled] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { includeQuestions, note, projectId } = request
  const key = JSON.stringify([includeQuestions, note, projectId, attempt])

  useEffect(() => {
    let live = true
    const timer = window.setTimeout(() => {
      client
        .build({ includeQuestions, note, projectId })
        .then((next) => {
          if (!live) return
          setReport(next)
          setError(null)
        })
        .catch((cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not build the report.'))
        })
        .finally(() => {
          if (live) setSettled(key)
        })
    }, REPORT_DEBOUNCE_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [client, includeQuestions, note, projectId, key])

  return {
    report,
    loading: report === null && error === null,
    refreshing: settled !== key && report !== null,
    error,
    reload: () => setAttempt((value) => value + 1)
  }
}
