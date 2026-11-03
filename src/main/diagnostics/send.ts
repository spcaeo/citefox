import { randomInt } from 'node:crypto'
import { DIAGNOSTICS_NOTE_MAX, type SendDiagnosticsResult } from '@shared/ipc'
import type { ReportRoute } from '../handlers/account'
import { postToScript } from '../account/post'
import type { HttpTransport } from '../providers/http'

/** Letters and digits with no 0/O, 1/I/L: easy to read out and to type. */
const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** `CF-` and six characters from {@link ID_ALPHABET}, made with a secure random source. */
export function newReportId(pick: (below: number) => number = randomInt): string {
  let id = 'CF-'
  for (let index = 0; index < 6; index += 1) id += ID_ALPHABET.charAt(pick(ID_ALPHABET.length))
  return id
}

/** The summary the owner reads first: the report up to its log, at most this long. */
export const SUMMARY_MAX = 4000

export function reportSummary(report: string): string {
  const log = report.indexOf('\n## Log')
  return (log < 0 ? report : report.slice(0, log)).slice(0, SUMMARY_MAX)
}

/** A big upload on a slow line: far longer than the registration call's 10 seconds. */
const SEND_TIMEOUT_MS = 90_000

export interface ReportToSend {
  version: string
  build: number | null
  os: string
  arch: string
  note: string
  summary: string
  zip: Buffer
}

/**
 * POSTs the report to the CiteFox script (the same address and token as registration).
 * Never throws: a failure is `{ ok: false, error }`, and the person still holds the report.
 * The message keys: kind, reportId, installId, version, build, os, arch, note, summary,
 * zipName, zipBase64 (and `token`, added by postToScript).
 */
export async function sendReport(
  route: ReportRoute | undefined,
  http: HttpTransport,
  report: ReportToSend,
  reportId: string = newReportId()
): Promise<SendDiagnosticsResult> {
  if (route === undefined || route.endpoint === null) return { ok: false, error: 'offline' }
  try {
    const reply = await postToScript(
      http,
      route.endpoint,
      {
        kind: 'report',
        reportId,
        installId: route.installId(),
        version: report.version,
        build: report.build,
        os: report.os,
        arch: report.arch,
        note: report.note.slice(0, DIAGNOSTICS_NOTE_MAX),
        summary: report.summary.slice(0, SUMMARY_MAX),
        zipName: `${reportId}.zip`,
        zipBase64: report.zip.toString('base64')
      },
      { timeoutMs: SEND_TIMEOUT_MS }
    )
    return reply.ok ? { ok: true, reportId } : { ok: false, error: reply.error }
  } catch {
    return { ok: false, error: 'network' }
  }
}
