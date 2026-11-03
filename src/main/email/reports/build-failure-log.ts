import type { Logger } from '../../logging/logger'

/**
 * One log line when a scheduled report's file could not be built. The email still goes out
 * without it, so this line is the only trace of why the file is missing. It holds the
 * schedule id and the error type, never the error text.
 */
export function logReportBuildFailure(
  logger: Pick<Logger, 'warn'>,
  scheduleId: string,
  error: unknown
): void {
  logger.warn('report file could not be built for an email', {
    scheduleId,
    threw: error instanceof Error ? error.name : typeof error
  })
}
