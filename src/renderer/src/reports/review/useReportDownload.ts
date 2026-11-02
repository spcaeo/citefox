import { useCallback, useState } from 'react'
import type { MetricsRequest, ReportTable } from '@shared/ipc'
import type { ReportKind } from '@shared/report/review'
import { localTimeZone } from '../export/model'
import type { ReviewClient } from './client'

export type DownloadFormat = 'html' | 'pdf' | 'csv'

export interface DownloadState {
  busy: boolean
  /** "Saved …" or why it did not save. Null before the first try. */
  note: { tone: 'ok' | 'bad'; text: string } | null
  download: (format: DownloadFormat, table?: ReportTable | null) => void
}

/** The request a report downloads with; Head-to-head adds its rival. */
export type DownloadRequest = MetricsRequest & { rival?: string | null }

/** Saves a ready report through `reports:download`; main asks where. */
export function useReportDownload(
  client: ReviewClient,
  kind: ReportKind,
  request: DownloadRequest | null
): DownloadState {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<DownloadState['note']>(null)
  const key = request === null ? '' : JSON.stringify(request)
  const download = useCallback(
    (format: DownloadFormat, table: ReportTable | null = null) => {
      if (key === '') return
      const base = JSON.parse(key) as DownloadRequest
      setBusy(true)
      void client
        .download({ ...base, report: kind, format, table, timeZone: localTimeZone() })
        .then((result) => {
          setBusy(false)
          if (result.ok) setNote({ tone: 'ok', text: `Saved ${result.filename}` })
          else if (result.reason !== 'Save cancelled') {
            setNote({
              tone: 'bad',
              text: result.nextStep ? `${result.reason} ${result.nextStep}` : result.reason
            })
          }
        })
    },
    [client, kind, key]
  )
  return { busy, note, download }
}
