import type { JSX } from 'react'
import { ConsoleLiveList } from './ConsoleLiveList'
import { formatDuration, promptFor } from './model'
import type { ConsoleJob, ConsoleLine } from './types'

const MARK: Readonly<Record<ConsoleLine['state'], string>> = {
  running: '▸',
  ok: '✓',
  skipped: '–',
  warning: '!',
  error: '×'
}

const SAID: Readonly<Record<ConsoleLine['state'], string>> = {
  running: 'running',
  ok: 'done',
  skipped: 'skipped',
  warning: 'warning',
  error: 'failed'
}

/** How a finished stage reads: the running wording turned into what happened. */
const SETTLED: Readonly<Record<string, string>> = {
  'Reading your pages': 'Read your pages',
  'Asking CiteFox AI': 'CiteFox AI answered',
  'Checking the answer': 'Checked the answer',
  'Getting the results ready': 'Results ready',
  Working: 'Done',
  'Re-reading the page': 'Re-read the page'
}

/**
 * One job's log, terminal style: `citefox $ fill example.com` on macOS and Linux
 * (`C:\CITEFOX> fill example.com` on Windows), then a prompt per
 * stage with its steps under it, the items running side by side (a check's
 * questions), red errors with what to do next and a retry where the job supports
 * one, and how it ended.
 */
export function ConsoleLog({
  job,
  now,
  closingIn,
  onRetry,
  onKeepOpen
}: {
  job: ConsoleJob
  now: number
  /** Seconds left before the window closes itself, or null. */
  closingIn: number | null
  onRetry: () => void
  onKeepOpen: () => void
}): JSX.Element {
  const lastStage = [...job.lines].reverse().find((line) => line.kind === 'stage')
  const lastError = [...job.lines].reverse().find((line) => line.kind === 'error')
  return (
    <>
      <p className="wc-line">
        <span className="wc-prompt">{promptFor(null, null)}</span> {job.command}
      </p>
      {job.lines.map((line) => {
        if (line.kind === 'stage') {
          const live = job.status === 'running' && line === lastStage && line.state === 'running'
          // A running stage says CiteFox is working and the user only waits; no cursor,
          // which reads as "type here".
          const text = live || line.state !== 'ok' ? line.text : (SETTLED[line.text] ?? line.text)
          return (
            <p key={line.id} className="wc-line" data-live={live ? 'true' : undefined}>
              <span className={line.state === 'error' ? 'wc-prompt wc-bad' : 'wc-prompt'}>
                {promptFor(job.kind, line.stage)}
              </span>{' '}
              {live ? (
                <svg
                  className="wc-spin"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-9-9" />
                </svg>
              ) : null}
              {text}
              {live ? (
                <span className="wc-dim">
                  … please wait
                  <span className="num"> · {formatDuration(now - line.startedAt)}</span>
                </span>
              ) : null}
            </p>
          )
        }
        if (line.kind === 'error') {
          return (
            <div key={line.id} className="wc-error">
              <p className={line.state === 'error' ? 'wc-line wc-bad' : 'wc-line wc-warn'}>
                {'  '}× {line.text}
              </p>
              {line.detail || (line === lastError && job.retry) ? (
                <p className="wc-line wc-dim">
                  {'  '}
                  {line.detail}
                  {line === lastError && job.retry ? (
                    <>
                      {line.detail ? ' · ' : null}
                      <button type="button" className="wc-link" onClick={onRetry}>
                        retry
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          )
        }
        const took =
          line.endedAt !== null && line.state !== 'running'
            ? formatDuration(line.endedAt - line.startedAt)
            : null
        return (
          <p key={line.id} className="wc-line wc-step">
            {'  '}
            <span className={`wc-mark wc-mark-${line.state}`} aria-hidden="true">
              {MARK[line.state]}
            </span>
            <span className="sr-only">{SAID[line.state]}: </span> {line.text}
            {line.detail ? <span className="wc-dim"> · {line.detail}</span> : null}
            {took && line.endedAt !== line.startedAt ? (
              <span className="wc-dim num"> · {took}</span>
            ) : null}
          </p>
        )
      })}
      {job.status === 'running' && job.live ? <ConsoleLiveList live={job.live} now={now} /> : null}
      {job.status === 'running' ? null : (
        <p className="wc-line">
          <span className={job.status === 'error' ? 'wc-prompt wc-bad' : 'wc-prompt wc-ok'}>
            {promptFor(null, null)}
          </span>{' '}
          {job.status === 'error'
            ? `stopped after ${formatDuration((job.endedAt ?? now) - job.startedAt)}${
                job.error ? ` · ${job.error.message}` : ''
              }`
            : `done in ${formatDuration((job.endedAt ?? now) - job.startedAt)}${
                job.summary ? ` · ${job.summary}` : ''
              }`}
        </p>
      )}
      {closingIn !== null ? (
        <p className="wc-line wc-dim">
          closing in {closingIn}…{' '}
          <button type="button" className="wc-link" onClick={onKeepOpen}>
            keep open
          </button>
        </p>
      ) : null}
    </>
  )
}
