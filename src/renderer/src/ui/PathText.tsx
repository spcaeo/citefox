import { useState, type JSX, type KeyboardEvent } from 'react'
import { announce } from './announce'
import { UiIcon } from './UiIcon'
import { revealLabel } from './urlTextModel'
import { useCopyFeedback } from './useCopyFeedback'

/** What a reveal call answers (`settings:revealPath`, `exports:reveal`, `settings:openDataFolder`). */
export type RevealResult = { ok: true } | { ok: false; reason: string; nextStep?: string }

export interface PathTextProps {
  /** The full path of a file or folder on this computer. */
  path: string
  /** What is shown. Default: the path. */
  label?: string
  /**
   * Shows the file in Finder, Explorer or the file manager. Default:
   * `settings:revealPath`, which only shows files inside the app data folder.
   */
  onReveal?: () => Promise<RevealResult>
  className?: string
}

function bridgeReveal(path: string): Promise<RevealResult> {
  const api = (typeof window === 'undefined' ? undefined : window.citefox) as
    Partial<Window['citefox']> | undefined
  const reveal = api?.['settings:revealPath']
  if (typeof reveal !== 'function') {
    return Promise.resolve({ ok: false, reason: 'Could not open the folder here.' })
  }
  return reveal({ path }).catch(() => ({
    ok: false as const,
    reason: 'Could not open the folder.'
  }))
}

/**
 * A file or folder on this computer (exports, reports, the data folder): the
 * path in the code font with Copy and Show in Finder, never "open in a
 * browser". The same hover, focus, tick and touch rules as UrlText.
 */
export function PathText({ path, label, onReveal, className }: PathTextProps): JSX.Element {
  const feedback = useCopyFeedback(path)
  const [failed, setFailed] = useState<string | null>(null)
  const show = revealLabel()
  const shown = label ?? path
  const classes = [
    'ui-url',
    'ui-url-file',
    feedback.state === 'copied' ? 'ui-url-copied' : '',
    feedback.state === 'failed' ? 'ui-url-failed' : '',
    feedback.done ? 'ui-url-done' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  function reveal(): void {
    feedback.finish()
    void (onReveal ? onReveal() : bridgeReveal(path)).then((result) => {
      if (result.ok) {
        setFailed(null)
        return
      }
      const message = [result.reason, result.nextStep].filter(Boolean).join(' ')
      setFailed(message)
      announce(message)
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLSpanElement>): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    if (event.metaKey || event.ctrlKey) reveal()
    else feedback.copy()
  }

  return (
    <span
      className={classes}
      data-url-text="file"
      onMouseLeave={feedback.onMouseLeave}
      onBlur={feedback.onBlur}
    >
      <span
        className="ui-url-value"
        title={path}
        tabIndex={0}
        aria-keyshortcuts="Enter Meta+Enter Control+Enter"
        onKeyDown={onKeyDown}
      >
        {shown}
      </span>
      <span className="ui-url-actions">
        <button
          type="button"
          className="ui-url-btn ui-url-copy"
          aria-label={
            feedback.state === 'copied'
              ? `Copied ${shown}`
              : feedback.state === 'failed'
                ? `Couldn't copy ${shown}`
                : `Copy ${shown}`
          }
          onClick={(event) => {
            event.stopPropagation()
            feedback.copy()
          }}
        >
          <UiIcon
            name={
              feedback.state === 'copied' ? 'check' : feedback.state === 'failed' ? 'x' : 'copy'
            }
            size={14}
          />
        </button>
        <button
          type="button"
          className="ui-url-btn ui-url-reveal"
          aria-label={`${show}: ${shown}`}
          onClick={(event) => {
            event.stopPropagation()
            event.currentTarget.blur()
            reveal()
          }}
        >
          <UiIcon name="folder" size={14} />
        </button>
      </span>
      {failed ? <span className="ui-url-note">{failed}</span> : null}
    </span>
  )
}
