import { useEffect, useMemo, useState } from 'react'
import { NO_SITE_TYPE_SETTINGS, type SiteTypeSettings } from '@shared/site-overrides'
import { createCompetitorsSource, type CompetitorsSource } from '../competitors/source'
import { useChangeVersion } from '../shell/changes'
import type { SourceCompetitor } from './sources'

export interface SiteTypeContext {
  competitors: readonly SourceCompetitor[]
  settings: SiteTypeSettings
}

const NONE: SiteTypeContext = { competitors: [], settings: NO_SITE_TYPE_SETTINGS }

/**
 * The project's saved competitors and hand-picked site types, so a read-only list of
 * sites (Who gets cited, Sources Google listed) shows the same type as every other.
 * Without a project, or when either read fails, every site reads automatic.
 */
export function useSiteTypeSettings(
  projectId: string | null,
  source?: Pick<CompetitorsSource, 'competitors:list' | 'competitors:siteTypes'>
): SiteTypeContext {
  const client = useMemo(() => source ?? createCompetitorsSource(), [source])
  const [competitors, setCompetitors] = useState<readonly SourceCompetitor[]>([])
  const [settings, setSettings] = useState<SiteTypeSettings>(NO_SITE_TYPE_SETTINGS)
  const competitorsChanged = useChangeVersion('competitors')
  const typesChanged = useChangeVersion('siteTypes')

  useEffect(() => {
    if (projectId === null) return
    let live = true
    void Promise.resolve()
      .then(() => client['competitors:list']({ projectId }))
      .then(
        (result) => {
          if (!live) return
          setCompetitors(
            result.competitors.map((item) => ({
              id: item.id,
              name: item.name,
              domain: item.domain,
              aliases: item.aliases
            }))
          )
        },
        () => undefined
      )
    return () => {
      live = false
    }
  }, [client, projectId, competitorsChanged])

  useEffect(() => {
    if (projectId === null) return
    let live = true
    void Promise.resolve()
      .then(() => client['competitors:siteTypes']({ projectId }))
      .then(
        (result) => {
          if (live) setSettings(result)
        },
        () => undefined
      )
    return () => {
      live = false
    }
  }, [client, projectId, typesChanged])

  return useMemo(
    () => (projectId === null ? NONE : { competitors, settings }),
    [projectId, competitors, settings]
  )
}
