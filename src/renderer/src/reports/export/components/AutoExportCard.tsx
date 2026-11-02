import type { JSX } from 'react'
import type { AutoExportRun, ExportFormat } from '@shared/domain'
import { formatMoment } from '../../../utils/dates'
import { sectionHash } from '../../../shell/routes'
import { Switch } from '../../bits'
import type { AutoExportState } from '../hooks/useAutoExport'
import { formatBytes, type ExportForm } from '../model'

const FORMAT_NAMES: Record<ExportFormat, string> = {
  pdf: 'PDF',
  xlsx: 'Excel',
  csv: 'CSV',
  html: 'HTML',
  json: 'JSON'
}

/**
 * "Send it automatically" (FR-22.6). The switch repeats this screen's settings after
 * every scheduled check, into a folder chosen in main's folder dialog. Recent runs
 * show what was written, or why not, like Delivery history.
 */
export function AutoExportCard({
  form,
  onPatch,
  auto
}: {
  form: ExportForm
  onPatch: (partial: Partial<ExportForm>) => void
  auto: AutoExportState
}): JSX.Element {
  const saved = auto.saved
  const folder = saved?.folder ?? null
  const runs = saved?.runs ?? []
  const last = runs[0] ?? null
  return (
    <section className="ui-panel xpt-panel xpt-auto-panel" aria-labelledby="auto-h">
      <h2 id="auto-h" className="ui-panel-title">
        Send it automatically
      </h2>
      <p className="xpt-sub" data-testid="xpt-elsewhere">
        To email a report on a schedule use <a href={sectionHash('reports')}>Reports</a>; alert
        emails and Slack are in Alerts &amp; schedules ›{' '}
        <a href={`${sectionHash('alerts')}/notifications`}>Notifications</a>.{' '}
        <a href={`${sectionHash('reports')}?view=sends`}>All sends</a> lists every one.
      </p>
      {auto.unavailable ? (
        <p className="xpt-warn" role="alert">
          {auto.unavailable.message} {auto.unavailable.nextStep}
        </p>
      ) : (
        <>
          <div className="switch-row">
            <span className="stack">
              <span id="auto-l">Export after every scheduled check</span>
              <span className="xpt-sub">Uses the settings on this screen.</span>
            </span>
            <Switch on={form.auto} labelledBy="auto-l" onToggle={() => void auto.toggle()} />
          </div>
          {auto.notice ? (
            <p className="xpt-warn" role="alert">
              {auto.notice.reason}
              {auto.notice.nextStep ? ` ${auto.notice.nextStep}` : ''}
            </p>
          ) : null}
          <div className="xpt-auto">
            <div className="field">
              <span className="field-label">Folder</span>
              <div className="xpt-folder">
                <span
                  className={folder ? 'mono xpt-folder-path' : 'muted'}
                  title={folder ?? undefined}
                >
                  {folder ?? 'No folder chosen yet'}
                </span>
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary ui-btn-sm"
                  onClick={() => void auto.chooseFolder()}
                >
                  {folder ? 'Change folder' : 'Choose folder'}
                </button>
              </div>
              <span className="xpt-help">
                CiteFox saves a new file there after each scheduled check and never replaces an
                earlier one. To email reports on a schedule, use Scheduled reports.
              </span>
            </div>
            {form.auto ? (
              <>
                <div className="field">
                  <label className="field-label" htmlFor="pattern">
                    Filename pattern
                  </label>
                  <input
                    id="pattern"
                    className="ui-input mono"
                    type="text"
                    value={form.pattern}
                    onChange={(event) => onPatch({ pattern: event.target.value })}
                  />
                  <span className="xpt-help">
                    Variables: {'{project}'} {'{page}'} {'{date}'} {'{ext}'}.
                  </span>
                </div>
                <div className="xpt-auto-save">
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-sm"
                    onClick={() => void auto.saveSettings()}
                  >
                    Save these settings
                  </button>
                  {saved?.spec ? (
                    <span className="xpt-sub">
                      Saved: {FORMAT_NAMES[saved.spec.format]} ·{' '}
                      {plural(saved.spec.sections.length, 'section')}
                    </span>
                  ) : null}
                  {auto.savedNow ? (
                    <span className="xpt-ok" role="status">
                      Saved.
                    </span>
                  ) : null}
                </div>
              </>
            ) : null}
            {last ? <LastRun run={last} /> : null}
            {runs.length > 0 ? <RunHistory runs={runs} /> : null}
          </div>
        </>
      )}
    </section>
  )
}

function LastRun({ run }: { run: AutoExportRun }): JSX.Element {
  const when = formatMoment(run.finishedAt)
  return run.outcome === 'ok' ? (
    <p className="xpt-ok" data-testid="auto-last">
      Last export {when}: <span className="mono">{run.filename}</span>
    </p>
  ) : (
    <p className="xpt-warn" data-testid="auto-last">
      Last export {when} failed. {run.reason} {run.nextStep}
    </p>
  )
}

function RunHistory({ runs }: { runs: readonly AutoExportRun[] }): JSX.Element {
  return (
    <details className="xpt-auto-history">
      <summary>Recent automatic exports ({runs.length})</summary>
      <table className="xpt-runs">
        <caption className="sr-only">Recent automatic exports, newest first</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">File</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{formatMoment(run.finishedAt)}</td>
              <td className="mono">{run.filename ?? '—'}</td>
              <td className={run.outcome === 'ok' ? 'xpt-ok' : 'xpt-warn'}>
                {run.outcome === 'ok'
                  ? `Saved${run.bytes !== null ? ` · ${formatBytes(run.bytes)}` : ''}`
                  : (run.reason ?? 'Failed')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
