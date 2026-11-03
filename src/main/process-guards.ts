/** The part of `process` and the logger these guards use (so a test can pass fakes). */
export interface GuardedProcess {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown
}

export interface GuardLogger {
  error(message: string, extra?: unknown): void
}

/**
 * Writes a promise nobody caught, or an error nobody caught, to the log file instead of
 * letting it vanish (or stop the app with a dialog). The logger hides secrets. The app
 * keeps running; `onFatal` is only for a background run (`--check-due`) that must end
 * with an error code instead of hanging.
 */
export function installProcessGuards(
  target: GuardedProcess,
  logger: GuardLogger,
  onFatal?: () => void
): void {
  target.on('unhandledRejection', (reason) => {
    logger.error('A background task failed and nothing caught it', reason)
  })
  target.on('uncaughtException', (error) => {
    logger.error('CiteFox hit an error nothing caught', error)
    onFatal?.()
  })
}
