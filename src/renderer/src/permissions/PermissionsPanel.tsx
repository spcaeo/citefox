import type { JSX } from 'react'
import type { PermissionId, PermissionItem } from '@shared/ipc'
import { Panel, usePermissions } from '../ui'
import { groupByNeed, needLabel, stateTone, stateWord } from './model'
import { usePermissionAction } from './usePermissionAction'
import './permissions.css'

/**
 * "What CiteFox needs" as a compact list: on the first setup step (`compact`,
 * in the rail) and as the review before Finish setup (`review`, with what each
 * item is for). Every item shows its live state; nothing asks the system for
 * anything until the user clicks and reads what will appear.
 */
export function PermissionsPanel({
  variant,
  onSetup,
  canSetup = () => true,
  title = 'What CiteFox needs'
}: {
  variant: 'compact' | 'review'
  /** Opens where an item is set up, such as the Claude step. */
  onSetup: (id: PermissionId) => void
  /** False hides an item's "set up" button where that screen is not reachable (onboarding). */
  canSetup?: (id: PermissionId) => boolean
  title?: string
}): JSX.Element | null {
  const permissions = usePermissions()
  if (permissions === null) return null
  const snapshot = permissions.snapshot
  const total = snapshot?.items.length ?? 0
  return (
    <Panel
      title={title}
      titleAs="h2"
      className={`pm-panel pm-${variant}`}
      padding={variant === 'compact' ? 20 : 24}
    >
      {snapshot === null ? (
        <p className="hint" role="status">
          {permissions.error ?? 'Reading what is set up…'}
        </p>
      ) : (
        <>
          <p className="pm-summary">
            <span className="num">
              {snapshot.readyCount} of {total} ready
            </span>
            {snapshot.requiredOpen > 0
              ? ` · ${snapshot.requiredOpen} required ${snapshot.requiredOpen === 1 ? 'step' : 'steps'} left`
              : ' · all required items done'}
          </p>
          <p className="pm-note">
            CiteFox asks your computer for nothing until you click, and says first what will appear.
          </p>
          {groupByNeed(snapshot.items).map((group) => (
            <section className="pm-group" key={group.need} aria-label={needLabel(group.need)}>
              <h3 className="pm-group-title">{needLabel(group.need)}</h3>
              <ul className="pm-list">
                {group.items.map((item) => (
                  <PermissionRow
                    key={item.id}
                    item={item}
                    variant={variant}
                    onSetup={onSetup}
                    canSetup={canSetup(item.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {variant === 'review' ? (
            <p className="pm-live" role="status" aria-live="polite">
              {permissions.message ?? ''}
            </p>
          ) : null}
        </>
      )}
    </Panel>
  )
}

function PermissionRow({
  item,
  variant,
  onSetup,
  canSetup
}: {
  item: PermissionItem
  variant: 'compact' | 'review'
  onSetup: (id: PermissionId) => void
  canSetup: boolean
}): JSX.Element {
  const { button, confirm } = usePermissionAction(item, onSetup, {
    variant: variant === 'compact' ? 'ghost' : 'secondary',
    canSetup
  })
  const tone = stateTone(item.state)
  return (
    <li className="pm-row" data-permission={item.id} data-state={item.state}>
      <span className={`pm-dot pm-dot-${tone}`} aria-hidden="true" />
      <div className="pm-body">
        <p className="pm-title">
          {item.title}
          <span className="sr-only"> · {stateWord(item.state)}</span>
        </p>
        <p className="pm-state">{item.statusLabel}</p>
        {variant === 'review' ? <p className="pm-purpose">{item.purpose}</p> : null}
        {variant === 'review' && item.detail && item.state !== 'ok' ? (
          <p className="pm-detail">{item.detail}</p>
        ) : null}
      </div>
      {button ? <div className="pm-act">{button}</div> : null}
      {confirm ? <div className="pm-row-confirm">{confirm}</div> : null}
    </li>
  )
}
