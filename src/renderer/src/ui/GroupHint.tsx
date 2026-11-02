import type { CSSProperties, JSX, ReactNode } from 'react'
import { resultBucket, whatToDo, type ResultBucket } from './resultTones'

export interface GroupHintProps {
  /** The result the group holds: its "What to do" line and colour. */
  result?: ResultBucket
  /** The screen's own advice, in place of the result's line. */
  text?: ReactNode
  /** When No AI Overview is checked again ("checked again Oct 30, 10:27 AM"). */
  nextCheckAt?: string | null
  /**
   * `inline`: one faint line in a group row, cut with an ellipsis (the full
   * line is its tooltip). `block`: the boxed line under a drill page's title,
   * with a left edge in the result colour.
   */
  variant?: 'inline' | 'block'
  className?: string
}

/**
 * "What to do: …" (owner, 2026-10-29): what the searches in a group or a
 * drill page need, in the shared words of ui/resultTones.ts unless the screen
 * has its own advice.
 */
export function GroupHint({
  result,
  text,
  nextCheckAt,
  variant = 'inline',
  className
}: GroupHintProps): JSX.Element | null {
  const line = text ?? (result ? whatToDo(result, { nextCheckAt: nextCheckAt ?? null }) : null)
  if (line === null) return null
  const block = variant === 'block'
  const classes = [block ? 'ui-group-hint-block' : 'ui-group-hint', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <span
      className={classes}
      title={!block && typeof line === 'string' ? `What to do: ${line}` : undefined}
      style={
        block && result
          ? ({ '--hint-colour': resultBucket(result).colour } as CSSProperties)
          : undefined
      }
    >
      <b>What to do:</b> {line}
    </span>
  )
}
