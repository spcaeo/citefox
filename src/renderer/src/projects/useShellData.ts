import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PageScoreList,
  PageSummary,
  ProjectSchedule,
  ProjectScoreList,
  QueueStatus
} from '@shared/domain'
import type { PinnedPage, ProjectDetail, TrayLine } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { useAppData } from '../shell/useAppData'
import { useEngineUpdates, type EngineUpdate } from '../shell/useEngineUpdates'
import { readActiveProject } from './activeProject'
import type { ShellClient } from './client'

export interface ScoreBoard {
  projects: ProjectScoreList | null
  pages: PageScoreList | null
  schedules: readonly ProjectSchedule[]
  queue: QueueStatus | null
}

/** The rows the sidebar and the Pages screen show for the active project. */
export interface PageData {
  pages: readonly PageSummary[]
  foundPageCount: number
  pinned: readonly PinnedPage[]
  tray: TrayLine | null
}

interface ShellState extends PageData {
  projects: readonly ProjectDetail[]
  active: ProjectDetail | null
  scores: ScoreBoard
  ready: boolean
  error: string | null
  /**
   * Set when the first load of the project list failed. The shell then shows
   * the error with Try again, not the first-run "No project yet" screens.
   */
  loadFailed: string | null
  /** Goes up after each pushed refresh, so screens that load their own data can reload. */
  revision: number
}

const EMPTY_BOARD: ScoreBoard = {
  projects: null,
  pages: null,
  schedules: [],
  queue: null
}

const EMPTY_PAGES: PageData = { pages: [], foundPageCount: 0, pinned: [], tray: null }

const INITIAL: ShellState = {
  projects: [],
  active: null,
  ...EMPTY_PAGES,
  scores: EMPTY_BOARD,
  ready: false,
  error: null,
  loadFailed: null,
  revision: 0
}

export interface ShellData extends Omit<ShellState, 'revision'> {
  app: ReturnType<typeof useAppData>
  revision: number
  /** Everything: projects, details, pages, scores, and schedules. */
  reload: () => Promise<void>
  /** Pages, pins, and the tray line of the active project. Use after a pin or unpin. */
  refreshPages: () => Promise<void>
  /**
   * The active project's detail and pages, the scores, the queue, and the
   * schedules of `projectIds`. Use after adding a page or changing a project.
   */
  refreshActivity: (projectIds?: readonly string[]) => Promise<void>
  /** Puts a project the engine just returned into the list without a reload. */
  applyProject: (detail: ProjectDetail) => void
  /** Switches project. Resolves with the new project's pages, or null if a newer load won. */
  selectProject: (projectId: string) => Promise<PageData | null>
}

/**
 * Shell data with three guards against stale answers:
 * a full load (start-up, create, switch) starts a new generation and drops
 * anything older; a partial refresh drops its answer when a newer refresh of
 * the same kind started; and nothing for project A is applied once project B
 * is active.
 */
