import type { BrowserWindow } from 'electron'

/**
 * Test runs open many short-lived windows. With `CITEFOX_E2E_BACKGROUND=1` an unpackaged
 * build never takes focus or the screen from the person using the computer: on macOS it
 * runs as an accessory app (no Dock icon, never activates), and windows are shown inactive
 * and, on macOS, fully transparent. The renderer still lays out and paints, so Playwright can click,
 * type and take screenshots. A packaged app ignores the variable.
 */
export function backgroundTestMode(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return !isPackaged && env.CITEFOX_E2E_BACKGROUND === '1'
}

/** Shows a window without stealing focus when running in background test mode. */
export function revealWindow(
  win: BrowserWindow,
  background: boolean,
  platform: NodeJS.Platform = process.platform
): void {
  if (!background) {
    win.show()
    return
  }
  // Transparency keeps a macOS test window off the screen of the person using the Mac.
  // Under xvfb on Linux it slows painting badly, and there is no one's screen to protect.
  if (platform === 'darwin') win.setOpacity(0)
  win.showInactive()
}

/** Brings a window forward, unless a background test run must leave focus alone. */
export function focusWindow(win: BrowserWindow, background: boolean): void {
  if (background) {
    if (!win.isVisible()) revealWindow(win, true)
    return
  }
  win.show()
  win.focus()
}
