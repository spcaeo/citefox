import { normalizeCheckRunResult, type CheckRunResult } from '../queue/runner'

/**
 * FR-24.6. The tray menu lists finished checks.
 * A user cancel is not a finished check and is not a failure row.
 */
export function shouldRecordTrayCheck(result: CheckRunResult): boolean {
  return normalizeCheckRunResult(result).outcome === 'ok'
}
