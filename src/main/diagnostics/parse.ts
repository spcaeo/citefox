import {
  DIAGNOSTICS_NOTE_MAX,
  DIAGNOSTICS_TEXT_MAX,
  type BuildDiagnosticsRequest,
  type OpenReportMailRequest,
  type SaveDiagnosticsRequest,
  type SendDiagnosticsRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

function record(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  channel: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new IpcRequestError(channel, `Unknown field ${key}`)
  }
}

function note(value: unknown, channel: string): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel, 'The note must be text')
  if (value.length > DIAGNOSTICS_NOTE_MAX) {
    throw new IpcRequestError(channel, `The note is longer than ${DIAGNOSTICS_NOTE_MAX} characters`)
  }
  return value
}

/** `diagnostics:build`: { includeQuestions, note, projectId }. */
export function parseBuildDiagnostics(value: unknown): BuildDiagnosticsRequest {
  const channel = 'diagnostics:build'
  const input = record(value, channel)
  onlyKeys(input, ['includeQuestions', 'note', 'projectId'], channel)
  if (typeof input.includeQuestions !== 'boolean') {
    throw new IpcRequestError(channel, 'includeQuestions must be true or false')
  }
  const projectId = input.projectId ?? null
  if (projectId !== null && (typeof projectId !== 'string' || !ID.test(projectId))) {
    throw new IpcRequestError(channel, 'Invalid project')
  }
  return { includeQuestions: input.includeQuestions, note: note(input.note, channel), projectId }
}

/** `diagnostics:save`: { text }. */
export function parseSaveDiagnostics(value: unknown): SaveDiagnosticsRequest {
  const channel = 'diagnostics:save'
  const input = record(value, channel)
  onlyKeys(input, ['text'], channel)
  if (typeof input.text !== 'string' || input.text.length === 0) {
    throw new IpcRequestError(channel, 'The report is empty')
  }
  if (input.text.length > DIAGNOSTICS_TEXT_MAX) {
    throw new IpcRequestError(channel, 'The report is too long to save')
  }
  return { text: input.text }
}

/** `diagnostics:open-mail`: { note }. */
export function parseOpenReportMail(value: unknown): OpenReportMailRequest {
  const channel = 'diagnostics:open-mail'
  const input = record(value, channel)
  onlyKeys(input, ['note'], channel)
  return { note: note(input.note, channel) }
}

/** `diagnostics:send`: the build options, `consent` (must be true) and the shown `text`. */
export function parseSendDiagnostics(value: unknown): SendDiagnosticsRequest {
  const channel = 'diagnostics:send'
  const input = record(value, channel)
  onlyKeys(input, ['includeQuestions', 'note', 'projectId', 'consent', 'text'], channel)
  if (input.consent !== true) {
    throw new IpcRequestError(channel, 'The report is sent only after you agree')
  }
  const { text, ...options } = input
  delete options.consent
  const built = parseBuildDiagnostics(options)
  if (text === undefined) return { ...built, consent: true }
  if (typeof text !== 'string' || text.length === 0 || text.length > DIAGNOSTICS_TEXT_MAX) {
    throw new IpcRequestError(channel, 'The report text is not valid')
  }
  return { ...built, consent: true, text }
}
