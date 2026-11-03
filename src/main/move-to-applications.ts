/** The parts of Electron's `app` this uses (so a test can pass a fake). */
export interface MoveableApp {
  isPackaged: boolean
  isInApplicationsFolder(): boolean
  moveToApplicationsFolder(): boolean
}

export interface MoveLogger {
  info(message: string): void
  error(message: string, extra?: unknown): void
}

/**
 * A downloaded Mac app opened straight from the .dmg (or from Downloads) should live in
 * Applications. Without that it can vanish when the disk image is ejected, and the updater
 * and Launchpad cannot find it. Like Loom and other Mac apps, offer to move it: Electron
 * shows the system's own "Move to Applications folder?" question (with a "Do not ask again"
 * box), copies the app, and starts the copy.
 *
 * Only the packaged Mac app asks. Development runs, test runs, other systems, a background
 * `--check-due` run, and `CITEFOX_NO_MOVE_PROMPT=1` never do.
 * Returns true when the app is moving and the caller should stop starting up.
 */
export function offerMoveToApplications(
  app: MoveableApp,
  options: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    headless: boolean
    logger: MoveLogger
  }
): boolean {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  if (platform !== 'darwin' || !app.isPackaged || options.headless) return false
  if (env.CITEFOX_NO_MOVE_PROMPT === '1') return false
  try {
    if (app.isInApplicationsFolder()) return false
    const moved = app.moveToApplicationsFolder()
    if (moved) options.logger.info('CiteFox is moving itself to the Applications folder')
    return moved
  } catch (error: unknown) {
    // A refused or failed move is not a reason to stop: keep running from where it is.
    options.logger.error('CiteFox could not offer to move itself to Applications', error)
    return false
  }
}
