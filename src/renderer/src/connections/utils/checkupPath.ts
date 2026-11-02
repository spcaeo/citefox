import type { AiCliProvider } from '@shared/domain'
import { claudeBinaryPathError, codexBinaryPathError } from '../../settings/validate'

/** What "Run checkup" does with the Claude binary path field. */
export interface CheckupPathPlan {
  /** Sent as `claudeCode:runCheckup` `binaryPath`. Null uses the saved path, else a search. */
  binaryPath: string | null
  /** Said next to the button, and with the result, when the typed path is not saved. */
  note: string | null
  /** Stops the run: the typed path cannot be checked as it is. */
  error: string | null
}

export const UNSAVED_PATH_NOTE =
  'Runs with the path you typed. It is not saved yet: save settings to keep it.'
export const CLEARED_PATH_ERROR =
  'Save settings first to clear the Claude binary path. Until then the checkup would use the saved path.'
export const CLEARED_CODEX_PATH_ERROR =
  'Save settings first to clear the Codex path. Until then the checkup would use the saved path.'

/**
 * `typed` is the field's current text, `saved` the stored setting. Without a
 * field (the Connections screen) the saved path is used. A typed path that
 * differs from the saved one is checked as typed, and the note says so; it is
 * never silently ignored.
 */
export function checkupPathPlan(
  typed: string | undefined,
  saved: string | null | undefined,
  provider: AiCliProvider = 'claude-code'
): CheckupPathPlan {
  const codex = provider === 'codex'
  if (typed === undefined) return { binaryPath: null, note: null, error: null }
  const path = typed.trim()
  const stored = (saved ?? '').trim()
  if (path === stored) return { binaryPath: null, note: null, error: null }
  if (path.length === 0) {
    return {
      binaryPath: null,
      note: null,
      error: codex ? CLEARED_CODEX_PATH_ERROR : CLEARED_PATH_ERROR
    }
  }
  const problem = codex ? codexBinaryPathError(path) : claudeBinaryPathError(path)
  if (problem !== null) return { binaryPath: null, note: null, error: problem }
  return { binaryPath: path, note: UNSAVED_PATH_NOTE, error: null }
}
