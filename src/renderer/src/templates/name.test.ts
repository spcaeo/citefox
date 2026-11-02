import { describe, expect, test } from 'vitest'
import { TEMPLATE_ERROR_MESSAGES } from '@shared/ipc'
import {
  nameFieldMessage,
  notesFieldMessage,
  notesForSave,
  templateNameError,
  templateNotesError
} from './name'

describe('template name rules', () => {
  test('trims before the 1 to 80 character check', () => {
    expect(templateNameError('  Nightly buyer  ')).toBeNull()
    expect(templateNameError('   ')).toBe(TEMPLATE_ERROR_MESSAGES.name_length)
    expect(templateNameError('')).toBe(TEMPLATE_ERROR_MESSAGES.name_length)
    expect(templateNameError(`  ${'n'.repeat(80)}  `)).toBeNull()
    expect(templateNameError('n'.repeat(81))).toBe(TEMPLATE_ERROR_MESSAGES.name_length)
  })

  test('maps name_length and a generic request failure to the same sentence', () => {
    const sentence = TEMPLATE_ERROR_MESSAGES.name_length
    expect(nameFieldMessage(new Error('templates:update: name_length'))).toBe(sentence)
    expect(nameFieldMessage(new Error(`templates:create: ${sentence}`))).toBe(sentence)
    expect(nameFieldMessage(new Error('templates:update: Request failed'))).toBe(sentence)
    expect(
      nameFieldMessage(
        new Error('templates:create: A template of this kind already has that name.')
      )
    ).toBe(TEMPLATE_ERROR_MESSAGES.name_taken)
  })

  test('stores blank notes as null and flags notes past 500 characters', () => {
    expect(notesForSave('  ')).toBeNull()
    expect(notesForSave('  Night shift  ')).toBe('Night shift')
    expect(templateNotesError('n'.repeat(500))).toBeNull()
    expect(templateNotesError(`  ${'n'.repeat(501)}`)).toBe(TEMPLATE_ERROR_MESSAGES.notes_length)
    expect(
      notesFieldMessage(new Error(`templates:update: ${TEMPLATE_ERROR_MESSAGES.notes_length}`))
    ).toBe(TEMPLATE_ERROR_MESSAGES.notes_length)
  })
})
