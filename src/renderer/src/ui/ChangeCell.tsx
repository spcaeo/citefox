import type { JSX } from 'react'
import { changeDirection, EMPTY, formatPoints, formatSigned } from '../utils/format'

/** The colour of a change: good green, bad red, info blue, warn amber, neutral grey. */
export type ChangeTone = 'good' | 'bad' | 'info' | 'warn' | 'neutral'

export type ChangeCellProps =
  | {
      /** A worded change, such as "Gained" or "Overview gone". Null or empty: "—". */
      label: string | null
      tone: ChangeTone
      className?: string
    }
  | {
      /** A number change: "+3", "−2"; zero or null is "—". */
      delta: number | null
      /** `pts` writes "+11 pts". */
      unit?: 'pts'
      /** True when a rise is bad (more failed checks). Default false. */
      upIsBad?: boolean
      className?: string
    }

/**
 * The one change cell (grid audit issue 2): coloured text, never a pill. No
 * change is a faint "—", never "+0".
 */
export function ChangeCell(props: ChangeCellProps): JSX.Element {
  let text: string
  let tone: ChangeTone
  if ('delta' in props) {
    const direction = changeDirection(props.delta)
    text = props.unit === 'pts' ? formatPoints(props.delta) : formatSigned(props.delta)
    tone =
      direction === 'flat'
        ? 'neutral'
        : (direction === 'up') !== (props.upIsBad ?? false)
          ? 'good'
          : 'bad'
  } else {
    text = props.label || EMPTY
    tone = props.tone
  }
  const classes = [
    'ui-change',
    text === EMPTY ? 'faint' : `ui-change-${tone}`,
    props.className ?? ''
  ]
    .filter(Boolean)
    .join(' ')
  return <span className={classes}>{text}</span>
}
