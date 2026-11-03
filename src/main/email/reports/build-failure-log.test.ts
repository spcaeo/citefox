import { expect, test } from 'vitest'
import { createLogger } from '../../logging/logger'
import { logReportBuildFailure } from './build-failure-log'

test('logs the schedule id and the error type, not the error text', () => {
  const lines: string[] = []
  const logger = createLogger({ write: (_level, line) => lines.push(line) })
  logReportBuildFailure(logger, 'schedule-1', new RangeError('file /Users/secret-person/r.html'))
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('report file could not be built')
  expect(lines[0]).toContain('"scheduleId":"schedule-1"')
  expect(lines[0]).toContain('"threw":"RangeError"')
  expect(lines[0]).not.toContain('secret-person')
})
