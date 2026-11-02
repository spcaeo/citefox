import { useCallback, useEffect, useState } from 'react'
import type { PageSummary } from '@shared/domain'
import type { ProjectList, SetupProgress, SetupStatus } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { LiveSource } from './source'

/** A page the runner is working on now, from `setup:progress`. */
export interface RunningSetupPage {
  projectId: string
  pageId: string
  step: SetupProgress['step']
  message: string
}

export interface SetupState {
  status: SetupStatus | null
  error: string | null
  /** Pages seen starting in this window and not yet finished, by `projectId\npageId`. */
  running: ReadonlyMap<string, RunningSetupPage>
  /** Pages finished today that this window saw finish. */
  doneSeen: readonly RunningSetupPage[]
  /** Pages still setting up in every project, for the drill-downs. Null until read. */
  settingUp: readonly PageSummary[] | null
  projects: ProjectList | null
  retry: (request?: { projectId: string; pageIds: readonly string[] }) => Promise<void>
  setPaused: (paused: boolean) => Promise<void>
  setRate: (pagesPerHour: number) => Promise<void>
}

export function setupKey(projectId: string, pageId: string): string {
  return `${projectId}\n${pageId}`
}

/**
 * Background page setup (FR-20.6, SCH-12), kept current from
 * `setup:progress`. `withPages` also reads each project's setting-up pages so
 * the Status card's counts can open the pages behind them.
 */
export function useSetupStatus(source: LiveSource | null, withPages = false): SetupState {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<ReadonlyMap<string, RunningSetupPage>>(new Map())
  const [doneSeen, setDoneSeen] = useState<readonly RunningSetupPage[]>([])
  const [settingUp, setSettingUp] = useState<readonly PageSummary[] | null>(null)
  const [projects, setProjects] = useState<ProjectList | null>(null)

  useEffect(() => {
    if (!source) return
    let live = true
    void source['setup:status']().then(
      (next) => {
        if (live) setStatus(next)
      },
      (cause: unknown) => {
        if (live) setError(errorText(cause, 'Could not read page setup.'))
      }
    )
    const off = source['setup:progress']((progress) => {
      if (!live) return
      setStatus(progress.status)
      const page: RunningSetupPage = {
        projectId: progress.projectId,
        pageId: progress.pageId,
        step: progress.step,
        message: progress.message
      }
      const key = setupKey(progress.projectId, progress.pageId)
      setRunning((current) => {
        const next = new Map(current)
        if (progress.state === 'running') next.set(key, page)
        else next.delete(key)
        return next
      })
      if (progress.state === 'done') {
        setDoneSeen((current) => [
          page,
          ...current.filter((item) => setupKey(item.projectId, item.pageId) !== key)
        ])
      }
    })
    return () => {
      live = false
      off()
    }
  }, [source])

  // The pages behind the counts change when a count does.
  const countsKey = status ? `${status.waiting}:${status.running}:${status.failed}` : ''
  useEffect(() => {
    if (!source || !withPages || countsKey === '') return
    let live = true
    void (async () => {
      try {
        const list = await source['projects:list']()
        const pages = await Promise.all(
          list.projects.map((project) =>
            source['pages:list']({ projectId: project.id }).then(
              (result) => result.pages.filter((page) => page.status === 'setting_up'),
              () => []
            )
          )
        )
        if (!live) return
        setProjects(list)
        setSettingUp(pages.flat())
      } catch {
        if (live) setSettingUp(null)
      }
    })()
    return () => {
      live = false
    }
  }, [source, withPages, countsKey])

  const apply = useCallback(async (work: () => Promise<SetupStatus>) => {
    try {
      setStatus(await work())
      setError(null)
    } catch (cause) {
      setError(errorText(cause, 'Could not change page setup.'))
    }
  }, [])

  return {
    status,
    error,
    running,
    doneSeen,
    settingUp,
    projects,
    retry: async (request) => {
      if (!source) return
      await apply(() => source['setup:retry'](request ?? {}))
    },
    setPaused: async (paused) => {
      if (!source) return
      await apply(() => source['setup:pause']({ paused }))
    },
    setRate: async (pagesPerHour) => {
      if (!source) return
      await apply(() => source['setup:setRate']({ pagesPerHour }))
    }
  }
}
