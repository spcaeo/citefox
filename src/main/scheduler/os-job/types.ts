/**
 * SCH-1 "Also check when CiteFox is closed": an OS-level job that runs `CiteFox --check-due`
 * headless every hour. Each platform has its own installer behind {@link OsJobInstaller}.
 */
export interface OsJobSpec {
  /** Absolute path of the executable, e.g. `process.execPath`. */
  program: string
  /** Arguments after `program`: `[appPath, '--check-due']` in dev, `['--check-due']` packaged. */
  args: readonly string[]
  /** Absolute directory for the job's stdout/stderr logs. */
  logDirectory: string
  /**
   * 0-59: the job fires every hour at this minute. Headless runs only work what is due now and
   * then exit, so hourly fires pick up later batches and catch-up after sleep.
   */
  minute: number
}

export interface CommandResult {
  /** Exit status, or null when the process did not exit normally (spawn error, timeout, signal). */
  status: number | null
  stdout: string
  stderr: string
  /** Spawn-level error message (e.g. ENOENT, ETIMEDOUT), or null. */
  error: string | null
}

/** Runs one program with an argument array. Never through a shell. */
export interface CommandRunner {
  run(file: string, args: readonly string[], options?: { input?: string }): CommandResult
}

export type OsJobKind = 'launchd' | 'task_scheduler' | 'systemd' | 'cron' | 'unsupported'

export interface OsJobInstaller {
  readonly kind: OsJobKind
  /**
   * Installs or replaces the job. Throws OsJobError (user-facing, no secrets, says what failed
   * and the next step) on failure and leaves nothing half-installed.
   */
  install(spec: OsJobSpec): void
  /** Removes the job. Idempotent: removing a missing job is fine. Throws OsJobError if it is still installed afterwards. */
  remove(): void
  /** Reads the real install state now (file present AND registered with the OS scheduler). */
  isInstalled(): boolean
}

/** A user-facing failure to install or remove the background job. Safe to show as-is. */
export class OsJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OsJobError'
  }
}
