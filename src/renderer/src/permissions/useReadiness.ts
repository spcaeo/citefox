import { useMemo } from 'react'
import type { StatusCapsule } from '@shared/ipc'
import { readiness, type Readiness } from '@shared/permissions/readiness'
import { usePermissions } from '../ui/permissionsContext'

/**
 * The one readiness model for this screen: the "What CiteFox needs" snapshot plus
 * the capsule's connection states. Null until the capsule is read.
 */
export function useReadiness(capsule: StatusCapsule | null): Readiness | null {
  const snapshot = usePermissions()?.snapshot ?? null
  return useMemo(() => (capsule ? readiness(snapshot, capsule) : null), [capsule, snapshot])
}
