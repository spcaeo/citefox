import type { Logger } from '../logging/logger'
import { memoryOsJobInstaller, OsJobError, type OsJobInstaller, type OsJobSpec } from './os-job'

/**
 * SCH-1 "Also check when CiteFox is closed". `registered` is what the OS
 * really has: it is read from the installer, not remembered.
 */
export interface OsJobControl {
  readonly registered: boolean
  /** Installs, or replaces, the job for this daily check time. Throws {@link OsJobError}. */
  register(dailyCheckTime: string): void
  /** Removes the job. Throws {@link OsJobError} if it is still installed afterwards. */
  remove(): void
  /** Reads the real install state again. */
  refresh(): boolean
}

export function createOsJobControl(input: {
  installer: OsJobInstaller
  /** The job's command and schedule for a daily check time. */
  specFor: (dailyCheckTime: string) => OsJobSpec
  logger?: Pick<Logger, 'error'>
}): OsJobControl {
  let registered = readInstalled()
  function readInstalled(): boolean {
    try {
      return input.installer.isInstalled()
    } catch (error: unknown) {
      input.logger?.error('CiteFox could not read the background job state', error)
      return false
    }
  }
  return {
    get registered(): boolean {
      return registered
    },
    register(dailyCheckTime: string): void {
      try {
        input.installer.install(input.specFor(dailyCheckTime))
      } finally {
        registered = readInstalled()
      }
      if (!registered) {
        throw new OsJobError('CiteFox added the background job, but the system did not keep it.')
      }
    },
    remove(): void {
      try {
        input.installer.remove()
      } finally {
        registered = readInstalled()
      }
    },
    refresh(): boolean {
      registered = readInstalled()
      return registered
    }
  }
}

/** In-memory job for tests and for development and e2e runs, which must not touch the OS. */
export function memoryOsJobControl(): OsJobControl {
  return createOsJobControl({
    installer: memoryOsJobInstaller(),
    specFor: (dailyCheckTime) => ({
      program: '/CiteFox',
      args: ['--check-due'],
      logDirectory: '/CiteFox/logs',
      minute: Number(dailyCheckTime.slice(3, 5))
    })
  })
}
