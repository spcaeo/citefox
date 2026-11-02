import { useCallback, useEffect, useRef, useState } from 'react'
import { rollupPageFixes } from '@shared/page-fixes'
import { fixTitle, sourcesLabel } from '../fixes/todo/model'
import { pathOf } from '../fixes/model'
import { NO_SEARCH_DATA, type SearchData } from './searchRank'

/** Where Ctrl+K reads the project's competitors, fixes and report schedules. Tests pass a fake. */
export interface SearchDataSource {
  load(projectId: string): Promise<SearchData>
}

/** The live source over the preload bridge: four reads, each one allowed to fail alone. */
export function createSearchDataSource(): SearchDataSource {
  return {
    load: async (projectId) => {
      if (typeof window === 'undefined' || !window.citefox) return NO_SEARCH_DATA
      const bridge = window.citefox
      const [competitors, searches, logged, reports] = await Promise.all([
        bridge['competitors:list']({ projectId }).catch(() => null),
        bridge['fixes:searches']({ projectId }).catch(() => null),
        bridge['fixes:listProject']({ projectId }).catch(() => null),
        bridge['reports:list']().catch(() => null)
      ])
      const rollup = searches ? rollupPageFixes(searches.searches, null) : null
      return {
        competitors: (competitors?.competitors ?? []).map((item) => ({
          id: item.id,
          name: item.name || item.domain || 'Competitor',
          domain: item.domain
        })),
        pageFixes: (rollup?.fixes ?? []).map((fix) => ({
          id: fix.id,
          title: fixTitle(fix),
          kind: fix.kind,
          topics: sourcesLabel(fix)
        })),
        logged: (logged?.fixes ?? []).map(({ fix }) => ({
          id: fix.id,
          number: fix.number,
          page: fix.url ? pathOf(fix.url) : `Fix ${fix.number}`
        })),
        reports: (reports ?? [])
          .filter((item) => item.projectId === null || item.projectId === projectId)
          .map((item) => ({ id: item.id, name: item.name }))
      }
    }
  }
}

/**
 * The project's things Ctrl+K finds besides topics, pages and questions. They load
 * once each time the box opens (never per key), so the list is fresh and typing
 * filters it with no call to main. A project switch drops what was loaded.
 */
export function useSearchData(
  projectId: string | null,
  source: SearchDataSource
): { data: SearchData; load: () => void } {
  const [answer, setAnswer] = useState<{ projectId: string; data: SearchData } | null>(null)
  const asked = useRef(0)
  useEffect(() => {
    asked.current += 1
  }, [projectId])
  const load = useCallback(() => {
    if (projectId === null) return
    const ticket = ++asked.current
    source.load(projectId).then(
      (data) => {
        if (ticket === asked.current) setAnswer({ projectId, data })
      },
      () => undefined
    )
  }, [projectId, source])
  return {
    data: answer !== null && answer.projectId === projectId ? answer.data : NO_SEARCH_DATA,
    load
  }
}
