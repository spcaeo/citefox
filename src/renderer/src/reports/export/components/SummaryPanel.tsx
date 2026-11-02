import { useState, type JSX } from 'react'
import type { ExportPreview } from '@shared/domain'
import type { RevealExportResult } from '@shared/ipc'
import { DrillNumber, type ItemDrill } from '../../../drill'
import { Button, PathText, SectionHead, revealLabel } from '../../../ui'
import { exportChecksDrill, exportMarketsDrill, exportPagesDrill } from '../drills'
import { FORMAT_DEFS, formatSummary } from '../formats'
import type { ExportRun } from '../hooks/useExportRun'
import {
  chosenSections,
  countLabel,
  formatBytes,
  sectionTitle,
  sizeLabel,
  type ExportForm
} from '../model'
import { PreviewBody } from './PreviewBody'

/**
 * The export preview (Topic-Report.png, left column): what the file will hold
 * (scope, markets, data window, size, sections), the first rows main builds,
 * and the outcome of a save. The Save button is the screen header's primary.
 */
export function SummaryPanel({
  form,
  preview,
  scopeText,
  marketText,
  windowText,
  run,
  onCancel,
  onReveal,
  hasTopic = false
}: {
  form: ExportForm
  /** Null while a preview is on its way. */
  preview: ExportPreview | null
  scopeText: string
  marketText: string
  windowText: string
  run: ExportRun
  /** Puts every choice back to its default. */
  onCancel: () => void
  /** `exports:reveal`. */
  onReveal: (filePath: string) => Promise<RevealExportResult>
  /** The scope holds a topic, so Topic coverage counts as chosen. */
  hasTopic?: boolean
}): JSX.Element {
  const [finder, setFinder] = useState<{ path: string; note: string } | null>(null)
  /** `exports:reveal`; the note under the line says what happened, so the path's icon never repeats it. */
  async function revealSaved(path: string): Promise<{ ok: true }> {
    const revealed = await onReveal(path)
    setFinder({
      path,
      note: revealed.ok
        ? `Shown in Finder. On this computer: ${path}`
        : `${revealed.reason} ${revealed.nextStep} On this computer: ${path}`.trim()
    })
    return { ok: true }
  }
  const pages = preview?.pages ?? null
  const chosen = chosenSections(form, hasTopic)
  const ready = preview !== null && !preview.blocked
  const result = run.result
  const formatName = FORMAT_DEFS.find((format) => format.id === form.format)?.name ?? ''
  return (
    <section className="ui-panel xpt-preview-panel" aria-labelledby="sum-h">
      <SectionHead
        id="sum-h"
        className="xpt-preview-head"
        title={`Preview · ${formatName}`}
        description={formatSummary(form)}
      />
      <div className="xpt-preview-body">
        <dl className="xpt-facts">
          <div className="xpt-fact">
            <dt>Scope</dt>
            <dd>
              <span className="xpt-fact-main">{scopeText}</span>
              {ready ? (
                <Count
                  value={preview.pageCount}
                  noun="page"
                  drill={pages ? exportPagesDrill(pages) : null}
                />
              ) : null}
            </dd>
          </div>
          <div className="xpt-fact">
            <dt>Markets</dt>
            <dd>
              <span className="xpt-fact-main">{marketText}</span>
              {ready ? (
                <Count
                  value={preview.marketCount}
                  noun="market"
                  drill={pages ? exportMarketsDrill(pages) : null}
                />
              ) : null}
            </dd>
          </div>
          <div className="xpt-fact">
            <dt>Data window</dt>
            <dd>
              <span className="xpt-fact-main">{windowText}</span>
              {ready ? (
                <Count
                  value={preview.checkCount}
                  noun="check"
                  drill={pages ? exportChecksDrill(pages) : null}
                />
              ) : null}
            </dd>
          </div>
          <div className="xpt-fact">
            <dt>Estimated size</dt>
            <dd>
              <span className="xpt-fact-main num">
                {ready ? sizeLabel(preview.estimatedBytes) : '—'}
              </span>
            </dd>
          </div>
        </dl>

        <div className="xpt-chosen-block">
          <p className="xpt-label">Sections · {chosen.length}</p>
          <ul className="xpt-chosen">
            <li className="xpt-chosen-fixed">Cover (always included)</li>
            {chosen.map((id) => (
              <li key={id}>{sectionTitle(id)}</li>
            ))}
          </ul>
          {chosen.length === 0 ? <p className="xpt-help">No sections picked yet.</p> : null}
        </div>

        {preview === null ? <p role="status">Checking this export…</p> : null}
        {preview?.blocked && preview.reason ? (
          <p className="xpt-warn" role="alert">
            {preview.reason}
            {preview.nextStep ? ` ${preview.nextStep}` : ''}
          </p>
        ) : null}
        {ready && preview.preview ? (
          <div className="xpt-preview">
            <p className="xpt-label">First lines of the file</p>
            <PreviewBody format={form.format} preview={preview.preview} />
          </div>
        ) : null}
        {run.progress ? (
          <p role="status">
            {run.progress.detail} ({run.progress.done} of {run.progress.total})
          </p>
        ) : null}
        {result && !result.ok ? (
          <p className="xpt-warn" role="alert">
            {result.reason}
            {result.nextStep ? ` ${result.nextStep}` : ''}
          </p>
        ) : null}
        {result && result.ok ? (
          <p className="xpt-ok" role="status">
            Saved{' '}
            <PathText
              path={result.filePath}
              label={result.filename}
              onReveal={() => revealSaved(result.filePath)}
            />{' '}
            · {formatBytes(result.bytes)} ·{' '}
            <button
              type="button"
              className="linkbtn"
              onClick={() => void revealSaved(result.filePath)}
            >
              {revealLabel()}
            </button>
          </p>
        ) : null}
        {result && result.ok && finder?.path === result.filePath ? (
          <p className="xpt-help" role="status">
            {finder.note}
          </p>
        ) : null}
      </div>
      <div className="xpt-preview-foot">
        <p className="xpt-help">Reports are made on this computer. Nothing is uploaded.</p>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Reset choices
        </Button>
      </div>
    </section>
  )
}

/**
 * A preview count. It opens the list behind it when main sent one, and that
 * list's length is the number shown (NFR-14). Older previews show text.
 */
function Count({
  value,
  noun,
  drill
}: {
  value: number
  noun: string
  drill: ItemDrill | null
}): JSX.Element {
  if (!drill || drill.items.length !== value) {
    return <span className="xpt-sub">{countLabel(value, noun)}</span>
  }
  return (
    <span className="xpt-sub">
      <DrillNumber drill={drill} suffix={` ${value === 1 ? noun : `${noun}s`}`} />
    </span>
  )
}