export function useShellData(client: ShellClient): ShellData {
  const app = useAppData(client)
  const [state, setState] = useState<ShellState>(INITIAL)
  const guards = useRef<Guards>({
    generation: 0,
    pages: 0,
    activity: 0,
    activeId: null,
    loaded: false
  })
  const reloadApp = app.reload

  const reload = useCallback(async () => {
    const ticket = ++guards.current.generation
    // A retry after a failed first load shows "Loading projects…" again.
    setState((current) =>
      current.loadFailed ? { ...current, ready: false, loadFailed: null } : current
    )
    try {
      const listed = await readActiveProject(client)
      if (ticket !== guards.current.generation) return
      const active = listed.active
      if (!active) {
        guards.current.activeId = null
        guards.current.loaded = true
        setState((current) => ({
          ...INITIAL,
          projects: listed.details,
          ready: true,
          revision: current.revision
        }))
        return
      }
      const [pageData, board] = await Promise.all([
        loadPageData(client, active.id),
        loadScores(client, listed.details, active.id)
      ])
      if (ticket !== guards.current.generation) return
      guards.current.activeId = active.id
      guards.current.loaded = true
      setState((current) => ({
        ...current,
        projects: listed.details,
        active,
        ...pageData,
        scores: board,
        ready: true,
        error: null,
        loadFailed: null
      }))
    } catch (cause) {
      if (ticket !== guards.current.generation) return
      const message = messageFrom(cause)
      const loaded = guards.current.loaded
      // Once projects have loaded, a failed reload is an alert over the screens
      // that still work. Before that there is nothing to show but the error.
      setState((current) =>
        loaded
          ? { ...current, ready: true, error: message }
          : { ...current, ready: true, error: null, loadFailed: message }
      )
    }
  }, [client])

  const refreshPages = useCallback(async () => {
    const projectId = guards.current.activeId
    if (!projectId) return
    const ticket = guards.current.generation
    const own = ++guards.current.pages
    try {
      const pageData = await loadPageData(client, projectId)
      if (!isLatest(guards.current, ticket, 'pages', own, projectId)) return
      setState((state) => ({ ...state, ...pageData, error: null }))
    } catch (cause) {
      if (!isLatest(guards.current, ticket, 'pages', own, projectId)) return
      setState((state) => ({ ...state, error: messageFrom(cause) }))
    }
  }, [client])

  const refreshWith = useCallback(
    async (projectIds: readonly string[], queue: QueueStatus | null): Promise<boolean> => {
      const projectId = guards.current.activeId
      if (!projectId) return false
      const ticket = guards.current.generation
      const own = ++guards.current.activity
      const scheduleIds = [...new Set([projectId, ...projectIds])]
      try {
        const [detail, pageData, projectScores, pageScores, status, schedules] = await Promise.all([
          client.getProject({ projectId }),
          loadPageData(client, projectId),
          client.listProjectScores(),
          client.listPageScores({ projectId }),
          queue ? Promise.resolve(queue) : client.getQueueStatus(),
          Promise.all(scheduleIds.map((id) => client.getProjectSchedule({ projectId: id })))
        ])
        if (!isLatest(guards.current, ticket, 'activity', own, projectId)) return false
        setState((state) => ({
          ...state,
          projects: replaceProject(state.projects, detail),
          active: detail,
          ...pageData,
          scores: {
            projects: projectScores,
            pages: pageScores,
            queue: status,
            schedules: mergeSchedules(state.scores.schedules, schedules)
          },
          error: null
        }))
        return true
      } catch (cause) {
        if (!isLatest(guards.current, ticket, 'activity', own, projectId)) return false
        setState((state) => ({ ...state, error: messageFrom(cause) }))
        return false
      }
    },
    [client]
  )

  const refreshActivity = useCallback(
    async (projectIds: readonly string[] = []) => {
      await refreshWith(projectIds, null)
    },
    [refreshWith]
  )

  const applyProject = useCallback((detail: ProjectDetail) => {
    setState((state) => ({
      ...state,
      projects: replaceProject(state.projects, detail),
      active: state.active?.id === detail.id ? detail : state.active
    }))
  }, [])

  const selectProject = useCallback(
    async (projectId: string): Promise<PageData | null> => {
      const ticket = ++guards.current.generation
      const detail = await client.switchProject({ projectId })
      const [pageData, pageScores, schedule] = await Promise.all([
        loadPageData(client, detail.id),
        client.listPageScores({ projectId: detail.id }),
        client.getProjectSchedule({ projectId: detail.id })
      ])
      if (ticket !== guards.current.generation) return null
      guards.current.activeId = detail.id
      guards.current.loaded = true
      setState((state) => ({
        ...state,
        projects: replaceProject(state.projects, detail),
        active: detail,
        ...pageData,
        scores: {
          ...state.scores,
          pages: pageScores,
          schedules: mergeSchedules(state.scores.schedules, [schedule])
        },
        ready: true,
        error: null,
        loadFailed: null
      }))
      return pageData
    },
    [client]
  )

  useEffect(() => {
    let cancelled = false
    const ref = guards.current
    void Promise.resolve().then(() => (cancelled ? undefined : reload()))
    return () => {
      cancelled = true
      ref.generation += 1
    }
  }, [reload])

  const onEngineUpdate = useCallback(
    (update: EngineUpdate) => {
      if (update.queue) {
        const queue = update.queue
        setState((state) => ({ ...state, scores: { ...state.scores, queue } }))
      }
      void Promise.all([refreshWith(update.projectIds, update.queue), reloadApp()]).then(() => {
        setState((state) => ({ ...state, revision: state.revision + 1 }))
      })
    },
    [refreshWith, reloadApp]
  )
  useEngineUpdates(client, onEngineUpdate)

  return {
    app,
    ...state,
    reload,
    refreshPages,
    refreshActivity,
    applyProject,
    selectProject
  }
}

interface Guards {
  generation: number
  pages: number
  activity: number
  activeId: string | null
  /** True once a full load has succeeded. */
  loaded: boolean
}

function isLatest(
  guards: Guards,
  ticket: number,
  kind: 'pages' | 'activity',
  own: number,
  projectId: string
): boolean {
  return guards.generation === ticket && guards[kind] === own && guards.activeId === projectId
}

async function loadPageData(client: ShellClient, projectId: string): Promise<PageData> {
  const [pageList, pins, tray] = await Promise.all([
    client.listPages({ projectId }),
    client.pinnedPages({ projectId }),
    client.trayLine({ projectId })
  ])
  return {
    pages: pageList.pages,
    foundPageCount: pageList.foundPageCount,
    pinned: pins.pages,
    tray
  }
}

async function loadScores(
  client: ShellClient,
  projects: readonly ProjectDetail[],
  projectId: string
): Promise<ScoreBoard> {
  const [projectScores, queue, schedules, pages] = await Promise.all([
    client.listProjectScores(),
    client.getQueueStatus(),
    Promise.all(projects.map((project) => client.getProjectSchedule({ projectId: project.id }))),
    client.listPageScores({ projectId })
  ])
  return { projects: projectScores, pages, schedules, queue }
}

function replaceProject(
  projects: readonly ProjectDetail[],
  detail: ProjectDetail
): readonly ProjectDetail[] {
  return projects.some((project) => project.id === detail.id)
    ? projects.map((project) => (project.id === detail.id ? detail : project))
    : [...projects, detail]
}

function mergeSchedules(
  current: readonly ProjectSchedule[],
  fresh: readonly ProjectSchedule[]
): readonly ProjectSchedule[] {
  const byId = new Map(fresh.map((schedule) => [schedule.projectId, schedule]))
  const merged = current.map((schedule) => byId.get(schedule.projectId) ?? schedule)
  for (const schedule of fresh) {
    if (!current.some((item) => item.projectId === schedule.projectId)) merged.push(schedule)
  }
  return merged
}

function messageFrom(cause: unknown): string {
  return errorText(cause, 'Could not load projects.')
}
