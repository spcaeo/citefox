import { useEffect, useState } from 'react'
import type { ExportStartResult } from '@shared/domain'
import type { ExportProgress, ExportRequest } from '@shared/ipc'
import { explainExportError, type ReportsClient } from '../../client'

export interface ExportRun {
  busy: boolean
  /** The running export's latest step. Null when nothing is being written. */
  progress: ExportProgress | null
  /** Result for the current request. Any change to the request clears it. */
  result: ExportStartResult | null
  start: () => Promise<void>
}

/** `exports:start` and its `exports:progress`. Main opens the save dialog. */
export function useExportRun(client: ReportsClient, request: ExportRequest | null): ExportRun {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [outcome, setOutcome] = useState<{
    for: ExportRequest
    result: ExportStartResult
  } | null>(null)

  useEffect(() => client.onExportProgress(setProgress), [client])

  async function start(): Promise<void> {
    if (!request) return
    setBusy(true)
    setOutcome(null)
    setProgress(null)
    try {
      setOutcome({ for: request, result: await client.startExport(request) })
    } catch (error) {
      const explained = explainExportError(error)
      setOutcome({
        for: request,
        result: { ok: false, reason: explained.reason, nextStep: explained.nextStep }
      })
    } finally {
      setBusy(false)
    }
  }

  const result = outcome && outcome.for === request ? outcome.result : null
  const running = busy && progress !== null && progress.state === 'running'
  return { busy, progress: running ? progress : null, result, start }
}
