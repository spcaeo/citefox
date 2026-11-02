import { useEffect, useState } from 'react'
import type { AlertSettings, AutoExport } from '@shared/domain'
import type { AutoExportUnavailable, CiteFoxApi } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { ProjectSends } from './sendsModel'

/** The two channels All sends reads. Tests pass another object. */
export type SendsSource = Pick<CiteFoxApi, 'alerts:get' | 'exports:getAuto'>

export function createSendsSource(): SendsSource {
  const api = (): CiteFoxApi => {
    if (typeof window === 'undefined' || !window.citefox) {
      throw new Error('The preload bridge is missing.')
    }
    return window.citefox
  }
  return {
    'alerts:get': (request) => api()['alerts:get'](request),
    'exports:getAuto': (request) => api()['exports:getAuto'](request)
  }
}

function isAuto(value: AutoExport | AutoExportUnavailable): value is AutoExport {
  return 'enabled' in value
}

/**
 * Each project's notifications (`alerts:get`) and automatic export
 * (`exports:getAuto`), read once when All sends opens. A project whose
 * settings cannot be read keeps a problem line instead of rows.
 */
export function useProjectSends(
  projectIds: readonly string[],
  source: SendsSource | null,
  active: boolean
): { sends: readonly ProjectSends[]; loaded: boolean } {
  const [sends, setSends] = useState<readonly ProjectSends[]>([])
  const [loaded, setLoaded] = useState(false)
  const key = projectIds.join(',')

  useEffect(() => {
    if (!active) return
    let live = true
    const ids = key === '' ? [] : key.split(',')
    const from = source ?? createSendsSource()
    void Promise.all(
      ids.map(async (projectId): Promise<ProjectSends> => {
        let alerts: AlertSettings | null = null
        let auto: AutoExport | null = null
        let problem: string | null = null
        try {
          alerts = await from['alerts:get']({ projectId })
        } catch (error) {
          problem = errorText(error, 'Could not read the notifications.')
        }
        try {
          const read = await from['exports:getAuto']({ projectId, pageId: null })
          auto = isAuto(read) ? read : null
        } catch (error) {
          problem = problem ?? errorText(error, 'Could not read automatic export.')
        }
        return { projectId, alerts, auto, problem }
      })
    ).then((next) => {
      if (!live) return
      setSends(next)
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [key, source, active])

  return { sends, loaded }
}
