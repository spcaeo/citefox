import type { JSX } from 'react'
import type { IntentStage, PromptCheckStatus, PromptMovement } from '@shared/domain'
import { Icon } from '../components/Icon'
import { ResultChip, resultOfCheck, SegmentedControl } from '../ui'
import { movementLabel, stageLabel, statusLabel } from './model'

/**
 * Middot from Running.dc.html. The mock-up writes the text node " · "
 * (space, U+00B7, space) in the parent. It has no margin, padding, or gap.
 * A wrapper span with `white-space: pre` sits between the mono numbers and
 * lets those edge spaces paint at zero width, so this stays a text node.
 */
export function Sep(): JSX.Element {
  return <>{' · '}</>
}

/**
 * One inline box for a string that already contains middots.
 * Splitting on each middot makes those pieces flex items, and the parent's
 * gap then stacks on the space before the dot.
 */
export function Dotted({ text }: { text: string }): JSX.Element {
  return <span className="m3-dotted">{text}</span>
}

/** The result pill; named without a link is "Not cited" with a separate Named badge. */
export function StatusChip({ status }: { status: PromptCheckStatus }): JSX.Element {
  if (status === 'brand_mentioned') {
    return (
      <span className="m3-status-named">
        <ResultChip result="not_cited" label="Not cited" />
        <ResultChip result="named" label="Named" />
      </span>
    )
  }
  return <ResultChip result={resultOfCheck(status)} label={statusLabel(status)} />
}

export function Movement({
  movement,
  previousStatus = null,
  previousPosition = null
}: {
  movement: PromptMovement | null
  previousStatus?: PromptCheckStatus | null
  previousPosition?: number | null
}): JSX.Element {
  const up = movement === 'gained' || movement === 'improved'
  const down = movement === 'lost' || movement === 'declined'
  const tone = up ? 'm3-up' : down ? 'm3-down' : 'm3-flat'
  return (
    <span className={tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {up ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2 L11 9 H1 Z" fill="currentColor" />
        </svg>
      ) : null}
      {down ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 10 L11 3 H1 Z" fill="currentColor" />
        </svg>
      ) : null}
      {movementLabel(movement, previousStatus, previousPosition)}
    </span>
  )
}

export function StageName({ stage }: { stage: IntentStage }): JSX.Element {
  return <>{stageLabel(stage)}</>
}

/** Chart or table, as the shared segmented control (both views drill the same way). */
export function ViewToggle({
  view,
  onView,
  label = 'View'
}: {
  view: 'chart' | 'table'
  onView: (view: 'chart' | 'table') => void
  label?: string
}): JSX.Element {
  return (
    <SegmentedControl
      label={label}
      size="sm"
      options={VIEW_OPTIONS}
      value={view}
      onChange={onView}
    />
  )
}

const VIEW_OPTIONS = [
  { value: 'chart', label: 'Chart' },
  { value: 'table', label: 'Table' }
] as const

export function Spinner(): JSX.Element {
  return (
    <svg
      className="m3-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

export function ClockMark(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  )
}

export function DoneMark(): JSX.Element {
  return (
    <span className="m3-ok">
      <Icon name="check" />
      Done
    </span>
  )
}
