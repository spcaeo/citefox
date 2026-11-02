import type { AppResetResult } from '@shared/ipc'
import type { Logger } from '../logging/logger'
import { writeResetMarker } from './marker'

export interface ResetRequestDeps {
  /** Electron `userData`. */
  userData: string
  now: () => Date
  /** Removes the hourly background job (SCH-1). Throws when the system kept it. */
  removeBackgroundJob(): void
  /** Turns the login item off. A development build has none to turn off. */
  turnOffLoginItem(): void
  /** Closes the app and starts it again; the next start performs the reset. */
  restart(): void
  logger: Pick<Logger, 'info' | 'error'>
}

/**
 * `app:resetKeepKeys`, the first half: turn off what runs CiteFox without the
 * window, ask the next start to reset, and restart. Nothing is moved here, so
 * a failure leaves every file as it was.
 */
export function requestResetKeepKeys(deps: ResetRequestDeps): AppResetResult {
  try {
    deps.removeBackgroundJob()
  } catch (error: unknown) {
    deps.logger.error('CiteFox could not turn off the background job before a reset', error)
    return {
      ok: false,
      message: 'CiteFox could not turn off background checks, so nothing was reset. Try again.'
    }
  }
  try {
    deps.turnOffLoginItem()
  } catch (error: unknown) {
    deps.logger.error('CiteFox could not turn off open at login before a reset', error)
    return {
      ok: false,
      message: 'CiteFox could not turn off open at login, so nothing was reset. Try again.'
    }
  }
  try {
    writeResetMarker(deps.userData, {
      version: 1,
      requestedAt: deps.now().toISOString(),
      kept: null,
      backup: null
    })
  } catch (error: unknown) {
    deps.logger.error('CiteFox could not save the reset request', error)
    return { ok: false, message: 'CiteFox could not save the reset request, so nothing was reset.' }
  }
  deps.logger.info('CiteFox restarts to reset its data and keep the API keys')
  deps.restart()
  return { ok: true }
}
