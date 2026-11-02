import { createLogger, type Logger } from '../logging/logger'
import { LINUX_HEADLESS_SWITCHES } from '../scheduler/os-job/shared'
import { CHECK_DUE_FLAG, isCheckDueFlag, type SingleInstanceLock } from './check-due'

/** The piece of Electron `app` the primary instance needs. Tests pass a fake. */
export interface PrimaryInstanceApp extends SingleInstanceLock {
  quit(): void
}

/**
 * Decision 26b. True when this process holds the single-instance lock.
 * When another normal CiteFox instance already holds it, this process quits
 * and the caller must not open storage, the keychain, or a window.
 */
export function acquirePrimaryInstance(app: PrimaryInstanceApp): boolean {
  if (app.requestSingleInstanceLock()) return true
  app.quit()
  return false
}

/** The piece of a BrowserWindow a second launch can bring forward. Tests pass a fake. */
export interface FocusableWindow {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * Decision 26b. Set while `--check-due` holds the single-instance lock.
 * A normal second launch sets `requested`. Another `--check-due` does not.
 */
export interface CheckDueLaunchRequest {
  requested: boolean
}

/** The piece of Electron `app` a finished headless pass needs. Tests pass a fake. */
export interface CheckDueRelaunchApp {
  relaunch(options?: { args?: string[] }): void
  exit(code?: number): void
}

export function createCheckDueLaunchRequest(): CheckDueLaunchRequest {
  return { requested: false }
}

/**
 * Decision 26b. Remember a normal launch that arrived during `--check-due`.
 * Argv that itself carries `--check-due` is ignored.
 */
export function noteCheckDueSecondInstance(
  request: CheckDueLaunchRequest,
  argv: readonly string[]
): void {
  if (isCheckDueFlag(argv)) return
  request.requested = true
}

/**
 * macOS sends `activate`, not `second-instance`, when the user clicks CiteFox
 * in the Dock or Finder while the headless job owns the app. Treat it as a
 * request for the window: the pass stops after the running page, then the
 * process relaunches as the normal app.
 */
export function noteCheckDueActivate(request: CheckDueLaunchRequest): void {
  request.requested = true
}

/**
 * Decision 26b. When a normal launch was requested, relaunch without
 * `--check-due` (and the Linux job's headless switches), then exit with the pass code. Relaunch is not called when
 * nothing was requested. `app.relaunch` does not quit, so exit always follows.
 * A thrown relaunch is logged with secrets redacted and does not change the code.
 * `argv` is the process arguments without the executable (`process.argv.slice(1)`).
 */
export function finishCheckDuePass(
  app: CheckDueRelaunchApp,
  argv: readonly string[],
  request: CheckDueLaunchRequest,
  code: number,
  log: Pick<Logger, 'error'> = createLogger()
): void {
  try {
    if (request.requested) {
      // The Linux job's headless switches would start the window on no display.
      const jobOnly = new Set([CHECK_DUE_FLAG, ...LINUX_HEADLESS_SWITCHES])
      app.relaunch({ args: argv.filter((arg) => !jobOnly.has(arg)) })
    }
  } catch (error: unknown) {
    log.error('CiteFox could not relaunch after --check-due', error)
  } finally {
    app.exit(code)
  }
}

/** Restore a minimised window, then show and focus it. */
export function focusExistingWindow(
  win: FocusableWindow,
  /** Background test runs (CITEFOX_E2E_BACKGROUND=1) never pull a window to the front. */
  background = process.env.CITEFOX_E2E_BACKGROUND === '1'
): void {
  if (background) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Decision 26b. A second normal launch focuses the running window.
 * `--check-due` does not. No window means do nothing.
 */
export function handleSecondInstance(
  argv: readonly string[],
  getWindow: () => FocusableWindow | undefined
): void {
  if (isCheckDueFlag(argv)) return
  const win = getWindow()
  if (win === undefined) return
  focusExistingWindow(win)
}
