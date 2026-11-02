import type { CheckFinishedNotice } from '@shared/ipc'
import { VIEW_RESULTS } from '../email/types'
import { focusExistingWindow } from '../headless/single-instance'
import type { Logger } from '../logging/logger'
import type { QueueHandlers } from '../queue/ipc'
import type { ScheduleHandlers } from '../scheduler/ipc'
import { TRAY_ICON_PNG, TRAY_ICON_PNG_2X } from './icon'
import type { TrayHandlers } from './ipc'
import type { TrayHost, TrayIcon, TrayWindow } from './host'
import {
  ASK_HASH,
  buildTrayMenu,
  CHECK_HASH,
  STATUS_HASH,
  msUntilNextLocalDay,
  resultsHash,
  SETTINGS_HASH,
  trayNoticeCopy
} from './menu'
import type { TrayMenuActions } from './menu'
import { pluralize } from '@shared/pluralize'
import { projectRouteHash } from '@shared/project-route'

/**
 * SCH-3. The loop re-checks the wall clock at least this often. Timers do not
 * count time the computer slept, so one long timer to midnight could fire
 * hours late; a short tick compares `Date.now()` with the next due time.
 */
export const WALL_CLOCK_TICK_MS = 5 * 60_000

/** Ids of jobs a due pass made (`dueJobId`). Their notices are summed into one per pass. */
const DUE_JOB_PREFIX = 'due-'

export interface MainTrayDeps {
  host: TrayHost
  schedule: Pick<ScheduleHandlers, 'getApp'>
  queue: Pick<QueueHandlers, 'getStatus' | 'pause' | 'resume' | 'checkDue'> &
    Partial<Pick<QueueHandlers, 'onPassSettled'>>
  tray: Pick<TrayHandlers, 'getMenu' | 'setRunning'>
  /**
   * FR-23.13. When omitted, a finished check always notifies (FR-24.7).
   * Production passes the project `alerts.desktop` flag. A project with no
   * stored alerts row has that flag on.
   */
  allowDesktop?: (projectId: string) => boolean
  /**
   * The open project (`app_state.active_project_id`). Page routes read it, so
   * opening a last check or a notice from another project records the switch
   * and opens a project route (`#/p/<projectId>/…`). Omit to open the page
   * without switching.
   */
  activeProject?: {
    read(): string | null
    write(projectId: string): void
  }
  /** Open "ask me" notices (FR-11.4, FR-11.7). Omit for no menu item. */
  notices?: { count(): number }
  /**
   * What the user agreed to in "What CiteFox needs". CiteFox adds no login item
   * and raises no desktop notification (on macOS the first one opens a system
   * prompt) until the matching answer is true. Omit to allow both (tests).
   */
  consent?: { loginItem(): boolean; notifications(): boolean }
  logger?: Pick<Logger, 'error'>
  /** Defaults to `Date.now`. Tests freeze this. */
  now?: () => number
  /** Defaults to the computer zone, the same fallback `bindScheduleQueueTray` uses. */
  timeZone?: string
  /** Defaults to `setTimeout`. Tests capture the delay. */
  sleep?: (ms: number) => Promise<void>
  /**
   * False keeps the loop from starting due passes on its own (start-up, ticks, wake).
   * The tray's "Check due pages now" still runs one. Only unpackaged test runs turn it
   * off (`CITEFOX_AUTO_CHECKS=off`), so seeded checks with fixed dates never go due mid-test.
   * Defaults to true.
   */
  autoDue?: boolean
}

/** A desktop alert that opens `hash` when clicked (FR-11.4 cap reached, for example). */
export interface TrayAlert {
  /** Null skips the project's desktop toggle. */
  projectId: string | null
  title: string
  body: string
  action: string
  hash: string
}

export interface MainTray {
  /** FR-24.7. Safe to call when the icon failed to create. */
  notifyCheckFinished(notice: CheckFinishedNotice): void
  /** Shows one alert, unless the project turned desktop notifications off. */
  notifyAlert(alert: TrayAlert): void
  /** Stops the due-check loop and removes the icon. Tests use this. */
  stop(): void
}

