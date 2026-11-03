import { zipDeflate } from './zip'

/** The zip may not be bigger than this. The server refuses more. */
export const ZIP_MAX_BYTES = 2.5 * 1024 * 1024

/** citefox.log in the zip is at most this big. */
export const ZIP_LOG_MAX_BYTES = 400 * 1024

export interface PackInput {
  /** The report text, as previewed. */
  report: string
  /** The redacted log lines, oldest first. */
  log: readonly string[]
  /** The non-secret facts, as JSON text. */
  environment: string
}

export interface Packed {
  zip: Buffer
  /** What was left out to fit: the log, then part of the report. */
  trimmed: 'none' | 'log' | 'report'
}

/** The log text, cut from the front (oldest lines first) to fit `max` bytes. */
function logText(lines: readonly string[], max: number): string {
  let kept = lines.length
  let total = 0
  while (kept > 0) {
    const next = Buffer.byteLength(lines[kept - 1] ?? '') + 1
    if (total + next > max) break
    total += next
    kept -= 1
  }
  const text = lines.slice(kept).join('\n')
  return text.length > 0 ? `${text}\n` : ''
}

function build(report: string, log: string, environment: string): Buffer {
  return zipDeflate([
    { name: 'report.txt', data: Buffer.from(report, 'utf8') },
    { name: 'citefox.log', data: Buffer.from(log, 'utf8') },
    { name: 'environment.json', data: Buffer.from(environment, 'utf8') }
  ])
}

/**
 * `report.txt`, `citefox.log` and `environment.json` in one zip of at most 2.5 MB. Too big:
 * the log goes first, then the end of the report is cut. The environment is small.
 */
export function packReport(input: PackInput, max: number = ZIP_MAX_BYTES): Packed {
  const full = build(input.report, logText(input.log, ZIP_LOG_MAX_BYTES), input.environment)
  if (full.length <= max) return { zip: full, trimmed: 'none' }
  const noLog = build(input.report, '', input.environment)
  if (noLog.length <= max) return { zip: noLog, trimmed: 'log' }
  // Halve the report until it fits; text this size is cut in a few steps.
  let report = input.report
  for (;;) {
    report = `${report.slice(0, Math.floor(report.length / 2))}\n[report cut to fit]\n`
    const zip = build(report, '', input.environment)
    if (zip.length <= max || report.length < 200) return { zip, trimmed: 'report' }
  }
}
