import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { OsJobError } from './types'
import type { CommandResult, OsJobSpec } from './types'

/** The setting's label, as the user sees it in Settings. */
export const SETTING_NAME = 'Also check when CiteFox is closed'

/** The next step every failure message ends with. */
export const NEXT_STEP = `Turn "${SETTING_NAME}" off and on again. If it keeps failing, leave CiteFox open and it will check on schedule while it runs.`

export const CHECK_DUE_LOG = 'check-due.log'
export const CHECK_DUE_ERROR_LOG = 'check-due.err.log'

export type PathStyle = 'posix' | 'win32'

// Control characters a scheduler file or command line cannot carry safely.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000\r\n]/

function isAbsoluteFor(path: string, style: PathStyle | undefined): boolean {
  if (style === 'posix') return posix.isAbsolute(path)
  if (style === 'win32') return win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path)
  return posix.isAbsolute(path) || win32.isAbsolute(path)
}

/** Throws OsJobError unless the spec is safe to hand to an OS scheduler. */
export function validateSpec(spec: OsJobSpec, style?: PathStyle): void {
  const invalid = (what: string): OsJobError =>
    new OsJobError(`CiteFox could not set up the background check: ${what}. ${NEXT_STEP}`)
  if (typeof spec.program !== 'string' || spec.program.trim() === '') {
    throw invalid('the CiteFox program path is empty')
  }
  if (!isAbsoluteFor(spec.program, style)) {
    throw invalid('the CiteFox program path is not an absolute path')
  }
  if (typeof spec.logDirectory !== 'string' || !isAbsoluteFor(spec.logDirectory, style)) {
    throw invalid('the log folder is not an absolute path')
  }
  if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== 'string')) {
    throw invalid('the program arguments are not text')
  }
  for (const value of [spec.program, spec.logDirectory, ...spec.args]) {
    if (UNSAFE_CHARACTERS.test(value)) {
      throw invalid('a path or argument contains a line break or NUL character')
    }
  }
  if (!Number.isInteger(spec.minute) || spec.minute < 0 || spec.minute > 59) {
    throw invalid('the check minute must be a whole number from 0 to 59')
  }
}

/**
 * Chromium switches for the Linux job. cron (and a systemd user manager with no graphical
 * session) gives the job no DISPLAY or WAYLAND_DISPLAY, and Electron then exits with "Missing X
 * server or $DISPLAY" before any CiteFox code runs. The headless Ozone platform needs no display;
 * without a GPU process the job's error log is not filled with GL failures every hour. These must
 * be on the command line: `app.commandLine.appendSwitch` runs too late to pick the platform.
 */
export const LINUX_HEADLESS_SWITCHES: readonly string[] = [
  '--ozone-platform=headless',
  '--disable-gpu'
]

/**
 * Builds the `--check-due` job for this app install. `dailyCheckTime` is HH:MM (24-hour).
 *
 * `appImage` is `$APPIMAGE` on Linux: the path of the .AppImage file. An AppImage runs from a
 * temporary mount (or extraction folder) that is gone once the app quits, so `execPath` would
 * leave the scheduled job pointing at a missing file. The job runs the AppImage itself instead.
 */
export function checkDueJobSpec(input: {
  execPath: string
  appPath: string
  isPackaged: boolean
  logDirectory: string
  dailyCheckTime: string
  appImage?: string
  /** Linux adds {@link LINUX_HEADLESS_SWITCHES}. Defaults to this process's platform. */
  platform?: NodeJS.Platform
  /**
   * The data folder the app was started with through `--user-data-dir`, or null for the
   * default. The job must check the same folder as the app that installed it.
   */
  userDataDir?: string | null
}): OsJobSpec {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input.dailyCheckTime)
  if (!match) {
    throw new OsJobError(
      `CiteFox could not set up the background check: the daily check time "${input.dailyCheckTime}" is not a valid HH:MM time. Pick a check time in Settings, then try again.`
    )
  }
  const appImage = input.appImage?.trim() ?? ''
  const program = input.isPackaged && posix.isAbsolute(appImage) ? appImage : input.execPath
  return {
    program,
    args: [
      ...(input.userDataDir ? [`--user-data-dir=${input.userDataDir}`] : []),
      ...(input.isPackaged ? [] : [input.appPath]),
      '--check-due',
      ...((input.platform ?? process.platform) === 'linux' ? LINUX_HEADLESS_SWITCHES : [])
    ],
    logDirectory: input.logDirectory,
    minute: Number(match[2])
  }
}

export function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

/** Log files for the launchd, systemd and cron jobs. Those run only on macOS and Linux: '/' paths. */
export function logPaths(spec: OsJobSpec): { stdout: string; stderr: string } {
  return {
    stdout: posix.join(spec.logDirectory, CHECK_DUE_LOG),
    stderr: posix.join(spec.logDirectory, CHECK_DUE_ERROR_LOG)
  }
}

export function succeeded(result: CommandResult): boolean {
  return result.error === null && result.status === 0
}

/** A short, single-line reason for a failed command, safe to show the user. */
export function failureDetail(result: CommandResult): string {
  const text = result.error ?? (result.stderr.trim() || result.stdout.trim())
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  if (firstLine !== '') return firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine
  return result.status === null ? 'the command did not finish' : `exit status ${result.status}`
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return error instanceof Error ? error.message : String(error)
}

export function ensureDirectory(path: string, what: string): void {
  try {
    mkdirSync(path, { recursive: true })
  } catch (error) {
    throw new OsJobError(
      `CiteFox could not create ${what} (${errorCode(error)}). Check that your user account can write to ${path}. ${NEXT_STEP}`
    )
  }
}

/** Writes via a temp file and rename so a reader never sees a half-written file. */
export function writeFileAtomic(path: string, content: string, mode: number, what: string): void {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temp, content, { encoding: 'utf8', mode })
    chmodSync(temp, mode)
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw new OsJobError(`CiteFox could not write ${what} (${errorCode(error)}). ${NEXT_STEP}`)
  }
}

/** Deletes a file; a missing file is fine. */
export function removeFile(path: string, what: string): void {
  try {
    rmSync(path, { force: true })
  } catch (error) {
    throw new OsJobError(`CiteFox could not delete ${what} (${errorCode(error)}). ${NEXT_STEP}`)
  }
}

export function removeFileQuietly(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // Best effort: the caller is already reporting a failure.
  }
}
