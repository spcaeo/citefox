import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import { backgroundTestMode, focusWindow, revealWindow } from '../background-mode'
import type { Logger } from '../logging/logger'
import type { ScheduleHandlers } from '../scheduler/ipc'
import { startMainTray, type MainTray, type MainTrayDeps } from './controller'
import type { TrayHandlers } from './ipc'
import type { TrayCloseEvent, TrayHost, TrayMenuEntry, TrayNotification, TrayWindow } from './host'
import { homedir } from 'node:os'
import { launchedByAutostart, linuxAutostart } from './linux-autostart'
import { loginItemSettings } from './login'

export interface InstallMainTrayInput {
  schedule: Pick<ScheduleHandlers, 'getApp'>
  queue: MainTrayDeps['queue']
  tray: Pick<TrayHandlers, 'getMenu' | 'setRunning'>
  createWindow: () => Promise<BrowserWindow>
  /** Project desktop toggle (FR-23.13). Omit to notify on every finished check. */
  allowDesktop?: (projectId: string) => boolean
  /** The open project, so a last check in another project opens there. */
  activeProject?: MainTrayDeps['activeProject']
  /** Open notices, for the "decisions waiting" item. */
  notices?: MainTrayDeps['notices']
  /** "What CiteFox needs": no login item or notification before the user agreed. */
  consent?: MainTrayDeps['consent']
  logger?: Pick<Logger, 'error'>
  /** "Test as a new user": never reads or changes the real install's login item. */
  testProfile?: boolean
  /** False: no due pass starts on its own (unpackaged test runs only). Defaults to true. */
  autoDue?: boolean
}

/**
 * One call from `src/main/index.ts` after the schedule, queue, and tray handlers exist
 * and before the first window, so close-to-tray covers that window.
 */
export function installMainTray(input: InstallMainTrayInput): MainTray {
  return startMainTray({
    host: createElectronTrayHost(input.createWindow, { testProfile: input.testProfile === true }),
    schedule: input.schedule,
    queue: input.queue,
    tray: input.tray,
    allowDesktop: input.allowDesktop,
    activeProject: input.activeProject,
    notices: input.notices,
    consent: input.consent,
    logger: input.logger,
    autoDue: input.autoDue
  })
}

export function createElectronTrayHost(
  createWindow: () => Promise<BrowserWindow>,
  options: { testProfile?: boolean } = {}
): TrayHost {
  const testProfile = options.testProfile === true
  const wrappers = new Map<BrowserWindow, TrayWindow>()
  const windowListeners: Array<(win: TrayWindow) => void> = []
  const activateListeners: Array<() => void> = []
  const quitListeners: Array<() => void> = []
  // Electron's login item API does nothing on Linux; an XDG autostart entry does the job.
  const autostart =
    process.platform === 'linux'
      ? linuxAutostart({ home: homedir(), env: process.env, execPath: process.execPath })
      : null

  const watch = (win: BrowserWindow, notify: boolean): TrayWindow => {
    const existing = wrappers.get(win)
    if (existing) return existing
    const wrapped = wrapWindow(win)
    wrappers.set(win, wrapped)
    if (!notify) return wrapped
    for (const listener of windowListeners) listener(wrapped)
    return wrapped
  }

  app.on('browser-window-created', (_event, win) => {
    watch(win, true)
  })
  app.on('activate', () => {
    for (const listener of activateListeners) listener()
  })
  app.on('before-quit', () => {
    for (const listener of quitListeners) listener()
  })

  return {
    createTray(icon, tooltip) {
      const image = nativeImage.createFromBuffer(Buffer.from(icon.png), { scaleFactor: 1 })
      if (icon.png2x !== undefined) {
        image.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(icon.png2x) })
      }
      if (process.platform === 'darwin') image.setTemplateImage(true)
      const tray = new Tray(image)
      tray.setToolTip(tooltip)
      let entries: readonly TrayMenuEntry[] = []
      let beforeOpen = (): void => undefined
      const open = (): void => {
        beforeOpen()
        tray.popUpContextMenu(Menu.buildFromTemplate(entries.map(toTemplate)))
      }
      tray.on('click', open)
      tray.on('right-click', open)
      return {
        setToolTip(next) {
          tray.setToolTip(next)
        },
        onBeforeOpen(listener) {
          beforeOpen = listener
        },
        setMenu(items) {
          entries = items
        },
        destroy() {
          tray.destroy()
        }
      }
    },
    windows: () => BrowserWindow.getAllWindows().map((win) => watch(win, false)),
    onWindow(listener) {
      windowListeners.push(listener)
    },
    onActivate(listener) {
      activateListeners.push(listener)
    },
    onBeforeQuit(listener) {
      quitListeners.push(listener)
    },
    setLoginItem(openAtLogin) {
      // A development or e2e run must never register itself as a login item, and the
      // test profile must not change the real install's item.
      if (!app.isPackaged || testProfile) return
      if (autostart !== null) autostart.set(openAtLogin)
      else app.setLoginItemSettings(loginItemSettings(openAtLogin))
    },
    loginItemEnabled() {
      if (testProfile) return false
      if (autostart !== null) return autostart.isEnabled()
      return app.getLoginItemSettings().openAtLogin
    },
    onWake(listener) {
      powerMonitor.on('resume', listener)
      powerMonitor.on('unlock-screen', listener)
    },
    launchedAtLogin() {
      if (testProfile) return false
      if (autostart !== null) return launchedByAutostart(process.argv)
      return app.getLoginItemSettings().wasOpenedAtLogin === true
    },
    quit() {
      app.quit()
    },
    notify(notification) {
      showNotification(notification)
    },
    async createWindow() {
      const win = await createWindow()
      return watch(win, false)
    }
  }
}

