import { devServerOrigin } from './security'
import {
  clampWindowBounds,
  defaultWindowBounds,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  nextSavedBounds,
  readWindowState,
  writeWindowState,
  type DisplayWorkArea,
  type WindowBounds
} from './window-state'
import { mainWindowWebPreferences } from './window-options'
import { app, BrowserWindow, nativeTheme, screen, type Display } from 'electron'
import { join } from 'node:path'
import appIcon from '../../resources/icon.png?asset'
import { backgroundTestMode, revealWindow } from './background-mode'
import { windowBackground } from './theme'
import { debounce } from './debounce'

/** Moving or resizing fires many events a second; the file is written once the window settles. */
const SAVE_BOUNDS_AFTER_MS = 400

export interface MainWindowOptions {
  /** `window-state.json` in the app data folder. Omit to skip persistence. */
  stateFile?: string
  displays?: () => readonly DisplayWorkArea[]
}

export async function createMainWindow(options?: MainWindowOptions): Promise<BrowserWindow> {
  const displays = options?.displays?.() ?? displaysFromScreen()
  const stored = options?.stateFile === undefined ? null : readWindowState(options.stateFile)
  const bounds = stored === null ? defaultFor(displays) : clampWindowBounds(stored, displays)
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: Math.min(MIN_WINDOW_WIDTH, bounds.width),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, bounds.height),
    show: false,
    autoHideMenuBar: true,
    // The page's --ground in the theme on screen (main/theme.ts), so nothing flashes white.
    backgroundColor: windowBackground(nativeTheme),
    title: 'CiteFox',
    // The fox in the title bar, task bar and dock (Linux and unpackaged runs need it set here;
    // installers take build/icon.png).
    icon: appIcon,
    webPreferences: mainWindowWebPreferences(join(__dirname, '../preload/index.js'), {
      devTools: !app.isPackaged
    })
  })

  let saved: WindowBounds = bounds
  const persist = (): void => {
    if (options?.stateFile === undefined || win.isDestroyed()) return
    saved = nextSavedBounds(saved, win.getBounds(), win.isMaximized())
    try {
      writeWindowState(options.stateFile, saved)
    } catch {
      console.error('Could not save window state')
    }
  }

  const settled = debounce(persist, SAVE_BOUNDS_AFTER_MS)
  win.on('resize', settled.schedule)
  win.on('move', settled.schedule)
  win.on('maximize', settled.schedule)
  win.on('unmaximize', settled.schedule)
  // On close the final position is written at once, so a quit never loses it.
  win.on('close', () => {
    settled.cancel()
    persist()
  })
  win.on('closed', settled.cancel)

  win.on('ready-to-show', () => {
    const background = backgroundTestMode(app.isPackaged)
    // Show first, then maximize: on Linux Wayland (Hyprland) maximizing a window that
    // was never shown leaves it hidden for good.
    revealWindow(win, background)
    if (bounds.maximized && !background) win.maximize()
  })

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Renderer failed to load (${code}): ${description} ${url}`)
  })

  const devUrl = devServerOrigin()
  if (devUrl) {
    await win.loadURL(devUrl)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function defaultFor(displays: readonly DisplayWorkArea[]): WindowBounds {
  const primary = displays[0]
  if (primary === undefined) {
    return defaultWindowBounds({ id: 0, x: 0, y: 0, width: 1920, height: 1080 })
  }
  return defaultWindowBounds(primary)
}

function displaysFromScreen(): DisplayWorkArea[] {
  const primary = screen.getPrimaryDisplay()
  const rest = screen.getAllDisplays().filter((display) => display.id !== primary.id)
  return [primary, ...rest].map(workAreaOf)
}

function workAreaOf(display: Display): DisplayWorkArea {
  return {
    id: display.id,
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height
  }
}