/**
 * Menu-bar tray (FR-24.6, FR-24.7, FR-24.8, SCH-1, SCH-2, NFR-17).
 * Electron stays on `deps.host`.
 *
 * TODO(NFR-17): The close button hides the window. Checks keep running.
 * Quit CiteFox is what exits. The SRS does not say hide versus destroy.
 * TODO(SCH-1): `startAtLogin` is applied when the menu is built. `schedule:updateApp`
 * does not notify the tray, so a Settings change is picked up on the next open,
 * tray action, or wall-clock tick.
 * A pause or resume made outside this menu is noticed when the menu opens and
 * at the next wall-clock tick. `CheckQueue` pause and resume take no
 * listener. `queue:status` is an IPC push to windows, not a main-process event
 * this tray can subscribe to. A tray Resume wakes the loop immediately.
 */
export function startMainTray(deps: MainTrayDeps): MainTray {
  const now = deps.now ?? ((): number => Date.now())
  const autoDue = deps.autoDue !== false
  // Read again on every wait: the computer's zone can change while CiteFox runs.
  const zone = (): string => deps.timeZone ?? systemTimeZone()
  const sleep = deps.sleep ?? delay
  let appliedLogin: boolean | null = null
  const passNotices: CheckFinishedNotice[] = []
  let stopped = false
  let quitting = false
  let icon: TrayIcon | undefined
  let generation = 0
  let waiters: Array<() => void> = []
  let inflight: Promise<void> | null = null
  // Electron 44 has no openAsHidden. wasOpenedAtLogin hides this launch only.
  let hideNextShow = deps.host.launchedAtLogin()
  const bound = new Set<TrayWindow>()

  const actions: TrayMenuActions = {
    open: () => {
      void show().catch(logFailure)
    },
    ask: () => {
      void show(ASK_HASH).catch(logFailure)
    },
    checkDue: () => {
      void runDue().then(() => refresh())
    },
    pauseToday: () => {
      deps.queue.pause({ scope: 'today' })
      refresh()
    },
    resume: () => {
      deps.queue.resume()
      wake()
      refresh()
    },
    settings: () => {
      void show(SETTINGS_HASH).catch(logFailure)
    },
    quit: () => {
      deps.host.quit()
    },
    openCheck: (check) => {
      void openPage(check.projectId, check.pageId).catch(logFailure)
    },
    openDue: () => {
      void show(CHECK_HASH).catch(logFailure)
    },
    openNotices: () => {
      void show(STATUS_HASH).catch(logFailure)
    }
  }

  deps.host.onBeforeQuit(() => {
    quitting = true
  })

  try {
    icon = deps.host.createTray({ png: TRAY_ICON_PNG, png2x: TRAY_ICON_PNG_2X }, 'CiteFox')
  } catch (error: unknown) {
    deps.logger?.error('CiteFox could not create the tray', error)
    return { notifyCheckFinished, notifyAlert, stop }
  }
  deps.host.onActivate(() => {
    const win = liveWindow()
    if (win === undefined) return
    focusExistingWindow(win)
  })
  // SCH-3. Wake and unlock run the due pass now; the planner decides what a catch-up runs.
  deps.host.onWake(() => {
    wake()
  })
  deps.queue.onPassSettled?.(() => {
    flushPassNotices()
  })
  deps.host.onWindow(bindWindow)
  for (const win of deps.host.windows()) bindWindow(win)
  icon.onBeforeOpen(() => refresh())
  deps.tray.setRunning(true)
  refresh()
  // Let the caller finish wiring `notifyCheckFinished` before a due pass can finish.
  void Promise.resolve().then(() => {
    if (!stopped) void loop()
  })

  return { notifyCheckFinished, notifyAlert, stop }

  function notifyAlert(alert: TrayAlert): void {
    if (alert.projectId !== null && !desktopAllowed(alert.projectId)) return
    notify({
      title: alert.title,
      body: alert.body,
      action: alert.action,
      onClick: () => {
        void show(alert.hash).catch(logFailure)
      }
    })
  }

  function notifyCheckFinished(notice: CheckFinishedNotice): void {
    if (!desktopAllowed(notice.projectId)) return
    // A due pass gets one summary when it settles, not one toast per page.
    if (deps.queue.onPassSettled !== undefined && notice.jobId.startsWith(DUE_JOB_PREFIX)) {
      passNotices.push(notice)
      return
    }
    showPageNotice(notice)
  }

  function flushPassNotices(): void {
    const notices = passNotices.splice(0, passNotices.length)
    const only = notices[0]
    if (only === undefined || icon === undefined) return
    if (notices.length === 1) {
      showPageNotice(only)
      return
    }
    const copy = passSummaryCopy(notices)
    notify({
      title: copy.title,
      body: copy.body,
      action: VIEW_RESULTS,
      onClick: () => {
        void show().catch(logFailure)
      }
    })
    refresh()
  }

  function showPageNotice(notice: CheckFinishedNotice): void {
    const copy = trayNoticeCopy(notice)
    notify({
      title: copy.title,
      body: copy.body,
      action: VIEW_RESULTS,
      onClick: () => {
        void openPage(notice.projectId, notice.pageId).catch(logFailure)
      }
    })
    refresh()
  }

  function stop(): void {
    stopped = true
    wake()
    icon?.destroy()
    icon = undefined
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        refresh()
        const current = deps.queue.getStatus()
        if (autoDue && current.state !== 'paused_all' && current.state !== 'paused_today') {
          await runDue()
          if (stopped) return
          refresh()
        }
      } catch (error: unknown) {
        logFailure(error)
      }
      if (stopped) return
      await wait(nextWaitMs())
    }
  }

  /**
   * The shortest of: the wall-clock tick, local midnight, and the queue's next
   * future slot. A past `nextRunAt` (a page busy with a manual check) is ignored.
   */
  function nextWaitMs(): number {
    const at = now()
    let ms = Math.min(WALL_CLOCK_TICK_MS, msUntilNextLocalDay(at, zone()))
    try {
      const next = deps.queue.getStatus().nextRunAt
      const slot = next === null ? Number.NaN : Date.parse(next)
      if (Number.isFinite(slot) && slot > at) ms = Math.min(ms, slot - at)
    } catch (error: unknown) {
      logFailure(error)
    }
    return Math.max(1, ms)
  }

  /**
   * SCH-2. One due pass at a time in this process. A second request joins it
   * instead of calling `queue.checkDue` again. The queue and the day-pass store
   * still make a second pass a no-op if this lock is not held.
   */
  function runDue(): Promise<void> {
    if (inflight) return inflight
    inflight = deps.queue
      .checkDue()
      .then(() => undefined)
      .catch((error: unknown) => {
        deps.logger?.error('CiteFox could not run due checks', error)
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  function refresh(): void {
    if (icon === undefined) return
    let menu: ReturnType<TrayHandlers['getMenu']>
    let status: ReturnType<QueueHandlers['getStatus']>
    let schedule: ReturnType<ScheduleHandlers['getApp']>
    try {
      menu = deps.tray.getMenu()
      status = deps.queue.getStatus()
      schedule = deps.schedule.getApp()
    } catch (error: unknown) {
      deps.logger?.error('CiteFox could not read tray status', error)
      return
    }
    applyLoginItem(schedule.startAtLogin)
    const built = buildTrayMenu({ menu, status, actions, decisions: openDecisions() })
    icon.setToolTip(built.tooltip)
    icon.setMenu(built.items)
  }

  /** A desktop notification, unless the user has not turned them on yet. */
  function notify(notification: Parameters<TrayHost['notify']>[0]): void {
    if (deps.consent && !deps.consent.notifications()) return
    deps.host.notify(notification)
  }

  /**
   * SCH-1. Changes the login item only when the setting differs from the system.
   * It is never added before the user agreed to it ("Login Item Added" is a system notice).
   */
  function applyLoginItem(want: boolean): void {
    if (appliedLogin === want) return
    try {
      if (want && deps.consent && !deps.consent.loginItem() && !deps.host.loginItemEnabled()) {
        return
      }
      if (deps.host.loginItemEnabled() !== want) deps.host.setLoginItem(want)
      appliedLogin = want
    } catch (error: unknown) {
      deps.logger?.error('CiteFox could not update start at login', error)
    }
  }

  function bindWindow(win: TrayWindow): void {
    if (bound.has(win)) return
    bound.add(win)
    // TODO(NFR-17): Hide instead of destroy. See the note on startMainTray.
    win.onClose((event) => {
      if (quitting || win.isDestroyed()) return
      event.preventDefault()
      win.hide()
    })
    win.onShown(() => {
      if (!hideNextShow) return
      hideNextShow = false
      win.hide()
    })
  }

  function liveWindow(): TrayWindow | undefined {
    return deps.host.windows().find((win) => !win.isDestroyed())
  }

  async function show(hash?: string): Promise<void> {
    const win = liveWindow() ?? (await deps.host.createWindow())
    if (win.isDestroyed()) return
    focusExistingWindow(win)
    if (hash === undefined) return
    win.openHash(hash)
  }

  /**
   * A page's Results, in its own project. When that is not the open project,
   * main records the switch (so a new window starts there) and the window
   * opens a project route, which switches and opens the page in one step.
   */
  function openPage(projectId: string, pageId: string): Promise<void> {
    const hash = resultsHash(pageId)
    return show(switchProject(projectId) ? projectRouteHash(projectId, hash) : hash)
  }

  /** Open notices, or 0 when they cannot be read (the menu still builds). */
  function openDecisions(): number {
    if (deps.notices === undefined) return 0
    try {
      return deps.notices.count()
    } catch (error: unknown) {
      deps.logger?.error('CiteFox could not read notices', error)
      return 0
    }
  }

  /** True when the open project changed. A failed switch still opens the page. */
  function switchProject(projectId: string): boolean {
    if (deps.activeProject === undefined) return false
    try {
      if (deps.activeProject.read() === projectId) return false
      deps.activeProject.write(projectId)
      return true
    } catch (error: unknown) {
      deps.logger?.error('CiteFox could not open that project', error)
      return false
    }
  }

  function desktopAllowed(projectId: string): boolean {
    if (deps.allowDesktop === undefined) return true
    try {
      return deps.allowDesktop(projectId)
    } catch (error: unknown) {
      deps.logger?.error('CiteFox could not read notification settings', error)
      return false
    }
  }

  function wait(ms: number): Promise<void> {
    const token = generation
    return new Promise((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      waiters.push(finish)
      void sleep(ms).then(
        () => {
          if (generation !== token) return
          finish()
        },
        () => {
          if (generation !== token) return
          finish()
        }
      )
    })
  }

  function wake(): void {
    generation += 1
    const pending = waiters
    waiters = []
    for (const resolve of pending) resolve()
  }

  function logFailure(error: unknown): void {
    deps.logger?.error('CiteFox tray action failed', error)
  }
}

/** One notice for a due pass that checked several pages. */
export function passSummaryCopy(notices: readonly CheckFinishedNotice[]): {
  title: string
  body: string
} {
  const cited = notices.filter((notice) => notice.pageCited > 0).length
  return {
    title: `CiteFox checked ${pluralize(notices.length, 'page')}`,
    body: `${cited} of ${pluralize(notices.length, 'page')} ${cited === 1 ? 'is' : 'are'} cited in AI Overviews. Open CiteFox to see each page's results.`
  }
}

function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone.length > 0 ? zone : 'UTC'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
