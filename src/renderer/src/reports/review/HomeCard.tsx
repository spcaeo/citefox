import type { JSX, ReactNode } from 'react'
import type { ReportKind } from '@shared/report/review'
import { Button, ToolButton, ToolGroup } from '../../ui'
import type { ReviewClient } from './client'
import { DownloadMenu } from './DownloadMenu'
import { useReportDownload, type DownloadRequest } from './useReportDownload'

/** What every card on the Reports home needs to download or schedule its report. */
export interface CardEnv {
  client: ReviewClient
  /** The request each report kind downloads with (Visibility: the latest check only). */
  requestFor: (kind: ReportKind) => DownloadRequest
  onSchedule: (kind: ReportKind) => void
}

/**
 * One card on the Reports home, the same in both views (owner 2026-11-02): title and
 * status, one short line, one number line, then one action row — Open on the left;
 * Download ▾, Print / PDF and Email on a schedule as icons on the right. By goal and
 * By report differ only in their words and where Open lands.
 */
export function HomeCard({
  kind,
  title,
  line,
  peek,
  meta = null,
  waiting = null,
  reading = false,
  onOpen,
  openDisabled = false,
  env
}: {
  /** The report this card opens, downloads and schedules. */
  kind: ReportKind
  title: string
  line: string
  peek: ReactNode
  /** One small line under the numbers (which check, what it compares). */
  meta?: ReactNode
  /** What the report still needs ("Needs a 2nd check"); null: it is ready. */
  waiting?: string | null
  /** Numbers still loading: no status yet. */
  reading?: boolean
  onOpen: () => void
  openDisabled?: boolean
  env: CardEnv
}): JSX.Element {
  const saving = useReportDownload(env.client, kind, env.requestFor(kind))
  return (
    <section className="rv-card rv-home-card" aria-label={title} data-card={kind}>
      <div className="rv-card-head">
        <h3>{title}</h3>
        {reading ? null : waiting ? (
          <span className="rv-ready is-waiting">○ {waiting}</span>
        ) : (
          <span className="rv-ready">● Ready</span>
        )}
      </div>
      <p className="rv-home-line">{line}</p>
      <div className="rv-home-peek">
        {peek ?? <span className="rv-muted">Reading the checks…</span>}
      </div>
      {meta ? <p className="rv-muted rv-small rv-home-meta">{meta}</p> : null}
      <div className="rv-card-acts">
        <Button size="sm" variant="primary" onClick={onOpen} disabled={openDisabled}>
          Open
        </Button>
        <span className="rv-grow" />
        <ToolGroup label="Report tools">
          <DownloadMenu busy={saving.busy} onDownload={saving.download} />
          <ToolButton kind="print" onClick={() => saving.download('pdf')} />
          <ToolButton kind="schedule" onClick={() => env.onSchedule(kind)} />
        </ToolGroup>
      </div>
      {saving.note ? (
        <p className={`rv-saved rv-saved-${saving.note.tone}`} role="status">
          {saving.note.text}
        </p>
      ) : null}
    </section>
  )
}
