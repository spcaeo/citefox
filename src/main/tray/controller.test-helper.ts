import type {
  AppSchedule,
  CheckDueResult,
  QueueStatus,
  TrayLastCheck,
  TrayMenu
} from '@shared/domain'
import type { CheckFinishedNotice } from '@shared/ipc'
import { expect, vi } from 'vitest'
import { startMainTray } from './controller'
import type {
  TrayCloseEvent,
  TrayHost,
  TrayIcon,
  TrayMenuEntry,
  TrayNotification,
  TrayWindow
} from './host'

export const NOON = Date.parse('2026-04-20T12:00:00.000Z')

export function createRig(options?: {
  status?: QueueStatus
  menu?: TrayMenu
  windows?: boolean
  failCreate?: boolean
  allowDesktop?: (projectId: string) => boolean
  checkDue?: () => Promise<CheckDueResult>
  launchedAtLogin?: boolean
  /** The fake sleep resolves at once, so the loop's next pass runs. */
  resolveSleeps?: boolean
  /** Give the queue an `onPassSettled` hook; `settlePass` fires it. */
  passHooks?: boolean
  /** The open project the tray reads and writes. Omit for no switching. */
  activeProject?: { id: string | null }
  /** Open notices the tray counts. */
  notices?: { open: number }
  /** "What CiteFox needs" answers. Omit to allow both. */
  consent?: { loginItem: boolean; notifications: boolean }
  /** False: the loop starts no due pass by itself. */
  autoDue?: boolean
}): {
  host: FakeHost
  calls: {
    setRunning: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    checkDue: ReturnType<typeof vi.fn>
  }
  state: { menu: TrayMenu; status: QueueStatus; schedule: AppSchedule }
  sleeps: number[]
  logger: { error: ReturnType<typeof vi.fn> }
  tray: ReturnType<typeof startMainTray>
  stop: () => void
  settlePass: () => void
} {
  const state = {
    menu: options?.menu ?? menu({ pagesDueToday: 14, pagesWaiting: 4 }),
    status: options?.status ?? queue({ state: 'running', waiting: 4, pagesDue: 14 }),
    schedule: schedule()
  }
  const calls = {
    setRunning: vi.fn(),
    pause: vi.fn((request: unknown) => {
      expect(request).toEqual({ scope: 'today' })
      state.status = queue({ state: 'paused_today', waiting: state.menu.pagesWaiting })
      state.menu = { ...state.menu, pausedToday: true }
      return state.status
    }),
    resume: vi.fn(() => {
      state.status = queue({ state: 'running', waiting: state.status.waiting })
      state.menu = { ...state.menu, pausedToday: false }
      return state.status
    }),
    checkDue: vi.fn(options?.checkDue ?? (async () => ({ started: true, jobIds: [], pages: 0 })))
  }
  const host = new FakeHost()
  host.failCreate = options?.failCreate === true
  host.loginLaunch = options?.launchedAtLogin === true
  if (options?.windows !== false) host.addWindow()
  const sleeps: number[] = []
  const logger = { error: vi.fn() }
  const passListeners: Array<() => void> = []
  let sleepBudget = 3
  const tray = startMainTray({
    host,
    schedule: { getApp: () => state.schedule },
    queue: {
      getStatus: () => state.status,
      pause: (request) => calls.pause(request) as QueueStatus,
      resume: () => calls.resume() as QueueStatus,
      checkDue: () => calls.checkDue() as Promise<CheckDueResult>,
      ...(options?.passHooks === true
        ? {
            onPassSettled: (listener: () => void) => {
              passListeners.push(listener)
            }
          }
        : {})
    },
    tray: {
      getMenu: () => state.menu,
      setRunning: (running) => {
        calls.setRunning(running)
      }
    },
    allowDesktop: options?.allowDesktop,
    ...(options?.activeProject
      ? {
          activeProject: {
            read: () => options.activeProject?.id ?? null,
            write: (projectId: string) => {
              if (options.activeProject) options.activeProject.id = projectId
            }
          }
        }
      : {}),
    ...(options?.notices ? { notices: { count: () => options.notices?.open ?? 0 } } : {}),
    ...(options?.consent
      ? {
          consent: {
            loginItem: () => options.consent?.loginItem === true,
            notifications: () => options.consent?.notifications === true
          }
        }
      : {}),
    logger,
    ...(options?.autoDue !== undefined ? { autoDue: options.autoDue } : {}),
    now: () => NOON,
    timeZone: 'UTC',
    sleep: (ms) => {
      sleeps.push(ms)
      if (options?.resolveSleeps === true && sleepBudget > 0) {
        sleepBudget -= 1
        return Promise.resolve()
      }
      return new Promise(() => undefined)
    }
  })
  return {
    host,
    calls,
    state,
    sleeps,
    logger,
    tray,
    stop: () => tray.stop(),
    settlePass: () => {
      for (const listener of passListeners) listener()
    }
  }
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

export class FakeHost implements TrayHost {
  readonly icon = new FakeIcon()
  readonly wins: FakeWindow[] = []
  readonly login: boolean[] = []
  readonly notifications: TrayNotification[] = []
  quits = 0
  created = 0
  failCreate = false
  loginLaunch = false
  private windowListeners: Array<(win: TrayWindow) => void> = []
  private quitListeners: Array<() => void> = []
  private activateListeners: Array<() => void> = []
  private wakeListeners: Array<() => void> = []
  loginEnabled = false

  createTray(): TrayIcon {
    if (this.failCreate) throw new Error('no display')
    return this.icon
  }
  windows(): readonly TrayWindow[] {
    return this.wins
  }
  onWindow(listener: (win: TrayWindow) => void): void {
    this.windowListeners.push(listener)
  }
  onActivate(listener: () => void): void {
    this.activateListeners.push(listener)
  }
  onBeforeQuit(listener: () => void): void {
    this.quitListeners.push(listener)
  }
  setLoginItem(openAtLogin: boolean): void {
    this.login.push(openAtLogin)
    this.loginEnabled = openAtLogin
  }
  loginItemEnabled(): boolean {
    return this.loginEnabled
  }
  onWake(listener: () => void): void {
    this.wakeListeners.push(listener)
  }
  wakeUp(): void {
    for (const listener of this.wakeListeners) listener()
  }
  launchedAtLogin(): boolean {
    return this.loginLaunch
  }
  quit(): void {
    this.quits += 1
    for (const listener of this.quitListeners) listener()
  }
  notify(notification: TrayNotification): void {
    this.notifications.push(notification)
  }
  async createWindow(): Promise<TrayWindow> {
    this.created += 1
    return this.addWindow()
  }
  addWindow(): FakeWindow {
    const win = new FakeWindow()
    this.wins.push(win)
    for (const listener of this.windowListeners) listener(win)
    return win
  }
  activate(): void {
    for (const listener of this.activateListeners) listener()
  }
}

export class FakeIcon implements TrayIcon {
  tooltip = ''
  menu: TrayMenuEntry[] = []
  destroyed = false
  private beforeOpen: () => void = () => undefined

  setToolTip(tooltip: string): void {
    this.tooltip = tooltip
  }
  onBeforeOpen(listener: () => void): void {
    this.beforeOpen = listener
  }
  setMenu(items: readonly TrayMenuEntry[]): void {
    this.menu = [...items]
  }
  destroy(): void {
    this.destroyed = true
  }
  open(): void {
    this.beforeOpen()
  }
  click(id: string): void {
    this.open()
    const item = this.menu.find((entry) => entry.id === id)
    if (item?.click === undefined) throw new Error(`missing ${id}`)
    item.click()
  }
}

export class FakeWindow implements TrayWindow {
  hidden = false
  shown = 0
  focused = 0
  minimized = false
  destroyed = false
  hashes: string[] = []
  private closeHandlers: Array<(event: TrayCloseEvent) => void> = []
  private showHandlers: Array<() => void> = []

  onClose(handler: (event: TrayCloseEvent) => void): void {
    this.closeHandlers.push(handler)
  }
  onShown(handler: () => void): void {
    this.showHandlers.push(handler)
  }
  hide(): void {
    this.hidden = true
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  isMinimized(): boolean {
    return this.minimized
  }
  restore(): void {
    this.minimized = false
  }
  show(): void {
    this.shown += 1
    this.hidden = false
    for (const handler of this.showHandlers) handler()
  }
  focus(): void {
    this.focused += 1
  }
  openHash(hash: string): void {
    this.hashes.push(hash)
  }
  requestClose(): boolean {
    let prevented = false
    const event: TrayCloseEvent = {
      preventDefault: () => {
        prevented = true
      }
    }
    for (const handler of this.closeHandlers) handler(event)
    return prevented
  }
}

export function menu(patch: Partial<TrayMenu> = {}): TrayMenu {
  return { pausedToday: false, pagesDueToday: 0, pagesWaiting: 0, lastChecks: [], ...patch }
}

export function queue(patch: Partial<QueueStatus> = {}): QueueStatus {
  return {
    state: 'running',
    running: 0,
    waiting: 0,
    claudeConcurrency: 1,
    claudeInFlight: 0,
    trayRunning: false,
    headlessJob: false,
    nextRunAt: null,
    pagesDue: 0,
    keys: [],
    projects: [],
    ...patch
  }
}

export function schedule(): AppSchedule {
  return {
    startAtLogin: true,
    catchUpAfterSleep: true,
    checkWhenClosed: false,
    dailyCheckTime: '08:00'
  }
}

export function lastCheck(): TrayLastCheck {
  return {
    projectId: 'proj-1',
    pageId: 'page-1',
    label: 'Text alerts for business',
    score: 50,
    change: 12,
    finishedAt: '2026-04-20T08:00:00.000Z'
  }
}

export function finished(patch: Partial<CheckFinishedNotice> = {}): CheckFinishedNotice {
  return {
    jobId: 'job-1',
    projectId: 'proj-1',
    pageId: 'page-1',
    pageLabel: 'Text alerts for business',
    marketId: 'us',
    pageCited: 3,
    aiosShown: 8,
    pageCitedChange: 1,
    score: 50,
    scoreChange: 12,
    contentChanged: true,
    ...patch
  }
}
