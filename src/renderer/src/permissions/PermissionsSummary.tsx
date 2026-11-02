import type { JSX } from 'react'
import { ClaudeStatusLine, LinkButton, Panel, usePermissions } from '../ui'
import { permissionsHash } from './model'
import './permissions.css'

/** Settings › Connections: how many of "What CiteFox needs" are ready, and a link to the list. */
export function PermissionsSummary({ className }: { className?: string }): JSX.Element | null {
  const permissions = usePermissions()
  if (permissions === null) return null
  const snapshot = permissions.snapshot
  return (
    <Panel
      title="What CiteFox needs"
      className={className}
      actions={
        <LinkButton href={permissionsHash()} size="sm" iconEnd="arrow-right">
          Open checklist
        </LinkButton>
      }
    >
      <p className="pm-summary">
        {snapshot
          ? `${snapshot.readyCount} of ${snapshot.items.length} ready${
              snapshot.requiredOpen > 0
                ? ` · ${snapshot.requiredOpen} required ${snapshot.requiredOpen === 1 ? 'step' : 'steps'} left`
                : ' · every required item works'
            }`
          : 'Reading what is set up…'}
      </p>
      <p className="pm-note">
        CiteFox AI, searches, the keychain, notifications, background checks and more, each with its
        live state. <ClaudeStatusLine size="sm" />
      </p>
    </Panel>
  )
}
