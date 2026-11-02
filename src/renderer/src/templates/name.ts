import {
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_NAME_MIN_LENGTH,
  TEMPLATE_NOTES_MAX_LENGTH
} from '@shared/domain'
import { TEMPLATE_ERROR_MESSAGES } from '@shared/ipc'
import { errorText } from '../components/errorText'

/** Trim first, then require 1 to 80 characters. The same sentence as `name_length`. */
export function templateNameError(value: string): string | null {
  const name = value.trim()
  if (name.length < TEMPLATE_NAME_MIN_LENGTH || name.length > TEMPLATE_NAME_MAX_LENGTH) {
    return TEMPLATE_ERROR_MESSAGES.name_length
  }
  return null
}

/** Notes are optional. A blank value stores null. Length is checked after trim. */
export function templateNotesError(value: string): string | null {
  if (value.trim().length > TEMPLATE_NOTES_MAX_LENGTH) return TEMPLATE_ERROR_MESSAGES.notes_length
  return null
}

export function notesForSave(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function readTemplateFailure(error: unknown): string {
  return errorText(error, 'Request failed')
}

/**
 * Map a template-channel rejection onto the name field.
 * `name_length` uses the fixed sentence. A generic "Request failed" uses that
 * same sentence, because a bad name can come back without the code.
 */
export function nameFieldMessage(error: unknown): string | null {
  const raw = readTemplateFailure(error)
  if (raw.includes('name_length') || raw.includes(TEMPLATE_ERROR_MESSAGES.name_length)) {
    return TEMPLATE_ERROR_MESSAGES.name_length
  }
  if (/request failed/i.test(raw)) return TEMPLATE_ERROR_MESSAGES.name_length
  if (raw.includes('name_taken') || raw.includes(TEMPLATE_ERROR_MESSAGES.name_taken)) {
    return TEMPLATE_ERROR_MESSAGES.name_taken
  }
  return null
}

export function notesFieldMessage(error: unknown): string | null {
  const raw = readTemplateFailure(error)
  if (raw.includes('notes_length') || raw.includes(TEMPLATE_ERROR_MESSAGES.notes_length)) {
    return TEMPLATE_ERROR_MESSAGES.notes_length
  }
  return null
}
