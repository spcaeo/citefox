import { useEffect, useState } from 'react'
import type { ProjectUsageReport } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import type { AdminClient } from '../../../admin/client'
import { errorText } from '../../../components/errorText'

/**
 * FR-10.6 usage by project. Loads once and again whenever the project list changes
 * (create, pause, resume, restore), so the table follows the cards.
 */
export function useProjectUsage(
  admin: AdminClient | undefined,
  projects: readonly ProjectDetail[]
): { report: ProjectUsageReport | null; error: string | null } {
  const [report, setReport] = useState<ProjectUsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const signature = projects.map((project) => `${project.id}:${project.status}`).join('|')
  useEffect(() => {
    if (!admin) return
    let cancelled = false
    admin.projectUsage().then(
      (loaded) => {
        if (cancelled) return
        setReport(loaded)
        setError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setError(errorText(cause, 'Could not load usage.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [admin, signature])
  return { report, error }
}
