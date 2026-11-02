import { useCallback, useEffect, useState } from 'react'
import type { GenerationTemplate, GenerationTemplateKind } from '@shared/domain'
import type { LlmCallList, TemplateStep, TemplateVersionEntry } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useDrill } from '../../drill'
import type { TemplatesClient } from '../client'
import { callsDrill, usageDrill, versionsDrill } from '../utils/drills'

export interface StepDrills {
  /** Opens the step's version history drawer. */
  openVersions: (step: TemplateStep) => Promise<void>
  /** Opens the drawer of Claude calls behind "Last run". */
  openCalls: (step: TemplateStep) => Promise<void>
  /** Opens the drawer of saved artifacts behind an app template's usage line. */
  openUsage: (template: GenerationTemplate, scopeProjectId: string | null) => Promise<void>
  /** Why the last drawer could not load, or null. */
  error: string | null
}

/**
 * Loads what a Templates drill-down lists, then opens the shared drawer.
 * Versions come from `templates:versions`, calls from `llm:calls`, usage from
 * `templates:usageDetail`.
 */
export function useStepDrills(client: TemplatesClient, projectId: string | null): StepDrills {
  const { open } = useDrill()
  const [error, setError] = useState<string | null>(null)

  /**
   * What the step runs, newest first: with a project open, its own versions,
   * then the app default's versions (what runs without a project version).
   */
  const versionsOf = useCallback(
    async (step: TemplateStep): Promise<readonly TemplateVersionEntry[]> => {
      const app = await client.versions({ id: step.appDefault.id })
      if (projectId === null) return app
      const own = await client.versions({ projectId, kind: step.kind })
      const appRuns = step.status !== 'project'
      return [...own, ...app.map((entry) => ({ ...entry, current: appRuns && entry.current }))]
    },
    [client, projectId]
  )

  const callsOf = useCallback(
    (kind: GenerationTemplateKind): Promise<LlmCallList> =>
      client.calls(projectId === null ? { templateKind: kind } : { projectId, templateKind: kind }),
    [client, projectId]
  )

  const openVersions = useCallback(
    async (step: TemplateStep) => {
      setError(null)
      try {
        const [versions, calls] = await Promise.all([
          versionsOf(step),
          callsOf(step.kind).catch(() => null)
        ])
        open(versionsDrill(step, versions, calls))
      } catch (cause) {
        setError(errorText(cause, 'Could not load the version history.'))
      }
    },
    [callsOf, open, versionsOf]
  )

  const openCalls = useCallback(
    async (step: TemplateStep) => {
      setError(null)
      try {
        const [calls, versions] = await Promise.all([
          callsOf(step.kind),
          versionsOf(step).catch(() => [])
        ])
        open(callsDrill(step, calls, versions))
      } catch (cause) {
        setError(errorText(cause, 'Could not load the AI calls for this step.'))
      }
    },
    [callsOf, open, versionsOf]
  )

  const openUsage = useCallback(
    async (template: GenerationTemplate, scopeProjectId: string | null) => {
      setError(null)
      try {
        const detail = await client.usageDetail(
          scopeProjectId === null
            ? { id: template.id }
            : { id: template.id, projectId: scopeProjectId }
        )
        open(usageDrill(template, detail, projectId))
      } catch (cause) {
        setError(errorText(cause, 'Could not load where this template was used.'))
      }
    },
    [client, open, projectId]
  )

  return { openVersions, openCalls, openUsage, error }
}

/** The step's Claude calls, loaded once per step for the version history counts. */
export function useStepCalls(
  client: TemplatesClient,
  projectId: string | null,
  kind: GenerationTemplateKind,
  revision: number
): LlmCallList | null {
  const [calls, setCalls] = useState<LlmCallList | null>(null)
  useEffect(() => {
    let cancelled = false
    client
      .calls(projectId === null ? { templateKind: kind } : { projectId, templateKind: kind })
      .then(
        (list) => {
          if (!cancelled) setCalls(list)
        },
        () => {
          if (!cancelled) setCalls(null)
        }
      )
    return () => {
      cancelled = true
    }
  }, [client, projectId, kind, revision])
  return calls
}
