import type { JSX, ReactNode } from 'react'
import type { ConnectionState } from '@shared/domain'
import { Icon, type IconName } from '../../components/Icon'
import { connectionStateLabel } from '../../keys/health'
import { Chip, type ChipTone } from '../../ui'
import { percentOf } from '../utils/model'

function stateTone(state: ConnectionState): ChipTone {
  if (state === 'ok') return 'ok'
  if (state === 'warning') return 'warn'
  return 'neutral'
}

/** OK, Warning, Off, or Not tested (FR-24.2), as a v2 chip with a dot. */
export function StateChip({ state }: { state: ConnectionState }): JSX.Element {
  return (
    <Chip tone={stateTone(state)} dot size="sm">
      {connectionStateLabel(state)}
    </Chip>
  )
}

/** One connection panel (v2 context panel). Same head as the capsule popover sections. */
export function StatusSection({
  id,
  title,
  icon,
  state,
  href,
  action,
  children
}: {
  id: string
  title: string
  icon: IconName
  state: ConnectionState
  href: string
  action: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="sts-card" aria-labelledby={id}>
      <div className="sts-card-head">
        <span className="sts-ico" aria-hidden="true">
          <Icon name={icon} size="nav" />
        </span>
        <h2 id={id} className="st-title">
          {title}
        </h2>
        <StateChip state={state} />
        <a className="sts-act" href={href}>
          {action}
        </a>
      </div>
      <div className="st-lines">{children}</div>
    </section>
  )
}

/** A used-of-limit bar with its numbers. The bar is an image with the sentence as its name. */
export function UsageBar({
  used,
  limit,
  label
}: {
  used: number
  limit: number | null
  label: string
}): JSX.Element {
  return (
    <div className="st-bar" role="img" aria-label={label}>
      <span style={{ width: `${percentOf(used, limit)}%` }} />
    </div>
  )
}

export function Line({ label, children }: { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="st-row">
      <span className="muted">{label}</span>
      <span className="st-num">{children}</span>
    </div>
  )
}
