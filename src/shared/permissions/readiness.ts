/**
 * One readiness model. The status capsule, its popover, the Status "Open issues"
 * tile, Settings and "What CiteFox needs" all count from this, so they never
 * disagree: required checklist items that are not ready are steps left, and a
 * connection with a warning is an issue unless its checklist item is already a
 * step (it is counted once).
 */

import type { ConnectionState } from '../domain'
import type { PermissionId, PermissionItem, StatusCapsule } from '../ipc'
import { isReady } from './index'

export type ReadinessConnection = keyof Pick<
  StatusCapsule,
  'serpapi' | 'claudeCode' | 'jina' | 'youtube'
>

export interface ReadinessItem {
  /** The checklist id for a step; the connection's checklist id (or `youtube`) for an issue. */
  id: PermissionId | 'youtube'
  kind: 'step' | 'issue'
  title: string
  /** The checklist item a step opens. Null for a connection with no checklist row. */
  permissionId: PermissionId | null
  /** The connection an issue is about. Null for a step. */
  connection: ReadinessConnection | null
}

export interface Readiness {
  /** Required checklist items that are not ready (`PermissionsSnapshot.requiredOpen`). */
  steps: number
  /** Connections with a warning that are not already a step. */
  issues: number
  items: readonly ReadinessItem[]
}

const CONNECTIONS: readonly {
  id: ReadinessConnection
  title: string
  permission: PermissionId | null
}[] = [
  { id: 'serpapi', title: 'SerpApi', permission: 'serpapi' },
  { id: 'claudeCode', title: 'Claude Code', permission: 'claude' },
  { id: 'jina', title: 'Jina Reader', permission: 'jina' },
  { id: 'youtube', title: 'YouTube Data API', permission: null }
]

/** Null `checklist` (not read yet) counts only connection warnings. */
export function readiness(
  checklist: { items: readonly PermissionItem[] } | null,
  connections: Readonly<Record<ReadinessConnection, ConnectionState>>
): Readiness {
  const steps: ReadinessItem[] = (checklist?.items ?? [])
    .filter((item) => item.need === 'required' && !isReady(item.state))
    .map((item) => ({
      id: item.id,
      kind: 'step',
      title: item.title,
      permissionId: item.id,
      connection: null
    }))
  const stepIds = new Set(steps.map((step) => step.id))
  const issues: ReadinessItem[] = CONNECTIONS.filter(
    (connection) =>
      connections[connection.id] === 'warning' &&
      (connection.permission === null || !stepIds.has(connection.permission))
  ).map((connection) => ({
    id: connection.permission ?? 'youtube',
    kind: 'issue',
    title: connection.title,
    permissionId: connection.permission,
    connection: connection.id
  }))
  return { steps: steps.length, issues: issues.length, items: [...steps, ...issues] }
}

/**
 * "2 required steps left", "1 required step left · 1 issue", or "0 issues" when all is
 * ready. `short` drops "required" for the top-bar capsule ("2 steps left"); the numbers
 * are the same.
 */
export function readinessText(
  ready: Pick<Readiness, 'steps' | 'issues'>,
  options: { short?: boolean } = {}
): string {
  const issues = ready.issues === 1 ? '1 issue' : `${ready.issues} issues`
  if (ready.steps === 0) return issues
  const kind = options.short === true ? '' : 'required '
  const steps = `${ready.steps} ${kind}${ready.steps === 1 ? 'step' : 'steps'} left`
  return ready.issues > 0 ? `${steps} · ${issues}` : steps
}
