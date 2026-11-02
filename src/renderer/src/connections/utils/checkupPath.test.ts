import { describe, expect, test } from 'vitest'
import { checkupPathPlan, CLEARED_PATH_ERROR, UNSAVED_PATH_NOTE } from './checkupPath'

describe('checkupPathPlan', () => {
  test('without a path field the saved path is used', () => {
    expect(checkupPathPlan(undefined, '/usr/local/bin/claude')).toEqual({
      binaryPath: null,
      note: null,
      error: null
    })
  })

  test('an unchanged field uses the saved path', () => {
    expect(checkupPathPlan(' /opt/claude ', '/opt/claude').binaryPath).toBeNull()
    expect(checkupPathPlan('', null)).toEqual({ binaryPath: null, note: null, error: null })
  })

  test('a typed, unsaved path is checked as typed and says so', () => {
    expect(checkupPathPlan('/Users/me/.local/bin/claude', null)).toEqual({
      binaryPath: '/Users/me/.local/bin/claude',
      note: UNSAVED_PATH_NOTE,
      error: null
    })
  })

  test('an invalid typed path stops the run with the field problem', () => {
    const plan = checkupPathPlan('claude', null)
    expect(plan.binaryPath).toBeNull()
    expect(plan.error).toMatch(/full path/)
  })

  test('a cleared but unsaved path asks to save first', () => {
    expect(checkupPathPlan('  ', '/opt/claude')).toEqual({
      binaryPath: null,
      note: null,
      error: CLEARED_PATH_ERROR
    })
  })
})