function wrapWindow(win: BrowserWindow): TrayWindow {
  const closeHandlers: Array<(event: TrayCloseEvent) => void> = []
  const showHandlers: Array<() => void> = []
  win.on('close', (event) => {
    const trayEvent: TrayCloseEvent = {
      preventDefault: () => {
        event.preventDefault()
      }
    }
    for (const handler of closeHandlers) handler(trayEvent)
  })
  win.on('show', () => {
    for (const handler of showHandlers) handler()
  })
  return {
    onClose(handler) {
      closeHandlers.push(handler)
    },
    onShown(handler) {
      showHandlers.push(handler)
    },
    hide() {
      if (!win.isDestroyed()) win.hide()
    },
    isDestroyed: () => win.isDestroyed(),
    isMinimized: () => !win.isDestroyed() && win.isMinimized(),
    restore() {
      if (!win.isDestroyed()) win.restore()
    },
    show() {
      if (!win.isDestroyed()) revealWindow(win, backgroundTestMode(app.isPackaged))
    },
    focus() {
      if (win.isDestroyed()) return
      const background = backgroundTestMode(app.isPackaged)
      if (background) focusWindow(win, true)
      else win.focus()
    },
    openHash(hash) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      const script = `location.hash = ${JSON.stringify(hash)}`
      void win.webContents.executeJavaScript(script).catch(() => undefined)
    }
  }
}

function toTemplate(entry: TrayMenuEntry): MenuItemConstructorOptions {
  if (entry.type === 'separator') return { type: 'separator' }
  const click = entry.click
  return {
    label: entry.label,
    enabled: entry.enabled,
    click: click === undefined || !entry.enabled ? undefined : () => click()
  }
}

function showNotification(notification: TrayNotification): void {
  // Background test runs must not put notices on the screen of the person at the computer.
  if (backgroundTestMode(app.isPackaged)) return
  if (!Notification.isSupported()) return
  const onClick = (): void => {
    notification.onClick()
  }
  try {
    const created = new Notification({
      title: notification.title,
      body: notification.body,
      actions: [{ type: 'button', text: notification.action }]
    })
    created.on('click', onClick)
    created.on('action', onClick)
    created.show()
  } catch {
    const created = new Notification({ title: notification.title, body: notification.body })
    created.on('click', onClick)
    created.show()
  }
}
