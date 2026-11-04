import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { UiIcon } from './UiIcon'
import { useCopyFeedback } from './useCopyFeedback'

export interface CopyTextProps {
  /** The full value, what is copied and shown in the tooltip. */
  text: string
  /** What is shown, such as the text in quotes or a grid cell's own content. Default: the text. */
  label?: ReactNode
  /**
   * The label is a link or button of its own (a question that opens its detail):
   * it keeps its own focus and Enter, so the value is not a second tab stop.
   */
  interactiveLabel?: boolean
  /** A sentence (an error, a claim): wraps over lines instead of being cut with an ellipsis. */
  wrap?: boolean
  className?: string
}

/**
 * Any text value someone may paste elsewhere (owner rule 2026-10-25): a question, a
 * search term, an error. Copy appears at the end on hover or keyboard focus (always on
 * touch screens), turns into a green tick for 1.5 s, then hides, the same as UrlText.
 * A long value is cut with an ellipsis; the full text is in the tooltip. With the text
 * focused, Enter copies.
 */
export function CopyText({
  text,
  label,
  interactiveLabel = false,
  wrap = false,
  className
}: CopyTextProps): JSX.Element {
  const feedback = useCopyFeedback(text)
  const classes = [
    'ui-url',
    'ui-url-text',
    'ui-url-plain',
    feedback.state === 'copied' ? 'ui-url-copied' : '',
    feedback.state === 'failed' ? 'ui-url-failed' : '',
    feedback.done ? 'ui-url-done' : '',
    wrap ? 'ui-url-wrap' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  function onKeyDown(event: KeyboardEvent<HTMLSpanElement>): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    feedback.copy()
  }

  return (
    <span
      className={classes}
      data-copy-text=""
      onMouseLeave={feedback.onMouseLeave}
      onBlur={feedback.onBlur}
    >
      <span
        className="ui-url-value"
        title={text}
        {...(interactiveLabel
          ? {}
          : { tabIndex: 0, 'aria-keyshortcuts': 'Enter', onKeyDown: onKeyDown })}
      >
        {label ?? text}
      </span>
      <span className="ui-url-actions">
        <button
          type="button"
          className="ui-url-btn ui-url-copy"
          aria-label={
            feedback.state === 'copied'
              ? `Copied ${text}`
              : feedback.state === 'failed'
                ? `Couldn't copy ${text}`
                : `Copy ${text}`
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
      </span>
    </span>
  )
}
