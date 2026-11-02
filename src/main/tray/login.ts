/**
 * SCH-1. Passed to `app.setLoginItemSettings`.
 * Electron 44 removed `openAsHidden`. It only worked on macOS 12 and earlier.
 * A login launch is hidden by `wasOpenedAtLogin` instead. A manual launch is
 * not that flag, so the window still shows.
 */
export function loginItemSettings(openAtLogin: boolean): { openAtLogin: boolean } {
  return { openAtLogin }
}
